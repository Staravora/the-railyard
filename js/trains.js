/**
 * trains.js — Poll Amtraker API and run a route-based motion simulation.
 */

const TrainsModule = (() => {
  const API_URL = 'https://api-v3.amtraker.com/v3/trains';
  const STATIONS_URL = 'https://api-v3.amtraker.com/v3/stations';

  const POLL_INTERVAL_MS = 30000;
  const SIM_TICK_MS = 1000;

  const MIN_DIRECTION_DELTA_M = 120;
  const HARD_RESYNC_DELTA_M = 6000;
  const BLEND_WINDOW_SEC = 8;
  const STALE_DATA_SEC = 90;
  const MAX_PREDICTION_HORIZON_SEC = 45;
  const HIGH_ZOOM_LOCAL_MODE = 10;

  const activeMarkers = new Map();
  const routeCache = new Map();

  let pollTimer = null;
  let simTimer = null;
  let layer = null;
  let stationIndex = null;
  let stationFetchInFlight = null;

  function speedColor(speed) {
    if (speed >= 60) return '#4ade80';
    if (speed >= 20) return '#facc15';
    return '#fb7185';
  }

  function makeMovingIcon(heading, speed) {
    const color = speedColor(speed);
    const rot = heading || 0;
    return L.divIcon({
      html: `<svg width="30" height="30" viewBox="0 0 30 30" style="transform:rotate(${rot}deg);display:block;filter:drop-shadow(0 0 6px rgba(255,178,44,0.45));"><path d="M15 3 L26 22 L15 18 L4 22 Z" fill="${color}" stroke="#f8f2e4" stroke-width="1.2"/><rect x="11" y="13" width="8" height="4" rx="1" fill="#1c1508"/><circle cx="10" cy="22" r="1.5" fill="#ffd084"/><circle cx="20" cy="22" r="1.5" fill="#ffd084"/></svg>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
      className: 'train-marker-icon',
    });
  }

  function makeStoppedIcon() {
    return L.divIcon({
      html: `<svg width="24" height="24" viewBox="0 0 24 24" style="display:block;filter:drop-shadow(0 0 5px rgba(255,178,44,0.3));"><circle cx="12" cy="12" r="9" fill="#2b241d" stroke="#ffd084" stroke-width="1.5"/><rect x="8" y="8" width="8" height="8" fill="#ffd084" rx="1"/></svg>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
      className: 'train-marker-icon',
    });
  }

  async function ensureStationIndex() {
    if (stationIndex) return stationIndex;
    if (stationFetchInFlight) return stationFetchInFlight;

    stationFetchInFlight = (async () => {
      try {
        const res = await fetch(STATIONS_URL, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        stationIndex = data && typeof data === 'object' ? data : {};
      } catch (err) {
        console.warn('[trains] station index fetch failed:', err.message);
        stationIndex = {};
      }
      return stationIndex;
    })();

    return stationFetchInFlight;
  }

  function getStopName(stop) {
    return stop.stationName || stop.name || stop.code || '?';
  }

  function getStopCode(stop) {
    return stop.code || stop.stationCode || null;
  }

  function getStopArrISO(stop) {
    return stop.arrDT || stop.arr || null;
  }

  function getStopSchArrISO(stop) {
    return stop.schArrDT || stop.schArr || null;
  }

  function buildRouteFromStops(stops) {
    if (!stationIndex || !Array.isArray(stops) || stops.length < 2) return null;

    const routeKey = stops
      .map(getStopCode)
      .filter(Boolean)
      .join('>');

    if (!routeKey) return null;
    if (routeCache.has(routeKey)) return routeCache.get(routeKey);

    const points = [];
    let lastKey = '';

    stops.forEach(stop => {
      const code = getStopCode(stop);
      if (!code) return;

      const station = stationIndex[code];
      if (!station || station.lat == null || station.lon == null) return;

      const key = `${station.lat},${station.lon}`;
      if (key === lastKey) return;
      lastKey = key;

      points.push({ lat: station.lat, lng: station.lon });
    });

    if (points.length < 2) {
      routeCache.set(routeKey, null);
      return null;
    }

    const cumulative = [0];
    let total = 0;
    for (let i = 1; i < points.length; i += 1) {
      total += haversineMeters(points[i - 1], points[i]);
      cumulative.push(total);
    }

    const route = total > 0 ? { key: routeKey, points, cumulative, total } : null;
    routeCache.set(routeKey, route);
    return route;
  }

  function normalizeResponse(raw) {
    const trains = [];

    for (const [trainNum, runs] of Object.entries(raw)) {
      if (!Array.isArray(runs)) continue;

      runs.forEach((run, idx) => {
        if (run.lat == null || run.lon == null) return;

        const stops = Array.isArray(run.stations) ? run.stations : [];
        const nextStop = stops.find(stop => {
          const arr = getStopArrISO(stop);
          return !arr || new Date(arr) > new Date();
        });

        let delayMinutes = 0;
        const lastUpdated = stops.findLast ? stops.findLast(stop => getStopArrISO(stop)) : null;
        const arrISO = lastUpdated ? getStopArrISO(lastUpdated) : null;
        const schArrISO = lastUpdated ? getStopSchArrISO(lastUpdated) : null;
        if (arrISO && schArrISO) {
          delayMinutes = Math.round((new Date(arrISO) - new Date(schArrISO)) / 60000);
        }
        if (run.eventAr != null) {
          delayMinutes = Math.round(run.eventAr);
        }

        const nextStopIdx = nextStop ? stops.indexOf(nextStop) : stops.length;
        const progress = stops.length > 0 ? nextStopIdx / stops.length : 0;

        trains.push({
          id: run.trainID || `${trainNum}-${idx}`,
          trainNumber: trainNum,
          routeName: run.routeName || run.trainName || `Train ${trainNum}`,
          lat: run.lat,
          lng: run.lon,
          speed: run.velocity != null ? Math.round(run.velocity) : 0,
          heading: run.heading || 0,
          delayMinutes,
          nextStop: nextStop ? getStopName(nextStop) : null,
          nextStopEta: nextStop ? (getStopArrISO(nextStop) || getStopSchArrISO(nextStop) || null) : null,
          origin: stops.length > 0 ? getStopName(stops[0]) : null,
          destination: stops.length > 0 ? getStopName(stops[stops.length - 1]) : null,
          progress: Math.max(0, Math.min(1, progress)),
          stops,
          route: buildRouteFromStops(stops),
        });
      });
    }

    return trains;
  }

  async function fetchAndUpdate() {
    let raw;
    try {
      const res = await fetch(API_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      raw = await res.json();
    } catch (err) {
      console.warn('[trains] fetch failed:', err.message);
      return;
    }

    const nowMs = Date.now();
    const trains = normalizeResponse(raw);
    const seenIds = new Set();

    trains.forEach(train => {
      seenIds.add(train.id);

      if (activeMarkers.has(train.id)) {
        const entry = activeMarkers.get(train.id);
        entry.data = train;
        entry.marker.setIcon(train.speed <= 5 ? makeStoppedIcon() : makeMovingIcon(train.heading, train.speed));
        entry.marker.setTooltipContent(tooltipContent(train));

        reconcileSimulation(entry.sim, train, nowMs);
        entry.lastTickMs = nowMs;

        if (typeof TrainPanelModule !== 'undefined') {
          TrainPanelModule.update(train);
        }
      } else {
        const marker = L.marker([train.lat, train.lng], {
          icon: train.speed <= 5 ? makeStoppedIcon() : makeMovingIcon(train.heading, train.speed)
        });

        marker.bindTooltip(tooltipContent(train), {
          permanent: false,
          direction: 'top',
          className: 'train-tooltip',
          offset: [0, -14],
        });

        marker.on('click', () => {
          if (typeof TrainPanelModule !== 'undefined') {
            TrainPanelModule.open(train);
          }
        });

        marker.addTo(layer);

        const sim = createSimState(train, nowMs);
        marker.setLatLng([sim.lat, sim.lng]);

        activeMarkers.set(train.id, {
          marker,
          data: train,
          sim,
          lastTickMs: nowMs,
        });
      }
    });

    for (const [id, entry] of activeMarkers.entries()) {
      if (!seenIds.has(id)) {
        entry.marker.remove();
        activeMarkers.delete(id);
      }
    }

    publishStats(trains);
  }

  function createSimState(train, nowMs) {
    const route = train.route;

    if (route) {
      const snap = projectOntoRoute(route, { lat: train.lat, lng: train.lng });
      const s = snap ? snap.s : 0;
      const pt = interpolateRoutePoint(route, s);

      return {
        mode: 'route',
        route,
        s,
        lat: pt.lat,
        lng: pt.lng,
        speedMph: Math.max(0, train.speed || 0),
        direction: inferDirectionFromHeading(route, s, train.heading || 0, 1),
        confidence: 1,
        lastApiMs: nowMs,
        lastApiS: s,
        correctionDelta: 0,
        correctionRemainingSec: 0,
        stalePolls: 0,
        apiLat: train.lat,
        apiLng: train.lng,
        apiHeading: normalizeHeading(train.heading || 0),
        apiVectorHeading: null,
        apiVectorSpeedMph: Math.max(0, train.speed || 0),
      };
    }

    return {
      mode: 'heading',
      route: null,
      s: 0,
      lat: train.lat,
      lng: train.lng,
      speedMph: Math.max(0, train.speed || 0),
      direction: 1,
      heading: normalizeHeading(train.heading || 0),
      confidence: 0.35,
      lastApiMs: nowMs,
      correctionDelta: 0,
      correctionRemainingSec: 0,
      stalePolls: 0,
      apiLat: train.lat,
      apiLng: train.lng,
      apiHeading: normalizeHeading(train.heading || 0),
      apiVectorHeading: null,
      apiVectorSpeedMph: Math.max(0, train.speed || 0),
    };
  }

  function reconcileSimulation(sim, train, nowMs) {
    const prevApiPoint = { lat: sim.apiLat ?? train.lat, lng: sim.apiLng ?? train.lng };
    const currApiPoint = { lat: train.lat, lng: train.lng };
    const apiMoveMeters = haversineMeters(prevApiPoint, currApiPoint);
    const apiMoveSec = Math.max(1, (nowMs - (sim.lastApiMs || nowMs)) / 1000);
    if (apiMoveMeters >= 60) {
      sim.apiVectorHeading = bearingDegrees(prevApiPoint, currApiPoint);
      sim.apiVectorSpeedMph = (apiMoveMeters / apiMoveSec) * 2.236936;
    }
    sim.apiLat = train.lat;
    sim.apiLng = train.lng;
    sim.apiHeading = normalizeHeading(train.heading || sim.apiHeading || 0);

    sim.lastApiMs = nowMs;

    if (!train.route) {
      sim.mode = 'heading';
      sim.route = null;
      sim.heading = normalizeHeading(train.heading || sim.heading || 0);
      sim.speedMph = Math.max(0, train.speed || 0);
      sim.lat = train.lat;
      sim.lng = train.lng;
      return;
    }

    const route = train.route;
    const snap = projectOntoRoute(route, { lat: train.lat, lng: train.lng });
    if (!snap) return;

    const apiS = snap.s;
    const apiPoint = interpolateRoutePoint(route, apiS);

    if (sim.mode !== 'route' || !sim.route || sim.route.key !== route.key) {
      sim.mode = 'route';
      sim.route = route;
      sim.s = apiS;
      sim.lat = apiPoint.lat;
      sim.lng = apiPoint.lng;
      sim.speedMph = Math.max(0, train.speed || 0);
      sim.direction = inferDirectionFromHeading(route, apiS, train.heading || 0, sim.direction || 1);
      sim.confidence = 1;
      sim.lastApiS = apiS;
      sim.correctionDelta = 0;
      sim.correctionRemainingSec = 0;
      sim.stalePolls = 0;
      return;
    }

    const prevApiS = typeof sim.lastApiS === 'number' ? sim.lastApiS : apiS;
    const apiDelta = apiS - prevApiS;
    const movedEnough = Math.abs(apiDelta) >= MIN_DIRECTION_DELTA_M;

    if (movedEnough) {
      sim.direction = apiDelta >= 0 ? 1 : -1;
      sim.stalePolls = 0;
    } else {
      sim.stalePolls += 1;
      sim.direction = inferDirectionFromHeading(route, apiS, train.heading || 0, sim.direction || 1);
    }

    sim.lastApiS = apiS;
    sim.speedMph = Math.max(0, train.speed || sim.speedMph || 0);

    const simToApi = apiS - sim.s;
    const absDelta = Math.abs(simToApi);

    if (absDelta > HARD_RESYNC_DELTA_M) {
      sim.s = apiS;
      sim.lat = apiPoint.lat;
      sim.lng = apiPoint.lng;
      sim.correctionDelta = 0;
      sim.correctionRemainingSec = 0;
      sim.confidence = 0.25;
      return;
    }

    sim.correctionDelta = simToApi;
    sim.correctionRemainingSec = BLEND_WINDOW_SEC;
    sim.confidence = Math.max(0.45, 1 - (absDelta / HARD_RESYNC_DELTA_M));
  }

  function simulateMovement() {
    const nowMs = Date.now();
    const map = typeof MapModule !== 'undefined' ? MapModule.getMap() : null;
    const zoom = map ? map.getZoom() : 6;

    activeMarkers.forEach(entry => {
      const sim = entry.sim;
      if (!sim) return;

      const dtSec = Math.max(0.2, Math.min(2, (nowMs - (entry.lastTickMs || nowMs)) / 1000));
      entry.lastTickMs = nowMs;

      if (sim.mode === 'route' && sim.route) {
        if (zoom >= HIGH_ZOOM_LOCAL_MODE) {
          const sinceApiSec = Math.max(0, (nowMs - sim.lastApiMs) / 1000);
          const horizonSec = Math.min(25, (POLL_INTERVAL_MS / 1000) * 0.9);
          const projectionSec = Math.min(sinceApiSec, horizonSec);

          const heading = sim.apiVectorHeading != null ? sim.apiVectorHeading : sim.apiHeading;
          const speedMph = sim.apiVectorHeading != null
            ? ((sim.apiVectorSpeedMph * 0.65) + (sim.speedMph * 0.35))
            : sim.speedMph;

          const projected = projectLatLng(sim.apiLat, sim.apiLng, heading, speedMph, projectionSec);
          const capMeters = Math.max(450, speedMph * 0.44704 * horizonSec);
          const distFromFix = haversineMeters({ lat: sim.apiLat, lng: sim.apiLng }, projected);
          const clamped = distFromFix > capMeters
            ? pointFromBearing({ lat: sim.apiLat, lng: sim.apiLng }, heading, capMeters)
            : projected;

          sim.lat = clamped.lat;
          sim.lng = clamped.lng;
          entry.marker.setLatLng([clamped.lat, clamped.lng]);
          return;
        }

        const staleSec = (nowMs - sim.lastApiMs) / 1000;
        const staleFactor = staleSec <= STALE_DATA_SEC
          ? 1
          : Math.max(0.15, 1 - ((staleSec - STALE_DATA_SEC) / MAX_PREDICTION_HORIZON_SEC));

        const baseMeters = sim.speedMph * 0.44704 * dtSec * staleFactor;
        sim.s = clamp(sim.s + (baseMeters * sim.direction), 0, sim.route.total);

        if (sim.correctionRemainingSec > 0 && Math.abs(sim.correctionDelta) > 0.01) {
          const portion = Math.min(1, dtSec / sim.correctionRemainingSec);
          const step = sim.correctionDelta * portion;
          sim.s += step;
          sim.correctionDelta -= step;
          sim.correctionRemainingSec = Math.max(0, sim.correctionRemainingSec - dtSec);
          sim.s = clamp(sim.s, 0, sim.route.total);
        }

        const point = interpolateRoutePoint(sim.route, sim.s);
        sim.lat = point.lat;
        sim.lng = point.lng;
        entry.marker.setLatLng([point.lat, point.lng]);
        return;
      }

      if (sim.mode === 'heading') {
        const projected = projectLatLng(sim.lat, sim.lng, sim.heading || 0, sim.speedMph || 0, dtSec);
        sim.lat = projected.lat;
        sim.lng = projected.lng;
        entry.marker.setLatLng([projected.lat, projected.lng]);
      }
    });
  }

  function interpolateRoutePoint(route, s) {
    if (s <= 0) return route.points[0];
    if (s >= route.total) return route.points[route.points.length - 1];

    let segmentIdx = 0;
    while (segmentIdx < route.cumulative.length - 1 && route.cumulative[segmentIdx + 1] < s) {
      segmentIdx += 1;
    }

    const start = route.points[segmentIdx];
    const end = route.points[segmentIdx + 1];
    const segStart = route.cumulative[segmentIdx];
    const segLen = route.cumulative[segmentIdx + 1] - segStart;
    const t = segLen > 0 ? (s - segStart) / segLen : 0;

    return {
      lat: start.lat + ((end.lat - start.lat) * t),
      lng: start.lng + ((end.lng - start.lng) * t),
    };
  }

  function projectOntoRoute(route, point) {
    let best = null;

    for (let i = 0; i < route.points.length - 1; i += 1) {
      const a = route.points[i];
      const b = route.points[i + 1];
      const proj = projectPointToSegment(point, a, b);
      const segStart = route.cumulative[i];
      const segLen = route.cumulative[i + 1] - route.cumulative[i];
      const s = segStart + (segLen * proj.t);

      if (!best || proj.distanceSq < best.distanceSq) {
        best = { s, distanceSq: proj.distanceSq };
      }
    }

    return best;
  }

  function projectPointToSegment(p, a, b) {
    const latScale = 111320;
    const lngScale = 111320 * Math.cos(((a.lat + b.lat + p.lat) / 3) * Math.PI / 180);

    const ax = a.lng * lngScale;
    const ay = a.lat * latScale;
    const bx = b.lng * lngScale;
    const by = b.lat * latScale;
    const px = p.lng * lngScale;
    const py = p.lat * latScale;

    const abx = bx - ax;
    const aby = by - ay;
    const apx = px - ax;
    const apy = py - ay;
    const lenSq = (abx * abx) + (aby * aby);
    const rawT = lenSq > 0 ? ((apx * abx) + (apy * aby)) / lenSq : 0;
    const t = clamp(rawT, 0, 1);

    const cx = ax + (abx * t);
    const cy = ay + (aby * t);
    const dx = px - cx;
    const dy = py - cy;

    return { t, distanceSq: (dx * dx) + (dy * dy) };
  }

  function inferDirectionFromHeading(route, s, heading, fallbackDirection) {
    const d = Math.min(8000, route.total * 0.02 + 1000);
    const pNow = interpolateRoutePoint(route, s);
    const pFwd = interpolateRoutePoint(route, clamp(s + d, 0, route.total));

    const forwardBearing = bearingDegrees(pNow, pFwd);
    const forwardDiff = angularDiffDeg(heading, forwardBearing);
    const backwardDiff = angularDiffDeg(heading, (forwardBearing + 180) % 360);

    if (forwardDiff === backwardDiff) return fallbackDirection || 1;
    return forwardDiff < backwardDiff ? 1 : -1;
  }

  function normalizeHeading(value) {
    const h = Number(value) || 0;
    return ((h % 360) + 360) % 360;
  }

  function angularDiffDeg(a, b) {
    const diff = Math.abs((a - b) % 360);
    return diff > 180 ? 360 - diff : diff;
  }

  function projectLatLng(lat, lng, headingDeg, mph, seconds) {
    const meters = mph * 0.44704 * seconds;
    const heading = (headingDeg * Math.PI) / 180;
    const R = 6378137;

    const latRad = (lat * Math.PI) / 180;
    const lngRad = (lng * Math.PI) / 180;
    const dByR = meters / R;

    const nextLat = Math.asin(
      Math.sin(latRad) * Math.cos(dByR) +
      Math.cos(latRad) * Math.sin(dByR) * Math.cos(heading)
    );

    const nextLng = lngRad + Math.atan2(
      Math.sin(heading) * Math.sin(dByR) * Math.cos(latRad),
      Math.cos(dByR) - Math.sin(latRad) * Math.sin(nextLat)
    );

    return {
      lat: (nextLat * 180) / Math.PI,
      lng: (nextLng * 180) / Math.PI
    };
  }

  function pointFromBearing(origin, headingDeg, meters) {
    const heading = (headingDeg * Math.PI) / 180;
    const R = 6378137;
    const lat1 = (origin.lat * Math.PI) / 180;
    const lng1 = (origin.lng * Math.PI) / 180;
    const dByR = meters / R;

    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(dByR) +
      Math.cos(lat1) * Math.sin(dByR) * Math.cos(heading)
    );

    const lng2 = lng1 + Math.atan2(
      Math.sin(heading) * Math.sin(dByR) * Math.cos(lat1),
      Math.cos(dByR) - Math.sin(lat1) * Math.sin(lat2)
    );

    return {
      lat: (lat2 * 180) / Math.PI,
      lng: (lng2 * 180) / Math.PI,
    };
  }

  function haversineMeters(a, b) {
    const R = 6371000;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const lat1 = (a.lat * Math.PI) / 180;
    const lat2 = (b.lat * Math.PI) / 180;

    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const h = (sinLat * sinLat) + (Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function bearingDegrees(a, b) {
    const lat1 = (a.lat * Math.PI) / 180;
    const lat2 = (b.lat * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;

    const y = Math.sin(dLng) * Math.cos(lat2);
    const x =
      (Math.cos(lat1) * Math.sin(lat2)) -
      (Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng));

    const brng = (Math.atan2(y, x) * 180) / Math.PI;
    return (brng + 360) % 360;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function tooltipContent(train) {
    const delay = train.delayMinutes > 0
      ? `<span style="color:#fb7185">+${train.delayMinutes}m late</span>`
      : `<span style="color:#4ade80">On time</span>`;
    return `<b>${train.routeName} #${train.trainNumber}</b><br>${train.speed} mph · ${delay}`;
  }

  function publishStats(trains) {
    const activeCount = trains.length;
    const delayedCount = trains.filter(train => train.delayMinutes > 5).length;
    const onTimeCount = trains.filter(train => train.delayMinutes <= 5).length;
    const onTimePct = activeCount > 0 ? Math.round((onTimeCount / activeCount) * 100) : 0;

    try {
      document.dispatchEvent(new CustomEvent('railyard:train-stats', {
        detail: {
          activeCount,
          delayedCount,
          onTimePct,
          updatedAt: new Date().toISOString()
        }
      }));
    } catch {
      // Ignore HUD event failures.
    }
  }

  async function init() {
    layer = MapModule.getTrainLayer();
    await ensureStationIndex();
    await fetchAndUpdate();
    pollTimer = setInterval(fetchAndUpdate, POLL_INTERVAL_MS);
    simTimer = setInterval(simulateMovement, SIM_TICK_MS);
  }

  function stop() {
    clearInterval(pollTimer);
    clearInterval(simTimer);
  }

  function getMarkerData(trainId) {
    return activeMarkers.get(trainId)?.data || null;
  }

  return { init, stop, getMarkerData };
})();

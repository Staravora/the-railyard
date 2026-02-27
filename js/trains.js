/**
 * trains.js — Poll Amtraker API, manage markers, interpolate positions
 */

const TrainsModule = (() => {
  const API_URL = 'https://api-v3.amtraker.com/v3/trains';
  const STATIONS_URL = 'https://api-v3.amtraker.com/v3/stations';
  const POLL_INTERVAL_MS = 30000;
  const SIM_TICK_MS = 1000;
  const HIGH_ZOOM_LOCAL_MODE = 9;
  const MAX_HEADING_EXTRAPOLATION_M = 1200;

  // Map from train key → { marker, data }
  const activeMarkers = new Map();
  let pollTimer = null;
  let simTimer = null;
  let layer = null;
  let stationIndex = null;
  let stationFetchStarted = false;

  // ── Icon helpers ──────────────────────────────────────────────

  function speedColor(speed) {
    if (speed >= 60) return '#4ade80';
    if (speed >= 20) return '#facc15';
    return '#fb7185';
  }

  function makeMovingIcon(heading, speed) {
    const color = speedColor(speed);
    const rot = heading || 0;
    return L.divIcon({
      html: `<svg width="30" height="30" viewBox="0 0 30 30" style="transform:rotate(${rot}deg);display:block;filter:drop-shadow(0 0 6px rgba(255,178,44,0.45));">
               <path d="M15 3 L26 22 L15 18 L4 22 Z" fill="${color}" stroke="#f8f2e4" stroke-width="1.2"/>
               <rect x="11" y="13" width="8" height="4" rx="1" fill="#1c1508"/>
               <circle cx="10" cy="22" r="1.5" fill="#ffd084"/>
               <circle cx="20" cy="22" r="1.5" fill="#ffd084"/>
              </svg>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
      className: 'train-marker-icon',
    });
  }

  function makeStoppedIcon() {
    return L.divIcon({
      html: `<svg width="24" height="24" viewBox="0 0 24 24" style="display:block;filter:drop-shadow(0 0 5px rgba(255,178,44,0.3));">
               <circle cx="12" cy="12" r="9" fill="#2b241d" stroke="#ffd084" stroke-width="1.5"/>
               <rect x="8" y="8" width="8" height="8" fill="#ffd084" rx="1"/>
              </svg>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
      className: 'train-marker-icon',
    });
  }

  // ── Normalize API response ────────────────────────────────────

  async function ensureStationIndex() {
    if (stationIndex || stationFetchStarted) return;
    stationFetchStarted = true;

    try {
      const res = await fetch(STATIONS_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      stationIndex = data && typeof data === 'object' ? data : {};
    } catch (err) {
      console.warn('[trains] station index fetch failed:', err.message);
      stationIndex = {};
    }
  }

  function getStopCode(stop) {
    return stop.code || stop.stationCode || null;
  }

  function getStopName(stop) {
    return stop.stationName || stop.name || stop.code || '?';
  }

  function getStopArrISO(stop) {
    return stop.arrDT || stop.arr || null;
  }

  function getStopSchArrISO(stop) {
    return stop.schArrDT || stop.schArr || null;
  }

  function buildRoutePoints(stops) {
    if (!Array.isArray(stops) || !stationIndex) return [];

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

    return points;
  }

  /**
   * Amtraker v3 returns an object keyed by train number,
   * each value is an array of train runs (a train number can have
   * multiple consists running). We flatten to a single array.
   */
  function normalizeResponse(raw) {
    const trains = [];

    for (const [trainNum, runs] of Object.entries(raw)) {
      if (!Array.isArray(runs)) continue;

      runs.forEach((run, idx) => {
        // Skip if no position data
        if (run.lat == null || run.lon == null) return;

        const stops = Array.isArray(run.stations) ? run.stations : [];

        // Find next stop (first not yet arrived)
        const nextStop = stops.find(s => {
          const arr = getStopArrISO(s);
          return !arr || new Date(arr) > new Date();
        });

        // Compute delay in minutes from last station
        let delayMinutes = 0;
        const lastUpdated = stops.findLast ? stops.findLast(s => getStopArrISO(s)) : null;
        const arrISO = lastUpdated ? getStopArrISO(lastUpdated) : null;
        const schArrISO = lastUpdated ? getStopSchArrISO(lastUpdated) : null;
        if (arrISO && schArrISO) {
          delayMinutes = Math.round(
            (new Date(arrISO) - new Date(schArrISO)) / 60000
          );
        }
        // Fall back to API-provided delay if available
        if (run.eventAr != null) {
          delayMinutes = Math.round(run.eventAr);
        }

        // Route progress: index of next stop / total stops
        const nextStopIdx = nextStop ? stops.indexOf(nextStop) : stops.length;
        const progress = stops.length > 0 ? nextStopIdx / stops.length : 0;

        const routePoints = buildRoutePoints(stops);

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
          routePoints,
        });
      });
    }

    return trains;
  }

  // ── Fetch + update markers ────────────────────────────────────

  async function fetchAndUpdate() {
    let raw;
    try {
      const res = await fetch(API_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      raw = await res.json();
    } catch (err) {
      console.warn('[trains] fetch failed:', err.message);
      return;
    }

    const trains = normalizeResponse(raw);
    const seenIds = new Set();

    trains.forEach(train => {
      seenIds.add(train.id);

      if (activeMarkers.has(train.id)) {
        // Update existing marker
        const entry = activeMarkers.get(train.id);
        const isStopped = train.speed <= 5;

        // Update icon
        entry.marker.setIcon(
          isStopped ? makeStoppedIcon() : makeMovingIcon(train.heading, train.speed)
        );

        const motion = computeMotionState(train, entry.motion);
        entry.motion = motion;
        entry.marker.setLatLng([train.lat, train.lng]);

        // Update tooltip
        entry.marker.setTooltipContent(tooltipContent(train));
        entry.data = train;
        entry.lastTickMs = Date.now();

        // Update panel if this train is currently open
        if (typeof TrainPanelModule !== 'undefined') {
          TrainPanelModule.update(train);
        }
      } else {
        // Create new marker
        const isStopped = train.speed <= 5;
        const icon = isStopped ? makeStoppedIcon() : makeMovingIcon(train.heading, train.speed);

        const marker = L.marker([train.lat, train.lng], { icon });

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
        const motion = computeMotionState(train, null);
        marker.setLatLng([train.lat, train.lng]);

        activeMarkers.set(train.id, {
          marker,
          data: train,
          motion,
          lastTickMs: Date.now(),
        });
      }
    });

    // Remove departed trains
    for (const [id, entry] of activeMarkers.entries()) {
      if (!seenIds.has(id)) {
        entry.marker.remove();
        activeMarkers.delete(id);
      }
    }

    publishStats(trains);
  }

  function simulateMovement() {
    const nowMs = Date.now();
    const map = typeof MapModule !== 'undefined' ? MapModule.getMap() : null;
    const zoom = map ? map.getZoom() : 0;

    activeMarkers.forEach(entry => {
      const train = entry.data;
      if (!train || !entry.motion) return;
      if (train.speed <= 5) return;

      const dt = Math.max(0.2, Math.min(2, (nowMs - (entry.lastTickMs || nowMs)) / 1000));
      entry.lastTickMs = nowMs;

      if (zoom >= HIGH_ZOOM_LOCAL_MODE && entry.motion.realFix) {
        const elapsedSec = Math.max(0, (nowMs - (entry.motion.lastFixMs || nowMs)) / 1000);
        const horizonSec = POLL_INTERVAL_MS / 1000;
        const projected = projectLatLng(
          entry.motion.realFix.lat,
          entry.motion.realFix.lng,
          train.heading || 0,
          train.speed,
          Math.min(elapsedSec, horizonSec)
        );

        const distFromFix = haversineMeters(entry.motion.realFix, projected);
        const dynamicCap = Math.max(
          MAX_HEADING_EXTRAPOLATION_M,
          train.speed * 0.44704 * horizonSec * 1.1
        );
        const clamped = distFromFix > dynamicCap
          ? pointFromBearing(entry.motion.realFix, train.heading || 0, dynamicCap)
          : projected;

        entry.motion.lat = clamped.lat;
        entry.motion.lng = clamped.lng;
        entry.marker.setLatLng([clamped.lat, clamped.lng]);
        return;
      }

      if (entry.motion.mode === 'route' && entry.motion.route) {
        const meters = train.speed * 0.44704 * dt;
        const nextS = clamp(entry.motion.s + (meters * entry.motion.direction), 0, entry.motion.route.total);
        const nextPoint = interpolateRoutePoint(entry.motion.route, nextS);
        entry.motion.s = nextS;
        entry.motion.lat = nextPoint.lat;
        entry.motion.lng = nextPoint.lng;
        entry.marker.setLatLng([nextPoint.lat, nextPoint.lng]);
        return;
      }

      const current = entry.marker.getLatLng();
      const next = projectLatLng(current.lat, current.lng, train.heading || 0, train.speed, dt);
      entry.motion.lat = next.lat;
      entry.motion.lng = next.lng;
      entry.marker.setLatLng([next.lat, next.lng]);
    });
  }

  function computeMotionState(train, previousMotion) {
    const route = buildRouteGeometry(train.routePoints || []);
    if (route) {
      const projected = projectOntoRoute(route, { lat: train.lat, lng: train.lng });
      if (projected) {
        const direction = pickRouteDirection(train.heading || 0, route, projected.s, previousMotion?.direction);
        const point = interpolateRoutePoint(route, projected.s);
        return {
          mode: 'route',
          route,
          s: projected.s,
          direction,
          lat: point.lat,
          lng: point.lng,
          realFix: { lat: train.lat, lng: train.lng },
          lastFixMs: Date.now(),
        };
      }
    }

    return {
      mode: 'heading',
      route: null,
      s: 0,
      direction: 1,
      lat: train.lat,
      lng: train.lng,
      realFix: { lat: train.lat, lng: train.lng },
      lastFixMs: Date.now(),
    };
  }

  function buildRouteGeometry(points) {
    if (!Array.isArray(points) || points.length < 2) return null;

    const route = {
      points,
      cumulative: [0],
      total: 0,
    };

    for (let i = 1; i < points.length; i += 1) {
      route.total += haversineMeters(points[i - 1], points[i]);
      route.cumulative.push(route.total);
    }

    return route.total > 0 ? route : null;
  }

  function interpolateRoutePoint(route, s) {
    if (!route || !route.points.length) return null;
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
    if (!route || route.points.length < 2) return null;

    let best = null;

    for (let i = 0; i < route.points.length - 1; i += 1) {
      const a = route.points[i];
      const b = route.points[i + 1];
      const proj = projectPointToSegment(point, a, b);
      const segStart = route.cumulative[i];
      const segLen = route.cumulative[i + 1] - route.cumulative[i];
      const s = segStart + (segLen * proj.t);

      if (!best || proj.distanceSq < best.distanceSq) {
        best = {
          s,
          distanceSq: proj.distanceSq,
        };
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

    return {
      t,
      distanceSq: (dx * dx) + (dy * dy),
    };
  }

  function pickRouteDirection(heading, route, s, fallbackDirection) {
    if (!route || route.total <= 0) return fallbackDirection || 1;

    const d = Math.min(8000, route.total * 0.02 + 1000);
    const pNow = interpolateRoutePoint(route, s);
    const pFwd = interpolateRoutePoint(route, clamp(s + d, 0, route.total));

    if (!pNow || !pFwd) return fallbackDirection || 1;

    const forwardBearing = bearingDegrees(pNow, pFwd);
    const forwardDiff = angularDiffDeg(heading, forwardBearing);
    const backwardDiff = angularDiffDeg(heading, (forwardBearing + 180) % 360);

    if (forwardDiff === backwardDiff && fallbackDirection) return fallbackDirection;
    return forwardDiff <= backwardDiff ? 1 : -1;
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

  function angularDiffDeg(a, b) {
    const diff = Math.abs((a - b) % 360);
    return diff > 180 ? 360 - diff : diff;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function pointFromBearing(origin, headingDeg, meters) {
    const R = 6378137;
    const heading = (headingDeg * Math.PI) / 180;
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
      // Ignore HUD event failures to avoid blocking map updates.
    }
  }

  // ── Public API ────────────────────────────────────────────────

  function init() {
    layer = MapModule.getTrainLayer();
    ensureStationIndex();
    fetchAndUpdate();
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

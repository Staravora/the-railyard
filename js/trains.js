/**
 * trains.js — Stability-first live train motion engine.
 */

const TrainsModule = (() => {
  const API_URL = 'https://api-v3.amtraker.com/v3/trains';
  const POLL_INTERVAL_MS = 30000;
  const SIM_TICK_MS = 1000;

  const MIN_OBS_MOVE_M = 45;
  const MAX_PREDICT_SEC = 20;
  const STALE_START_SEC = 10;
  const STALE_STOP_SEC = 32;

  const activeMarkers = new Map();
  let pollTimer = null;
  let simTimer = null;
  let layer = null;
  let map = null;

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

  function getStopName(stop) {
    return stop.stationName || stop.name || stop.code || '?';
  }

  function getStopArrISO(stop) {
    return stop.arrDT || stop.arr || null;
  }

  function getStopSchArrISO(stop) {
    return stop.schArrDT || stop.schArr || null;
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
          heading: normalizeHeading(run.heading || 0),
          delayMinutes,
          nextStop: nextStop ? getStopName(nextStop) : null,
          nextStopEta: nextStop ? (getStopArrISO(nextStop) || getStopSchArrISO(nextStop) || null) : null,
          origin: stops.length > 0 ? getStopName(stops[0]) : null,
          destination: stops.length > 0 ? getStopName(stops[stops.length - 1]) : null,
          progress: Math.max(0, Math.min(1, progress)),
          stops,
        });
      });
    }

    return trains;
  }

  function createState(train, nowMs) {
    return {
      anchorLat: train.lat,
      anchorLng: train.lng,
      anchorMs: nowMs,
      headingDeg: train.heading,
      speedMps: Math.max(0, train.speed) * 0.44704,
      lastObsLat: train.lat,
      lastObsLng: train.lng,
      lastObsMs: nowMs,
      hasMeasuredVector: false,
      stalePolls: 0,
    };
  }

  function reconcileState(state, train, nowMs) {
    const prevObs = { lat: state.lastObsLat, lng: state.lastObsLng };
    const nextObs = { lat: train.lat, lng: train.lng };
    const dtSec = Math.max(1, (nowMs - state.lastObsMs) / 1000);
    const moveM = haversineMeters(prevObs, nextObs);

    const feedMps = Math.max(0, train.speed) * 0.44704;

    if (moveM >= MIN_OBS_MOVE_M) {
      const measuredHeading = bearingDegrees(prevObs, nextObs);
      const measuredMps = moveM / dtSec;
      state.headingDeg = measuredHeading;
      state.speedMps = (measuredMps * 0.75) + (feedMps * 0.25);
      state.hasMeasuredVector = true;
      state.stalePolls = 0;
    } else if (feedMps <= 1.5) {
      state.speedMps = 0;
      state.hasMeasuredVector = false;
      state.stalePolls += 1;
    } else {
      state.stalePolls += 1;
      if (!state.hasMeasuredVector) {
        state.speedMps = 0;
      } else {
        const damp = state.stalePolls >= 2 ? 0.35 : 0.6;
        state.speedMps = Math.min(state.speedMps * damp, feedMps * damp);
      }
    }

    state.anchorLat = train.lat;
    state.anchorLng = train.lng;
    state.anchorMs = nowMs;
    state.lastObsLat = train.lat;
    state.lastObsLng = train.lng;
    state.lastObsMs = nowMs;
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
        reconcileState(entry.state, train, nowMs);

        entry.marker.setIcon(train.speed <= 5 ? makeStoppedIcon() : makeMovingIcon(entry.state.headingDeg, train.speed));
        entry.marker.setTooltipContent(tooltipContent(train));
        entry.marker.setLatLng([train.lat, train.lng]);
        entry.lastTickMs = nowMs;

        if (typeof TrainPanelModule !== 'undefined') {
          TrainPanelModule.update(train);
        }
      } else {
        const state = createState(train, nowMs);
        const marker = L.marker([train.lat, train.lng], {
          icon: train.speed <= 5 ? makeStoppedIcon() : makeMovingIcon(state.headingDeg, train.speed)
        });

        marker.bindTooltip(tooltipContent(train), {
          permanent: false,
          direction: 'top',
          className: 'train-tooltip',
          offset: [0, -14],
        });

        marker.on('click', () => {
          if (typeof TrainPanelModule !== 'undefined') {
            TrainPanelModule.open(activeMarkers.get(train.id)?.data || train);
          }
        });

        marker.addTo(layer);

        activeMarkers.set(train.id, {
          marker,
          data: train,
          state,
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
    applyDeclutter();
  }

  function simulateMovement() {
    const nowMs = Date.now();

    activeMarkers.forEach(entry => {
      const state = entry.state;
      if (!state) return;

      const dtSec = Math.max(0.2, Math.min(2, (nowMs - (entry.lastTickMs || nowMs)) / 1000));
      entry.lastTickMs = nowMs;

      const obsAgeSec = Math.max(0, (nowMs - state.anchorMs) / 1000);
      const ageHorizon = Math.min(MAX_PREDICT_SEC, (POLL_INTERVAL_MS / 1000) * 0.7);
      const predictSec = Math.min(obsAgeSec, ageHorizon);

      let speedMps = state.speedMps;
      if (obsAgeSec > STALE_START_SEC) {
        const t = Math.min(1, (obsAgeSec - STALE_START_SEC) / Math.max(1, STALE_STOP_SEC - STALE_START_SEC));
        speedMps *= (1 - t);
      }

      if (speedMps <= 0.4) {
        return;
      }

      const target = projectLatLng(
        state.anchorLat,
        state.anchorLng,
        state.headingDeg,
        speedMps / 0.44704,
        predictSec
      );

      const current = entry.marker.getLatLng();
      const alpha = 1 - Math.exp(-dtSec / 1.2);
      const next = {
        lat: current.lat + ((target.lat - current.lat) * alpha),
        lng: current.lng + ((target.lng - current.lng) * alpha),
      };

      entry.marker.setLatLng([next.lat, next.lng]);
    });

    applyDeclutter();
  }

  function applyDeclutter() {
    if (!map) return;

    const zoom = map.getZoom();
    if (zoom >= 7) {
      activeMarkers.forEach(entry => entry.marker.setOpacity(1));
      return;
    }

    const bounds = map.getBounds();
    const cellDeg = zoom <= 4 ? 4 : (zoom <= 5 ? 2.5 : 1.6);
    const keepByCell = new Map();

    activeMarkers.forEach(entry => {
      const ll = entry.marker.getLatLng();
      if (!bounds.pad(0.3).contains(ll)) {
        entry.marker.setOpacity(0);
        return;
      }

      const x = Math.floor((ll.lng + 180) / cellDeg);
      const y = Math.floor((ll.lat + 90) / cellDeg);
      const key = `${x}:${y}`;

      if (!keepByCell.has(key) || (entry.data.speed || 0) > (keepByCell.get(key).data.speed || 0)) {
        keepByCell.set(key, entry);
      }
    });

    const keepSet = new Set(keepByCell.values());
    activeMarkers.forEach(entry => {
      entry.marker.setOpacity(keepSet.has(entry) ? 1 : 0.15);
    });
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

    const spotlight = pickSpotlightTrain(trains);

    try {
      document.dispatchEvent(new CustomEvent('railyard:train-stats', {
        detail: {
          activeCount,
          delayedCount,
          onTimePct,
          updatedAt: new Date().toISOString(),
          spotlight,
        }
      }));
    } catch {
      // Ignore HUD event failures.
    }
  }

  function pickSpotlightTrain(trains) {
    if (!trains.length) return null;

    const ranked = [...trains].sort((a, b) => {
      const scoreA = (a.speed || 0) + ((a.delayMinutes > 0 ? a.delayMinutes : 0) * 0.8);
      const scoreB = (b.speed || 0) + ((b.delayMinutes > 0 ? b.delayMinutes : 0) * 0.8);
      return scoreB - scoreA;
    });

    const t = ranked[0];
    return {
      id: t.id,
      routeName: t.routeName,
      trainNumber: t.trainNumber,
      speed: t.speed,
      delayMinutes: t.delayMinutes,
      nextStop: t.nextStop,
    };
  }

  function normalizeHeading(value) {
    const h = Number(value) || 0;
    return ((h % 360) + 360) % 360;
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

  function init() {
    layer = MapModule.getTrainLayer();
    map = MapModule.getMap();
    fetchAndUpdate();
    pollTimer = setInterval(fetchAndUpdate, POLL_INTERVAL_MS);
    simTimer = setInterval(simulateMovement, SIM_TICK_MS);

    map.on('zoomend moveend', applyDeclutter);
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

/**
 * trains.js — Poll Amtraker API + custom continuous motion engine
 */

const TrainsModule = (() => {
  const API_URL = 'https://api-v3.amtraker.com/v3/trains';
  const POLL_INTERVAL_MS = 30000;
  const SIM_TICK_MS = 1000;
  const SMOOTH_TIME_SEC = 1.6;
  const MIN_VECTOR_MOVE_M = 60;
  const MAX_PREDICT_HORIZON_SEC = 15;

  const activeMarkers = new Map();
  let pollTimer = null;
  let simTimer = null;
  let layer = null;

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
        const nextStop = stops.find(s => {
          const arr = getStopArrISO(s);
          return !arr || new Date(arr) > new Date();
        });

        let delayMinutes = 0;
        const lastUpdated = stops.findLast ? stops.findLast(s => getStopArrISO(s)) : null;
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

        updateMotionFromApi(entry.motion, train, nowMs);
        entry.marker.setLatLng([train.lat, train.lng]);
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

        activeMarkers.set(train.id, {
          marker,
          data: train,
          motion: createMotionState(train, nowMs),
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

  function createMotionState(train, nowMs) {
    return {
      apiLat: train.lat,
      apiLng: train.lng,
      apiMs: nowMs,
      heading: train.heading || 0,
      speed: Math.max(0, train.speed || 0),
      hasTrackVector: false,
      trackHeading: train.heading || 0,
      trackSpeed: Math.max(0, train.speed || 0),
      stalePolls: 0,
    };
  }

  function updateMotionFromApi(motion, train, nowMs) {
    const prev = { lat: motion.apiLat, lng: motion.apiLng };
    const next = { lat: train.lat, lng: train.lng };

    const movedMeters = haversineMeters(prev, next);
    const deltaSec = Math.max(1, (nowMs - motion.apiMs) / 1000);

    if (movedMeters >= MIN_VECTOR_MOVE_M) {
      motion.hasTrackVector = true;
      motion.trackHeading = bearingDegrees(prev, next);
      motion.trackSpeed = (movedMeters / deltaSec) * 2.236936;
      motion.stalePolls = 0;
    } else {
      motion.stalePolls += 1;
    }

    motion.apiLat = train.lat;
    motion.apiLng = train.lng;
    motion.apiMs = nowMs;
    motion.heading = normalizeHeading(train.heading || motion.heading || 0);
    motion.speed = Math.max(0, train.speed || 0);
  }

  function simulateMovement() {
    const nowMs = Date.now();
    const map = typeof MapModule !== 'undefined' ? MapModule.getMap() : null;
    const zoom = map ? map.getZoom() : 5;

    activeMarkers.forEach(entry => {
      const train = entry.data;
      const motion = entry.motion;
      if (!train || !motion || motion.speed <= 2) return;

      const dtSec = Math.max(0.1, Math.min(2, (nowMs - (entry.lastTickMs || nowMs)) / 1000));
      entry.lastTickMs = nowMs;

      const sinceApiSec = Math.max(0, (nowMs - motion.apiMs) / 1000);
      const horizonSec = Math.min(MAX_PREDICT_HORIZON_SEC, (POLL_INTERVAL_MS / 1000) * 0.5);
      const projectionSec = Math.min(sinceApiSec, horizonSec);

      let heading = motion.heading;
      let speedMph = motion.speed;

      if (motion.hasTrackVector) {
        heading = motion.trackHeading;
        speedMph = (motion.trackSpeed * 0.65) + (motion.speed * 0.35);
      } else {
        speedMph = 0;
      }

      if (motion.stalePolls >= 2) {
        speedMph = Math.min(speedMph, 8);
      }

      const projected = projectLatLng(motion.apiLat, motion.apiLng, heading, speedMph, projectionSec);
      const driftCap = getDriftCapMeters(zoom, speedMph, horizonSec);
      const distFromFix = haversineMeters({ lat: motion.apiLat, lng: motion.apiLng }, projected);
      const target = distFromFix > driftCap
        ? pointFromBearing({ lat: motion.apiLat, lng: motion.apiLng }, heading, driftCap)
        : projected;

      const current = entry.marker.getLatLng();
      const alpha = 1 - Math.exp(-dtSec / SMOOTH_TIME_SEC);
      const next = {
        lat: current.lat + ((target.lat - current.lat) * alpha),
        lng: current.lng + ((target.lng - current.lng) * alpha),
      };

      entry.marker.setLatLng([next.lat, next.lng]);
    });
  }

  function getDriftCapMeters(zoom, mph, horizonSec) {
    const speedBased = mph * 0.44704 * horizonSec * 1.05;
    if (zoom >= 11) return Math.min(350, speedBased);
    if (zoom >= 9) return Math.min(700, speedBased);
    if (zoom >= 7) return Math.min(1400, speedBased);
    return Math.min(2500, speedBased);
  }

  function normalizeHeading(value) {
    const h = Number(value) || 0;
    return ((h % 360) + 360) % 360;
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

  function init() {
    layer = MapModule.getTrainLayer();
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

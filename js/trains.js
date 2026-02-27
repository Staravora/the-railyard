/**
 * trains.js — Accuracy-first live train pins.
 * Positions are updated only from API fixes (no in-between simulation).
 */

const TrainsModule = (() => {
  const API_URL = 'https://api-v3.amtraker.com/v3/trains';
  const POLL_INTERVAL_MS = 10000;
  const MIN_HEADING_MOVE_M = 25;

  const activeMarkers = new Map(); // id -> { marker, data, heading }
  let pollTimer = null;
  let layer = null;
  let map = null;
  let lastSuccessfulPollMs = 0;

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

  function normalizeHeading(value) {
    const h = Number(value) || 0;
    return ((h % 360) + 360) % 360;
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

  async function fetchAndUpdate() {
    let raw;
    try {
      const res = await fetch(API_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      raw = await res.json();
    } catch (err) {
      console.warn('[trains] fetch failed:', err.message);
      publishStaleStats();
      return;
    }

    const nowMs = Date.now();
    lastSuccessfulPollMs = nowMs;
    const trains = normalizeResponse(raw);
    const seenIds = new Set();

    trains.forEach(train => {
      seenIds.add(train.id);

      if (activeMarkers.has(train.id)) {
        const entry = activeMarkers.get(train.id);
        const heading = deriveHeading(entry.data, train, entry.heading);
        entry.heading = heading;
        entry.data = train;

        entry.marker.setIcon(train.speed <= 5 ? makeStoppedIcon() : makeMovingIcon(heading, train.speed));
        entry.marker.setTooltipContent(tooltipContent(train));
        entry.marker.setLatLng([train.lat, train.lng]);

        if (typeof TrainPanelModule !== 'undefined') {
          TrainPanelModule.update(train);
        }
      } else {
        const heading = train.heading;
        const marker = L.marker([train.lat, train.lng], {
          icon: train.speed <= 5 ? makeStoppedIcon() : makeMovingIcon(heading, train.speed)
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
          heading,
        });
      }
    });

    for (const [id, entry] of activeMarkers.entries()) {
      if (!seenIds.has(id)) {
        entry.marker.remove();
        activeMarkers.delete(id);
      }
    }

    applyDeclutter();
    publishStats(trains, false);
  }

  function deriveHeading(prevTrain, nextTrain, fallbackHeading) {
    if (!prevTrain) return normalizeHeading(nextTrain.heading || fallbackHeading || 0);

    const movedMeters = haversineMeters(
      { lat: prevTrain.lat, lng: prevTrain.lng },
      { lat: nextTrain.lat, lng: nextTrain.lng }
    );

    if (movedMeters >= MIN_HEADING_MOVE_M) {
      return bearingDegrees(
        { lat: prevTrain.lat, lng: prevTrain.lng },
        { lat: nextTrain.lat, lng: nextTrain.lng }
      );
    }

    return normalizeHeading(nextTrain.heading || fallbackHeading || 0);
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

  function publishStats(trains, stale) {
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
          updatedAt: new Date(lastSuccessfulPollMs || Date.now()).toISOString(),
          spotlight: pickSpotlightTrain(trains),
          stale,
        }
      }));
    } catch {
      // Ignore HUD event failures.
    }
  }

  function publishStaleStats() {
    const trains = [...activeMarkers.values()].map(entry => entry.data).filter(Boolean);
    publishStats(trains, true);
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
    map.on('zoomend moveend', applyDeclutter);
  }

  function stop() {
    clearInterval(pollTimer);
  }

  function getMarkerData(trainId) {
    return activeMarkers.get(trainId)?.data || null;
  }

  return { init, stop, getMarkerData };
})();

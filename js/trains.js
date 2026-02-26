/**
 * trains.js — Poll Amtraker API, manage markers, interpolate positions
 */

const TrainsModule = (() => {
  const API_URL = 'https://api-v3.amtraker.com/v3/trains';
  const POLL_INTERVAL_MS = 30000;

  // Map from train key → { marker, el, popup, data, animFrame }
  const activeMarkers = new Map();
  let pollTimer = null;
  let layer = null;

  // ── Icon helpers ──────────────────────────────────────────────

  function speedColor(speed) {
    if (speed >= 60) return '#22c55e';
    if (speed >= 20) return '#eab308';
    return '#ef4444';
  }

  function makeMarkerEl() {
    const el = document.createElement('div');
    el.style.cssText = 'cursor: pointer; width: 24px; height: 24px;';
    return el;
  }

  function updateMarkerEl(el, train) {
    const isStopped = train.speed <= 5;
    if (isStopped) {
      el.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" style="display:block;margin:4px auto;">
        <circle cx="8" cy="8" r="7" fill="#94a3b8" stroke="white" stroke-width="1.5"/>
        <rect x="5" y="5" width="6" height="6" fill="white" rx="1"/>
      </svg>`;
    } else {
      const color = speedColor(train.speed);
      const rot = train.heading || 0;
      el.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" style="transform:rotate(${rot}deg);display:block;">
        <path d="M12 2 L20 20 L12 16 L4 20 Z" fill="${color}" stroke="white" stroke-width="1.5"/>
      </svg>`;
    }
  }

  // ── Smooth position animation ─────────────────────────────────

  function animateMarker(entry, newLat, newLng) {
    if (entry.animFrame) cancelAnimationFrame(entry.animFrame);
    const start = entry.marker.getLngLat();
    const startLng = start.lng;
    const startLat = start.lat;
    const startTime = performance.now();
    const duration = 29000;

    function step(now) {
      const t = Math.min((now - startTime) / duration, 1);
      entry.marker.setLngLat([
        startLng + (newLng - startLng) * t,
        startLat + (newLat - startLat) * t,
      ]);
      if (t < 1) entry.animFrame = requestAnimationFrame(step);
    }
    entry.animFrame = requestAnimationFrame(step);
  }

  // ── Normalize API response ────────────────────────────────────

  function normalizeResponse(raw) {
    const trains = [];

    for (const [trainNum, runs] of Object.entries(raw)) {
      if (!Array.isArray(runs)) continue;

      runs.forEach((run, idx) => {
        if (run.lat == null || run.lon == null) return;

        const stops = Array.isArray(run.stations) ? run.stations : [];
        const nextStop = stops.find(s => !s.arrDT || new Date(s.arrDT) > new Date());

        let delayMinutes = 0;
        const lastUpdated = stops.findLast ? stops.findLast(s => s.arrDT) : null;
        if (lastUpdated && lastUpdated.arrDT && lastUpdated.schArrDT) {
          delayMinutes = Math.round(
            (new Date(lastUpdated.arrDT) - new Date(lastUpdated.schArrDT)) / 60000
          );
        }
        if (run.eventAr != null) delayMinutes = Math.round(run.eventAr);

        const nextStopIdx = nextStop ? stops.indexOf(nextStop) : stops.length;
        const progress = stops.length > 0 ? nextStopIdx / stops.length : 0;

        trains.push({
          id: `${trainNum}-${idx}`,
          trainNumber: trainNum,
          routeName: run.routeName || run.trainName || `Train ${trainNum}`,
          lat: run.lat,
          lng: run.lon,
          speed: run.velocity != null ? Math.round(run.velocity) : 0,
          heading: run.heading || 0,
          delayMinutes,
          nextStop: nextStop ? (nextStop.stationName || nextStop.code) : null,
          nextStopEta: nextStop ? (nextStop.arrDT || nextStop.schArrDT || null) : null,
          origin: stops.length > 0 ? (stops[0].stationName || stops[0].code) : null,
          destination: stops.length > 0 ? (stops[stops.length - 1].stationName || stops[stops.length - 1].code) : null,
          progress: Math.max(0, Math.min(1, progress)),
          stops,
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

        // Update icon
        updateMarkerEl(entry.el, train);

        // Animate to new position (lng, lat order for MapLibre)
        animateMarker(entry, train.lat, train.lng);

        // Update popup content
        entry.popup.setHTML(tooltipContent(train));
        entry.data = train;

        // Update panel if this train is currently open
        if (typeof TrainPanelModule !== 'undefined') {
          TrainPanelModule.update(train);
        }
      } else {
        // Create new marker
        const el = makeMarkerEl();
        updateMarkerEl(el, train);

        const popup = new maplibregl.Popup({
          offset: 14,
          closeButton: false,
          closeOnClick: false,
          className: 'train-tooltip-popup',
        }).setHTML(tooltipContent(train));

        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([train.lng, train.lat])
          .addTo(layer);

        el.addEventListener('mouseenter', () => popup.setLngLat(marker.getLngLat()).addTo(layer));
        el.addEventListener('mouseleave', () => popup.remove());
        el.addEventListener('click', e => {
          e.stopPropagation();
          if (typeof TrainPanelModule !== 'undefined') TrainPanelModule.open(train);
        });

        activeMarkers.set(train.id, { marker, el, popup, data: train, animFrame: null });
      }
    });

    // Remove departed trains
    for (const [id, entry] of activeMarkers.entries()) {
      if (!seenIds.has(id)) {
        if (entry.animFrame) cancelAnimationFrame(entry.animFrame);
        entry.popup.remove();
        entry.marker.remove();
        activeMarkers.delete(id);
      }
    }
  }

  function tooltipContent(train) {
    const delay = train.delayMinutes > 0
      ? `<span style="color:#ef4444">+${train.delayMinutes}m late</span>`
      : `<span style="color:#22c55e">On time</span>`;
    return `<b>${train.routeName} #${train.trainNumber}</b><br>${train.speed} mph · ${delay}`;
  }

  // ── Public API ────────────────────────────────────────────────

  function init() {
    layer = MapModule.getTrainLayer();
    fetchAndUpdate();
    pollTimer = setInterval(fetchAndUpdate, POLL_INTERVAL_MS);
  }

  function stop() {
    clearInterval(pollTimer);
  }

  function getMarkerData(trainId) {
    return activeMarkers.get(trainId)?.data || null;
  }

  return { init, stop, getMarkerData };
})();

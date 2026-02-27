/**
 * amtrakProvider.js — Adapter for Amtraker v3 feed.
 */

const AmtrakProvider = (() => {
  const API_URL = 'https://api-v3.amtraker.com/v3/trains';

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

        const baseId = run.trainID || `${trainNum}-${idx}`;
        trains.push({
          id: `amtrak:${baseId}`,
          externalId: String(baseId),
          provider: 'amtrak',
          providerLabel: 'Amtrak',
          country: 'US',
          operator: 'Amtrak',
          trainNumber: String(trainNum),
          routeName: run.routeName || run.trainName || `Train ${trainNum}`,
          lat: Number(run.lat),
          lng: Number(run.lon),
          speed: run.velocity != null ? Math.round(run.velocity) : 0,
          heading: normalizeHeading(run.heading || 0),
          delayMinutes,
          nextStop: nextStop ? getStopName(nextStop) : null,
          nextStopEta: nextStop ? (getStopArrISO(nextStop) || getStopSchArrISO(nextStop) || null) : null,
          origin: stops.length > 0 ? getStopName(stops[0]) : null,
          destination: stops.length > 0 ? getStopName(stops[stops.length - 1]) : null,
          progress: Math.max(0, Math.min(1, progress)),
          stops,
          updatedAt: new Date().toISOString(),
        });
      });
    }

    return trains;
  }

  async function fetchTrains() {
    const res = await fetch(API_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    return normalizeResponse(raw);
  }

  return {
    id: 'amtrak',
    label: 'Amtrak',
    country: 'US',
    enabled: true,
    fetchTrains,
  };
})();

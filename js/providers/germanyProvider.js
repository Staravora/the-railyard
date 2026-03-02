/**
 * germanyProvider.js — Adapter for Germany (DB / gtfs.de) train data.
 *
 * Data flows through a Firebase Cloud Function that fetches the gtfs.de
 * GTFS-RT VehiclePositions feed (binary protobuf) and returns parsed JSON.
 *
 * After deploying the Firebase Function, paste its URL into FUNCTION_URL below.
 * Deploy: cd /path/to/train-app && firebase deploy --only functions
 */

const GermanyProvider = (() => {
  // Replace with the actual URL after running: firebase deploy --only functions
  const FUNCTION_URL = 'https://us-central1-therailyard-d5132.cloudfunctions.net/getGermanyTrains';

  function toMph(mps) {
    return mps == null ? 0 : Math.round(Number(mps) * 2.23694);
  }

  function normalizeHeading(v) {
    const h = Number(v) || 0;
    return ((h % 360) + 360) % 360;
  }

  function normalizeTrain(raw) {
    const trainId = raw.routeId
      ? raw.routeId.replace(/\s+/g, '-')
      : raw.trainNumber || raw.tripId?.slice(0, 8) || '?';

    return {
      id: `germany:${trainId}-${raw.tripId?.slice(-6) || '0'}`,
      externalId: raw.tripId || trainId,
      provider: 'germany',
      providerLabel: 'DB / gtfs.de',
      country: 'DE',
      operator: 'DB',
      trainNumber: raw.trainNumber || raw.tripId?.slice(0, 8) || '?',
      routeName: raw.routeName || raw.routeId || `Train ${raw.trainNumber}`,
      lat: raw.lat,
      lng: raw.lng,
      speed: toMph(raw.speed),
      heading: normalizeHeading(raw.bearing),
      delayMinutes: 0,
      nextStop: null,
      nextStopEta: null,
      origin: null,
      destination: null,
      progress: 0,
      stops: [],
      updatedAt: raw.timestamp
        ? new Date(raw.timestamp * 1000).toISOString()
        : new Date().toISOString(),
    };
  }

  async function fetchTrains() {
    const res = await fetch(FUNCTION_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Germany Function HTTP ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json.trains)) throw new Error('Germany Function: unexpected response shape');
    return json.trains
      .filter(t => t.lat && t.lng)
      .map(normalizeTrain);
  }

  return {
    id: 'germany',
    label: 'DB (Germany)',
    country: 'DE',
    enabled: true,
    fetchTrains,
  };
})();

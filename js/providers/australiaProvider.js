/**
 * australiaProvider.js — Adapter for Transport for NSW (Australia) train data.
 *
 * Data source: Transport for NSW GTFS-RT VehiclePositions
 *   https://api.transport.nsw.gov.au/v1/gtfs-realtime/vehiclepos/train
 *
 * Requires a free API key from: https://opendata.transport.nsw.gov.au/
 * The key is stored server-side in the Firebase Function (NSW_API_KEY env var).
 *
 * Standard GTFS-RT field numbers — no quirks.
 */

const AustraliaProvider = (() => {
  const FUNCTION_URL = 'https://us-central1-therailyard-d5132.cloudfunctions.net/getAustraliaTrains';

  function toMph(mps) {
    return mps == null ? 0 : Math.round(Number(mps) * 2.23694);
  }

  function normalizeHeading(v) {
    const h = Number(v) || 0;
    return ((h % 360) + 360) % 360;
  }

  function normalizeTrain(raw) {
    // NSW trip IDs are typically like "TRS_SYD_123456789" or numeric strings.
    // routeId is the line code (e.g. "BMT" for Blue Mountains).
    const routeId = raw.routeId || '';
    const tripId  = raw.tripId  || '';

    const trainNumber = raw.trainNumber || tripId.slice(0, 8) || '?';
    const routeName   = routeId ? `NSW ${routeId}` : `Train ${trainNumber}`;

    return {
      id: `australia:${tripId || trainNumber}`,
      externalId: tripId,
      provider: 'australia',
      providerLabel: 'Transport for NSW',
      country: 'AU',
      operator: 'NSW Trains',
      trainNumber,
      routeName,
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
    if (!res.ok) throw new Error(`Australia Function HTTP ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json.trains)) throw new Error('Australia Function: unexpected response shape');
    return json.trains
      .filter(t => t.lat && t.lng)
      .map(normalizeTrain);
  }

  return {
    id: 'australia',
    label: 'Transport for NSW',
    country: 'AU',
    enabled: true,
    fetchTrains,
  };
})();

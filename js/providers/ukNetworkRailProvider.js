/**
 * ukNetworkRailProvider.js — UK live provider via proxy endpoint.
 *
 * Expected response from proxy:
 * {
 *   "trains": [
 *     {
 *       "id": "...",
 *       "lat": 51.5,
 *       "lng": -0.12,
 *       "speedKph": 85,
 *       "heading": 120,
 *       "trainNumber": "1A23",
 *       "routeName": "London Euston -> Manchester Piccadilly",
 *       "operator": "Avanti West Coast",
 *       "delayMinutes": 4,
 *       "nextStop": "Milton Keynes Central",
 *       "nextStopEta": "2026-02-27T15:42:00Z",
 *       "origin": "London Euston",
 *       "destination": "Manchester Piccadilly",
 *       "progress": 0.33,
 *       "updatedAt": "2026-02-27T15:31:12Z"
 *     }
 *   ]
 * }
 */

const UkNetworkRailProvider = (() => {
  const DEFAULT_URL = '';

  function normalizeHeading(value) {
    const h = Number(value) || 0;
    return ((h % 360) + 360) % 360;
  }

  function endpoint() {
    if (typeof window !== 'undefined') {
      const runtime = window.RAILYARD_PROVIDER_ENDPOINTS;
      if (runtime && runtime.ukNetworkRail) return runtime.ukNetworkRail;

      try {
        const fromStorage = window.localStorage.getItem('railyard.ukNetworkRail.endpoint');
        if (fromStorage) return fromStorage;
      } catch {
        // Ignore storage access issues.
      }
    }
    return DEFAULT_URL;
  }

  function isConfigured() {
    return Boolean(endpoint());
  }

  function parsePayload(payload) {
    const rows = Array.isArray(payload?.trains) ? payload.trains : [];

    return rows
      .filter(row => row && row.lat != null && row.lng != null)
      .map((row, idx) => {
        const externalId = row.id || row.trainNumber || `uk-${idx}`;
        const speedMph = row.speedMph != null
          ? Number(row.speedMph)
          : (row.speedKph != null ? Math.round(Number(row.speedKph) * 0.621371) : 0);

        return {
          id: `uk-networkrail:${externalId}`,
          externalId: String(externalId),
          provider: 'uk-networkrail',
          providerLabel: 'Network Rail',
          country: 'UK',
          operator: row.operator || 'National Rail',
          trainNumber: String(row.trainNumber || '?'),
          routeName: row.routeName || row.serviceName || `UK Service ${row.trainNumber || idx}`,
          lat: Number(row.lat),
          lng: Number(row.lng),
          speed: Number.isFinite(speedMph) ? Math.max(0, Math.round(speedMph)) : 0,
          heading: normalizeHeading(row.heading || 0),
          delayMinutes: Number.isFinite(Number(row.delayMinutes)) ? Math.round(Number(row.delayMinutes)) : 0,
          nextStop: row.nextStop || null,
          nextStopEta: row.nextStopEta || null,
          origin: row.origin || null,
          destination: row.destination || null,
          progress: Number.isFinite(Number(row.progress)) ? Math.max(0, Math.min(1, Number(row.progress))) : 0,
          stops: Array.isArray(row.stops) ? row.stops : [],
          updatedAt: row.updatedAt || new Date().toISOString(),
        };
      });
  }

  async function fetchTrains() {
    const url = endpoint();
    if (!url) return [];

    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    return parsePayload(payload);
  }

  return {
    id: 'uk-networkrail',
    label: 'Network Rail',
    country: 'UK',
    enabled: isConfigured(),
    fetchTrains,
  };
})();

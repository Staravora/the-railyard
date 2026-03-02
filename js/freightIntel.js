/**
 * freightIntel.js — Practical freight signals (non-GPS).
 */

const FreightIntelModule = (() => {
  const SIGNALS = [
    {
      label: 'AAR Weekly Rail Traffic',
      detail: 'North American carload/intermodal trend pulse.',
      url: 'https://www.aar.org/data-center/rail-traffic-data/',
    },
    {
      label: 'Railroad Radio Directory',
      detail: 'Dispatch/audio feeds by region and subdivision.',
      url: 'https://www.broadcastify.com/listen/ctid/1',
    },
    {
      label: 'BNSF Service Advisories',
      detail: 'Network interruptions, weather, and congestion notices.',
      url: 'https://www.bnsf.com/news-media/customer-notifications.html',
    },
    {
      label: 'Union Pacific Newsroom',
      detail: 'Operational updates and corridor-impacting incidents.',
      url: 'https://www.up.com/aboutup/community/inside_track/index.htm',
    },
  ];

  const FREIGHT_KEYWORDS = [
    'bnsf', 'union pacific', 'norfolk southern', 'csx', 'canadian national',
    'cpkc', 'canadian pacific', 'kcs', 'ferromex', 'freight', 'manifest', 'intermodal',
  ];

  function init() {
    const signalsHost = document.getElementById('freightSignals');
    if (signalsHost) renderSignals(signalsHost);

    renderSpotterSummary();
    document.addEventListener('railyard:spotter-updated', renderSpotterSummary);
  }

  function renderSignals(host) {
    host.innerHTML = SIGNALS.map(signal => `
      <a class="freight-signal-card" href="${escapeAttr(signal.url)}" target="_blank" rel="noopener noreferrer">
        <span class="freight-signal-title">${escapeHtml(signal.label)}</span>
        <span class="freight-signal-detail">${escapeHtml(signal.detail)}</span>
      </a>
    `).join('');
  }

  function renderSpotterSummary() {
    const container = document.getElementById('freightSpotterSummary');
    if (!container) return;

    const entries = readSpotterEntries();
    const freightEntries = entries.filter(entry => isFreightEntry(entry));

    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const recentFreight = freightEntries.filter(entry => {
      const timestamp = extractEntryMs(entry);
      return Number.isFinite(timestamp) && (now - timestamp) <= sevenDaysMs;
    });

    const byRoad = new Map();
    freightEntries.forEach(entry => {
      const name = normalizeRailroadName(entry.railroad);
      if (!name) return;
      byRoad.set(name, (byRoad.get(name) || 0) + 1);
    });

    const topRoad = [...byRoad.entries()].sort((a, b) => b[1] - a[1])[0] || null;
    const lastSight = freightEntries
      .map(entry => ({ entry, at: extractEntryMs(entry) }))
      .filter(item => Number.isFinite(item.at))
      .sort((a, b) => b.at - a.at)[0] || null;

    container.innerHTML = `
      <div class="freight-summary-grid">
        <div class="freight-stat">
          <span class="freight-stat-label">Freight Logs (7d)</span>
          <strong class="freight-stat-value">${recentFreight.length}</strong>
        </div>
        <div class="freight-stat">
          <span class="freight-stat-label">Freight Logs (all)</span>
          <strong class="freight-stat-value">${freightEntries.length}</strong>
        </div>
        <div class="freight-stat">
          <span class="freight-stat-label">Top Railroad</span>
          <strong class="freight-stat-value">${topRoad ? escapeHtml(topRoad[0]) : '—'}</strong>
        </div>
      </div>
      <p class="freight-summary-note">
        ${lastSight
          ? `Latest freight-tagged sighting: ${escapeHtml(formatWhen(lastSight.at))} • ${escapeHtml(normalizeRailroadName(lastSight.entry.railroad) || 'Unknown railroad')}`
          : 'No freight sightings logged yet. Add entries in Spotter Log to build corridor intel.'}
      </p>
    `;
  }

  function isFreightEntry(entry) {
    const text = `${entry?.railroad || ''} ${entry?.notes || ''}`.toLowerCase();
    return FREIGHT_KEYWORDS.some(keyword => text.includes(keyword));
  }

  function normalizeRailroadName(value) {
    if (!value) return '';
    return String(value).trim().replace(/\s+/g, ' ');
  }

  function readSpotterEntries() {
    try {
      const raw = JSON.parse(localStorage.getItem('trainSpotterLog') || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  function extractEntryMs(entry) {
    if (!entry) return NaN;
    if (entry.createdAt) {
      const created = Date.parse(entry.createdAt);
      if (Number.isFinite(created)) return created;
    }

    const date = (entry.date || '').trim();
    const time = (entry.time || '').trim();
    if (!date) return NaN;

    const iso = `${date}T${time || '00:00'}:00`;
    const parsed = Date.parse(iso);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function formatWhen(ms) {
    const date = new Date(ms);
    return date.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  return { init };
})();

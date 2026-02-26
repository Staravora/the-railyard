/**
 * spotterLog.js — Spotter sighting log with localStorage persistence
 */

const SpotterLogModule = (() => {
  const STORAGE_KEY = 'trainSpotterLog';
  let entries = [];
  let logModeActive = false;
  let pendingCoords = null;
  let layer = null;
  let map = null;
  const pinMarkers = new Map(); // id → marker

  // ── Init ──────────────────────────────────────────────────────

  function init() {
    layer = MapModule.getSpotterLayer();
    map = MapModule.getMap();

    entries = loadEntries();

    // Form submission (Spotter tab)
    document.getElementById('spotterForm').addEventListener('submit', e => {
      e.preventDefault();
      submitTabForm();
    });

    document.getElementById('clearFormBtn').addEventListener('click', clearTabForm);

    // Modal form (from map click)
    document.getElementById('modalSpotterForm').addEventListener('submit', e => {
      e.preventDefault();
      submitModalForm();
    });

    document.getElementById('modalCancelBtn').addEventListener('click', closeModal);

    // Log mode toggle
    document.getElementById('logModeBtn').addEventListener('click', toggleLogMode);
    document.getElementById('logModeCancelBtn').addEventListener('click', disableLogMode);

    // Search filter
    document.getElementById('spotterSearch').addEventListener('input', e => {
      renderList(e.target.value.trim().toLowerCase());
    });

    // Export
    document.getElementById('exportBtn').addEventListener('click', exportJSON);

    // Map click in log mode
    map.on('click', onMapClick);

    // Set today's date as default
    const today = new Date().toISOString().slice(0, 10);
    document.getElementById('spotDate').value = today;
    document.getElementById('mDate').value = today;

    renderList();
    renderMapPins();
  }

  // ── Log Mode ─────────────────────────────────────────────────

  function toggleLogMode() {
    logModeActive ? disableLogMode() : enableLogMode();
  }

  function enableLogMode() {
    logModeActive = true;
    document.getElementById('logModeBtn').classList.add('active');
    document.getElementById('logModeBanner').hidden = false;
    map.getContainer().style.cursor = 'crosshair';
  }

  function disableLogMode() {
    logModeActive = false;
    document.getElementById('logModeBtn').classList.remove('active');
    document.getElementById('logModeBanner').hidden = true;
    map.getContainer().style.cursor = '';
    pendingCoords = null;
  }

  function onMapClick(e) {
    if (!logModeActive) return;

    const { lat, lng } = e.latlng;
    pendingCoords = { lat: lat.toFixed(5), lng: lng.toFixed(5) };

    openModal(pendingCoords);
    disableLogMode();
  }

  // ── Modal ─────────────────────────────────────────────────────

  async function openModal(coords) {
    const modal = document.getElementById('spotterModal');
    const locEl = document.getElementById('modalLocation');

    locEl.textContent = `${coords.lat}, ${coords.lng} — loading address…`;
    modal.hidden = false;

    // Reverse geocode
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${coords.lat}&lon=${coords.lng}&format=json`;
      const res = await fetch(url, {
        headers: { 'Accept-Language': 'en', 'User-Agent': 'TrainSpotterApp/1.0' }
      });
      const data = await res.json();
      const display = data.display_name || `${coords.lat}, ${coords.lng}`;
      locEl.textContent = display;
      pendingCoords.displayName = display;
    } catch {
      locEl.textContent = `${coords.lat}, ${coords.lng}`;
    }
  }

  function closeModal() {
    document.getElementById('spotterModal').hidden = true;
    document.getElementById('modalSpotterForm').reset();
    pendingCoords = null;
    // Reset date
    document.getElementById('mDate').value = new Date().toISOString().slice(0, 10);
  }

  function submitModalForm() {
    if (!pendingCoords) return;

    const entry = {
      id: crypto.randomUUID(),
      date: document.getElementById('mDate').value,
      lat: parseFloat(pendingCoords.lat),
      lng: parseFloat(pendingCoords.lng),
      displayName: pendingCoords.displayName || `${pendingCoords.lat}, ${pendingCoords.lng}`,
      locomotiveNumber: document.getElementById('mLocoNumber').value.trim(),
      railroad: document.getElementById('mRailroad').value.trim(),
      notes: document.getElementById('mNotes').value.trim(),
      createdAt: new Date().toISOString(),
    };

    addEntry(entry);
    closeModal();
  }

  // ── Tab Form ─────────────────────────────────────────────────

  function submitTabForm() {
    const lat = parseFloat(document.getElementById('spotLat').value);
    const lng = parseFloat(document.getElementById('spotLng').value);

    const entry = {
      id: crypto.randomUUID(),
      date: document.getElementById('spotDate').value,
      lat: isNaN(lat) ? null : lat,
      lng: isNaN(lng) ? null : lng,
      displayName: null,
      locomotiveNumber: document.getElementById('locoNumber').value.trim(),
      railroad: document.getElementById('railroad').value.trim(),
      notes: document.getElementById('spotNotes').value.trim(),
      createdAt: new Date().toISOString(),
    };

    addEntry(entry);
    clearTabForm();
  }

  function clearTabForm() {
    document.getElementById('spotterForm').reset();
    document.getElementById('spotDate').value = new Date().toISOString().slice(0, 10);
    document.getElementById('coordHint').textContent = '';
  }

  // ── CRUD ─────────────────────────────────────────────────────

  function loadEntries() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch {
      return [];
    }
  }

  function saveEntries() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }

  function addEntry(entry) {
    entries.unshift(entry); // newest first
    saveEntries();
    renderList();
    renderMapPins();
  }

  function deleteEntry(id) {
    entries = entries.filter(e => e.id !== id);
    saveEntries();
    renderList();
    renderMapPins();
  }

  function filterEntries(query) {
    if (!query) return entries;
    return entries.filter(e => {
      const haystack = [
        e.locomotiveNumber, e.railroad, e.notes, e.displayName, e.date
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }

  // ── Render List ───────────────────────────────────────────────

  function renderList(query = '') {
    const listEl = document.getElementById('spotterList');
    const filtered = filterEntries(query);

    if (filtered.length === 0) {
      listEl.innerHTML = `<p class="empty-state">${query ? 'No entries match your search.' : 'No sightings logged yet. Add your first entry!'}</p>`;
      return;
    }

    listEl.innerHTML = filtered.map(entry => {
      const date = entry.date ? new Date(entry.date + 'T12:00:00').toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
      const loco = entry.locomotiveNumber || '—';
      const rr = entry.railroad || '—';
      const loc = entry.displayName || (entry.lat != null ? `${entry.lat}, ${entry.lng}` : '—');
      const notes = entry.notes ? `<div class="entry-notes">${esc(entry.notes)}</div>` : '';

      return `<div class="spotter-entry" data-id="${esc(entry.id)}">
        <div class="entry-main">
          <div class="entry-loco">#${esc(loco)}</div>
          <div class="entry-railroad">${esc(rr)}</div>
          <div class="entry-meta">
            <span>📅 ${date}</span>
            ${loc !== '—' ? `<span>📍 ${esc(loc.length > 40 ? loc.slice(0, 40) + '…' : loc)}</span>` : ''}
          </div>
          ${notes}
        </div>
        <div class="entry-actions">
          <button class="entry-delete" data-id="${esc(entry.id)}" title="Delete entry">✕</button>
        </div>
      </div>`;
    }).join('');

    // Wire delete buttons
    listEl.querySelectorAll('.entry-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm('Delete this sighting entry?')) {
          deleteEntry(btn.dataset.id);
        }
      });
    });
  }

  // ── Map Pins ─────────────────────────────────────────────────

  function makeSpotterIcon() {
    return L.divIcon({
      html: `<svg width="28" height="34" viewBox="0 0 28 34" style="display:block;">
               <path d="M14 0 C6.27 0 0 6.27 0 14 C0 24.5 14 34 14 34 C14 34 28 24.5 28 14 C28 6.27 21.73 0 14 0Z"
                     fill="#f59e0b" stroke="#92400e" stroke-width="1.5"/>
               <circle cx="14" cy="14" r="5" fill="white"/>
             </svg>`,
      iconSize: [28, 34],
      iconAnchor: [14, 34],
      className: '',
    });
  }

  function renderMapPins() {
    // Remove old pins
    pinMarkers.forEach(m => m.remove());
    pinMarkers.clear();

    entries.forEach(entry => {
      if (entry.lat == null || entry.lng == null) return;

      const marker = L.marker([entry.lat, entry.lng], { icon: makeSpotterIcon() });

      const loco = entry.locomotiveNumber || '?';
      const rr = entry.railroad || '';
      const date = entry.date || '';
      marker.bindTooltip(
        `<b>#${esc(loco)}</b>${rr ? ` · ${esc(rr)}` : ''}<br>${date}`,
        { className: 'train-tooltip', direction: 'top', offset: [0, -36] }
      );

      marker.addTo(layer);
      pinMarkers.set(entry.id, marker);
    });
  }

  // ── Export ────────────────────────────────────────────────────

  function exportJSON() {
    const json = JSON.stringify(entries, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spotter-log-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Utilities ─────────────────────────────────────────────────

  function esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Allow pre-filling lat/lng from map tab (if user switches tabs)
  function prefillCoords(lat, lng) {
    document.getElementById('spotLat').value = lat;
    document.getElementById('spotLng').value = lng;
    document.getElementById('coordHint').textContent = `Filled from map click`;
  }

  return { init, prefillCoords };
})();

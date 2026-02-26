/**
 * trainPanel.js — Slide-in detail panel for selected train
 */

const TrainPanelModule = (() => {
  let currentTrainId = null;
  let panelEl = null;
  let bodyEl = null;

  function init() {
    panelEl = document.getElementById('trainPanel');
    bodyEl = document.getElementById('panelBody');

    document.getElementById('panelClose').addEventListener('click', close);
    document.getElementById('panelBackdrop').addEventListener('click', close);

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') close();
    });
  }

  // ── Open / Close ─────────────────────────────────────────────

  function open(train) {
    currentTrainId = train.id;
    render(train);
    panelEl.setAttribute('aria-hidden', 'false');
  }

  function close() {
    currentTrainId = null;
    panelEl.setAttribute('aria-hidden', 'true');
  }

  function update(train) {
    if (train.id !== currentTrainId) return;
    render(train);
  }

  // ── Render ───────────────────────────────────────────────────

  function render(train) {
    const delayBadge = delayBadgeHTML(train.delayMinutes);
    const speedBadge = `<span class="badge badge-speed">⚡ ${train.speed} mph</span>`;

    const nextStopHTML = train.nextStop
      ? `<div class="panel-row">
           <span class="panel-row-label">Next stop</span>
           <span class="panel-row-value">${esc(train.nextStop)}</span>
         </div>
         ${train.nextStopEta ? `<div class="panel-row">
           <span class="panel-row-label">ETA</span>
           <span class="panel-row-value">${formatTime(train.nextStopEta)}</span>
         </div>` : ''}`
      : `<div class="panel-row"><span class="panel-row-label">Next stop</span><span class="panel-row-value">—</span></div>`;

    const progressHTML = renderProgress(train);
    const stopsHTML = renderStops(train);

    bodyEl.innerHTML = `
      <div class="panel-route-name">${esc(train.routeName)}</div>
      <div class="panel-train-number">Train #${esc(train.trainNumber)}</div>

      <div class="panel-badges">
        ${speedBadge}
        ${delayBadge}
      </div>

      <div class="panel-section">
        <div class="panel-section-title">Status</div>
        ${nextStopHTML}
        <div class="panel-row">
          <span class="panel-row-label">Origin</span>
          <span class="panel-row-value">${esc(train.origin || '—')}</span>
        </div>
        <div class="panel-row">
          <span class="panel-row-label">Destination</span>
          <span class="panel-row-value">${esc(train.destination || '—')}</span>
        </div>
      </div>

      ${progressHTML}
      ${stopsHTML}
    `;
  }

  function delayBadgeHTML(minutes) {
    if (minutes > 5) {
      return `<span class="badge badge-delay">🔴 ${minutes}m late</span>`;
    } else if (minutes < -1) {
      return `<span class="badge badge-early">🟢 ${Math.abs(minutes)}m early</span>`;
    }
    return `<span class="badge badge-ontime">🟢 On time</span>`;
  }

  function renderProgress(train) {
    if (!train.origin && !train.destination) return '';
    const pct = Math.round(train.progress * 100);
    return `
      <div class="panel-section">
        <div class="panel-section-title">Route Progress</div>
        <div class="route-progress">
          <div class="progress-labels">
            <span>${esc(train.origin || '—')}</span>
            <span>${pct}%</span>
          </div>
          <div class="progress-bar-track">
            <div class="progress-bar-fill" style="width:${pct}%"></div>
          </div>
          <div class="progress-labels">
            <span></span>
            <span>${esc(train.destination || '—')}</span>
          </div>
        </div>
      </div>
    `;
  }

  function renderStops(train) {
    if (!train.stops || train.stops.length === 0) return '';

    const now = new Date();
    const nextIdx = train.stops.findIndex(s => !s.arrDT || new Date(s.arrDT) > now);

    // Show at most 8 stops for readability, centered around next stop
    let start = Math.max(0, nextIdx - 2);
    let end = Math.min(train.stops.length, start + 8);
    if (end - start < 8) start = Math.max(0, end - 8);

    const items = train.stops.slice(start, end).map((stop, i) => {
      const absIdx = start + i;
      let dotClass = 'future';
      if (absIdx < nextIdx) dotClass = 'passed';
      else if (absIdx === nextIdx) dotClass = 'next';

      const time = stop.arrDT || stop.schArrDT;
      const schTime = stop.schArrDT;
      const delayMs = stop.arrDT && stop.schArrDT
        ? new Date(stop.arrDT) - new Date(stop.schArrDT)
        : 0;
      const delayMin = Math.round(delayMs / 60000);

      return `<div class="stop-item">
        <div class="stop-dot ${dotClass}"></div>
        <div class="stop-info">
          <div class="stop-name">${esc(stop.stationName || stop.code || '?')}</div>
          ${schTime ? `<div class="stop-time">${formatTime(schTime)}${delayMin > 2 ? ` <span class="stop-late">+${delayMin}m</span>` : ''}</div>` : ''}
        </div>
      </div>`;
    }).join('');

    return `
      <div class="panel-section">
        <div class="panel-section-title">Stops ${start > 0 ? `(showing ${start + 1}–${end} of ${train.stops.length})` : ''}</div>
        <div class="stops-list">${items}</div>
      </div>
    `;
  }

  // ── Utilities ─────────────────────────────────────────────────

  function formatTime(isoString) {
    if (!isoString) return '—';
    try {
      return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return isoString;
    }
  }

  function esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return { init, open, close, update };
})();

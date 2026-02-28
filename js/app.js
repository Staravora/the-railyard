/**
 * app.js — Entry point: init sequence + tab navigation
 */

(function () {
  // ── Init sequence ──────────────────────────────────────────────

  function init() {
    // 1. Map must be first (other modules depend on MapModule)
    MapModule.init();

    // 2. Panel must be wired before train markers start firing clicks
    TrainPanelModule.init();

    // 3. Network HUD stats listener
    initHud();

    // 4. Train polling
    TrainsModule.init();

    // 5. Spotter log (depends on MapModule for layer + map)
    SpotterLogModule.init();

    // 6. Rail history widget (independent)
    RailHistoryModule.init();

    // 7. Tab navigation
    initTabs();

    // 8. Legend toggle
    initLegendToggle();

    // 9. Spotlight + checklist widgets
    initFunWidgets();

    // 10. Provider config controls
    initProviderConfigControls();

    // 11. Invalidate map size after tab switch
    // (Leaflet needs to know its real dimensions)
    MapModule.getMap().invalidateSize();
  }

  // ── Tab Navigation ─────────────────────────────────────────────

  function initTabs() {
    const buttons = document.querySelectorAll('.tab-btn');
    const panes = document.querySelectorAll('.tab-pane');

    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.dataset.tab;

        // Update buttons
        buttons.forEach(b => {
          b.classList.toggle('active', b === btn);
          b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
        });

        // Update panes
        panes.forEach(pane => {
          const isTarget = pane.id === `tab-${targetTab}`;
          pane.hidden = !isTarget;
          pane.classList.toggle('active', isTarget);
        });

        // Leaflet needs explicit size invalidation when its container
        // is shown after being hidden
        if (targetTab === 'map') {
          requestAnimationFrame(() => {
            MapModule.getMap().invalidateSize();
          });
        }
      });
    });
  }

  function initHud() {
    const activeEl = document.getElementById('hudActive');
    const onTimeEl = document.getElementById('hudOnTime');
    const delayedEl = document.getElementById('hudDelayed');
    const updatedEl = document.getElementById('hudUpdated');
    const liveEl = document.getElementById('liveIndicator');
    if (!activeEl || !onTimeEl || !delayedEl || !updatedEl) return;

    document.addEventListener('railyard:train-stats', e => {
      const stats = e.detail;
      if (!stats) return;

      activeEl.textContent = String(stats.activeCount ?? '--');
      onTimeEl.textContent = `${stats.onTimePct ?? 0}%`;
      delayedEl.textContent = String(stats.delayedCount ?? 0);

      if (stats.updatedAt) {
        updatedEl.textContent = new Date(stats.updatedAt).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit'
        });
      }

      if (liveEl) {
        liveEl.classList.toggle('stale', stats.stale === true);
        liveEl.title = stats.stale ? 'Feed temporarily stale' : 'Feed live';
      }

      renderProviderStatuses(stats.providerStatuses || []);
    });

    if (typeof FeedRegistryModule !== 'undefined') {
      renderProviderStatuses(FeedRegistryModule.getProviderStatuses());
    }
  }

  function initLegendToggle() {
    const btn = document.getElementById('legendToggleBtn');
    const legend = document.getElementById('mapLegend');
    if (!btn || !legend) return;

    btn.addEventListener('click', () => {
      const hidden = legend.hasAttribute('hidden');
      if (hidden) {
        legend.removeAttribute('hidden');
        btn.classList.add('active');
      } else {
        legend.setAttribute('hidden', '');
        btn.classList.remove('active');
      }
    });
  }

  function initFunWidgets() {
    const routeEl = document.getElementById('spotlightRoute');
    const metaEl = document.getElementById('spotlightMeta');
    const checklistEl = document.getElementById('railfanChecklist');

    document.addEventListener('railyard:train-stats', e => {
      const spotlight = e.detail?.spotlight;
      if (!spotlight || !routeEl || !metaEl) return;

      routeEl.textContent = `${spotlight.routeName} #${spotlight.trainNumber}`;
      const delayText = spotlight.delayMinutes > 0
        ? `${spotlight.delayMinutes}m late`
        : (spotlight.delayMinutes < -1 ? `${Math.abs(spotlight.delayMinutes)}m early` : 'on time');
      const source = spotlight.providerLabel ? `${spotlight.providerLabel}${spotlight.country ? ` ${spotlight.country}` : ''}` : null;
      metaEl.textContent = `${spotlight.speed} mph • ${delayText}${spotlight.nextStop ? ` • Next: ${spotlight.nextStop}` : ''}${source ? ` • ${source}` : ''}`;
    });

    document.addEventListener('railyard:spotter-updated', e => {
      const data = e.detail;
      if (!data || !checklistEl) return;
      applyChecklist(checklistEl, data);
    });

    if (checklistEl) {
      const stored = readSpotterSummaryFromStorage();
      applyChecklist(checklistEl, stored);
    }
  }

  function applyChecklist(checklistEl, data) {
    if (!data || !checklistEl) return;

    const items = checklistEl.querySelectorAll('li');
    if (items.length < 4) return;

    items[0].classList.toggle('done', data.total >= 1);
    items[1].classList.toggle('done', data.photoCount >= 1);
    items[2].classList.toggle('done', data.uniqueRailroads >= 3);
    items[3].classList.toggle('done', data.hasNight === true);
  }

  function readSpotterSummaryFromStorage() {
    try {
      const entries = JSON.parse(localStorage.getItem('trainSpotterLog') || '[]');
      const photoCount = entries.filter(entry => typeof entry.photoDataUrl === 'string' && entry.photoDataUrl.startsWith('data:image/')).length;
      const uniqueRailroads = new Set(entries.map(entry => (entry.railroad || '').trim().toLowerCase()).filter(Boolean)).size;
      const hasNight = entries.some(entry => {
        const t = entry.time || '';
        const hour = Number(t.slice(0, 2));
        return Number.isFinite(hour) && (hour >= 20 || hour <= 5);
      });

      return {
        total: entries.length,
        photoCount,
        uniqueRailroads,
        hasNight,
      };
    } catch {
      return { total: 0, photoCount: 0, uniqueRailroads: 0, hasNight: false };
    }
  }

  function renderProviderStatuses(statuses) {
    const list = document.getElementById('providerStatusList');
    if (!list) return;

    if (!Array.isArray(statuses) || statuses.length === 0) {
      list.innerHTML = '<li class="provider-status-row">No providers configured.</li>';
      return;
    }

    const sorted = [...statuses].sort((a, b) => {
      if ((a.enabled ? 1 : 0) !== (b.enabled ? 1 : 0)) return (b.enabled ? 1 : 0) - (a.enabled ? 1 : 0);
      return String(a.label).localeCompare(String(b.label));
    });

    list.innerHTML = sorted.map(status => {
      const stateClass = !status.enabled ? 'off' : (status.ok ? 'ok' : 'warn');
      const stateLabel = !status.enabled ? 'Disabled' : (status.ok ? 'Live' : 'Offline');
      return `<li class="provider-status-row">
        <span class="provider-name">${status.label}</span>
        <span class="provider-pill ${stateClass}">${stateLabel}</span>
      </li>`;
    }).join('');
  }

  function initProviderConfigControls() {
    const input = document.getElementById('ukEndpointInput');
    const saveBtn = document.getElementById('saveUkEndpointBtn');
    const clearBtn = document.getElementById('clearUkEndpointBtn');
    if (!input || !saveBtn || !clearBtn) return;

    try {
      const runtime = window.RAILYARD_PROVIDER_ENDPOINTS?.ukNetworkRail || '';
      const stored = localStorage.getItem('railyard.ukNetworkRail.endpoint') || '';
      input.value = stored || runtime;
    } catch {
      // Ignore storage/runtime access issues.
    }

    saveBtn.addEventListener('click', () => {
      const value = input.value.trim();
      if (!value) {
        alert('Please enter a valid UK endpoint URL.');
        return;
      }

      try {
        new URL(value);
      } catch {
        alert('Endpoint URL is not valid.');
        return;
      }

      try {
        localStorage.setItem('railyard.ukNetworkRail.endpoint', value);
      } catch {
        alert('Could not store endpoint in browser storage.');
        return;
      }

      alert('UK feed endpoint saved. Reloading to apply.');
      window.location.reload();
    });

    clearBtn.addEventListener('click', () => {
      try {
        localStorage.removeItem('railyard.ukNetworkRail.endpoint');
      } catch {
        // Ignore storage issues.
      }
      input.value = '';
      alert('UK feed endpoint cleared. Reloading to apply.');
      window.location.reload();
    });
  }

  // ── Start ──────────────────────────────────────────────────────
  // Wait for DOM to be fully ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

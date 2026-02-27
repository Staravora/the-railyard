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

    // 8. Invalidate map size after tab switch
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

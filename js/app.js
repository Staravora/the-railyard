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

    // 3. Train polling
    TrainsModule.init();

    // 4. Spotter log (depends on MapModule for layer + map)
    SpotterLogModule.init();

    // 5. Rail history widget (independent)
    RailHistoryModule.init();

    // 6. Tab navigation
    initTabs();

    // 7. Invalidate map size after tab switch
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

  // ── Start ──────────────────────────────────────────────────────
  // Wait for DOM to be fully ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

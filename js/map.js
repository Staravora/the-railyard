/**
 * map.js — MapLibre GL JS map initialization with glowing gold rail lines
 */

const MapModule = (() => {
  let map = null;

  function init() {
    map = new maplibregl.Map({
      container: 'map',
      style: buildStyle(),
      center: [-98.35, 39.5],
      zoom: 5,
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    // Wire rail overlay toggle after style loads
    map.on('load', () => {
      const toggle = document.getElementById('railOverlayToggle');
      if (toggle) {
        toggle.addEventListener('change', () => {
          const vis = toggle.checked ? 'visible' : 'none';
          ['railway-glow', 'railway-core'].forEach(id => {
            if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
          });
        });
      }
    });

    return map;
  }

  function buildStyle() {
    return {
      version: 8,
      sources: {
        'carto-dark': {
          type: 'raster',
          tiles: [
            'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
            'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
            'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
            'https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
          ],
          tileSize: 256,
          attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &amp; © <a href="https://carto.com/attributions">CARTO</a>',
          maxzoom: 20,
        },
        'openmaptiles': {
          type: 'vector',
          url: 'https://tiles.openfreemap.com/planet',
        },
      },
      layers: [
        {
          id: 'carto-background',
          type: 'raster',
          source: 'carto-dark',
        },
        // Wide blurred halo — the glow
        {
          id: 'railway-glow',
          type: 'line',
          source: 'openmaptiles',
          'source-layer': 'transportation',
          filter: ['all', ['==', '$type', 'LineString'], ['==', 'class', 'rail']],
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#c89010',
            'line-width': 5,
            'line-blur': 6,
            'line-opacity': 0.3,
          },
          minzoom: 4,
        },
        // Thin bright core line
        {
          id: 'railway-core',
          type: 'line',
          source: 'openmaptiles',
          'source-layer': 'transportation',
          filter: ['all', ['==', '$type', 'LineString'], ['==', 'class', 'rail']],
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#f0c040',
            'line-width': 0.75,
            'line-opacity': 0.9,
          },
          minzoom: 4,
        },
      ],
    };
  }

  function getMap() { return map; }
  // MapLibre markers attach directly to the map — layer IS the map
  function getTrainLayer() { return map; }
  function getSpotterLayer() { return map; }

  return { init, getMap, getTrainLayer, getSpotterLayer };
})();

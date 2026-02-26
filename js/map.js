/**
 * map.js — Leaflet map initialization, tile layers, layer groups
 */

const MapModule = (() => {
  let map = null;
  let trainLayer = null;
  let spotterLayer = null;
  let railOverlay = null;

  function init() {
    map = L.map('map', {
      center: [39.5, -98.35],
      zoom: 5,
      zoomControl: true,
      attributionControl: true,
    });

    // CartoDB Dark Matter base layer
    const osmLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &amp; © <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20,
    });

    // OpenRailwayMap overlay
    railOverlay = L.tileLayer('https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openrailwaymap.org/">OpenRailwayMap</a>',
      maxZoom: 19,
      opacity: 0.55,
      className: 'rail-overlay-tiles',
    });

    osmLayer.addTo(map);
    railOverlay.addTo(map);

    // Layer groups for train markers and spotter pins
    trainLayer = L.layerGroup().addTo(map);
    spotterLayer = L.layerGroup().addTo(map);

    // Rail overlay toggle (checkbox in toolbar)
    const toggle = document.getElementById('railOverlayToggle');
    if (toggle) {
      toggle.addEventListener('change', () => {
        if (toggle.checked) {
          railOverlay.addTo(map);
        } else {
          railOverlay.remove();
        }
      });
    }

    return map;
  }

  function getMap() { return map; }
  function getTrainLayer() { return trainLayer; }
  function getSpotterLayer() { return spotterLayer; }

  return { init, getMap, getTrainLayer, getSpotterLayer };
})();

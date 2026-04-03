// map.js — initializes the Leaflet map, draws the route polyline, and plots hazard markers

const map = L.map('map').setView([37.5407, -77.4360], 13);

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
    '&copy; <a href="https://carto.com/attributions">CARTO</a>',
}).addTo(map);

let routeLayer = null;
let hazardMarkers = [];

function drawRoute(polyline) {
  if (routeLayer) {
    map.removeLayer(routeLayer);
    routeLayer = null;
  }
  // polyline is an array of [lng, lat] pairs from OSRM/GeoJSON — Leaflet needs [lat, lng]
  const latLngs = polyline.map(([lng, lat]) => [lat, lng]);
  routeLayer = L.polyline(latLngs, {
    color: '#4285f4',
    weight: 5,
    opacity: 0.8,
  }).addTo(map);
  map.fitBounds(routeLayer.getBounds());
}

function plotHazards(hazards) {
  for (const marker of hazardMarkers) {
    map.removeLayer(marker);
  }
  hazardMarkers = [];

  for (const hazard of hazards) {
    const date = new Date(hazard.requestDate).toLocaleDateString();
    const marker = L.circleMarker([hazard.latitude, hazard.longitude], {
      color: '#e63946',
      fillColor: '#e63946',
      fillOpacity: 0.8,
      radius: 8,
    })
      .bindPopup(
        `<strong>${hazard.location}</strong><br>${hazard.serviceName}<br>${date}`
      )
      .addTo(map);
    hazardMarkers.push(marker);
  }
}

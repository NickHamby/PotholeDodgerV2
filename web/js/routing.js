// routing.js — fetches a driving route between two {lat, lng} points using OSRM

export async function getRoute(origin, destination) {
  const url = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson&steps=true`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`OSRM request failed: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  if (!data.routes || data.routes.length === 0) {
    throw new Error('No routes found between the given points');
  }
  const route = data.routes[0];
  if (!route.geometry || !route.geometry.coordinates) {
    throw new Error('OSRM response is missing route geometry');
  }
  if (!route.legs || route.legs.length === 0) {
    throw new Error('OSRM response is missing route legs');
  }
  const polyline = route.geometry.coordinates;
  const seen = new Set();
  const streetNames = [];
  for (const step of route.legs[0].steps) {
    const name = step.name;
    if (name && !seen.has(name)) {
      seen.add(name);
      streetNames.push(name);
    }
  }
  return { polyline, streetNames };
}

// routing.js — fetches a driving route between two {lat, lng} points using OSRM

const COORD_PADDING = 0.0009;

async function getRoute(origin, destination) {
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

  const coordsByStreet = new Map(); // name -> [[lng, lat], ...]

  for (const step of route.legs[0].steps) {
    if (!step.name) continue;
    if (!coordsByStreet.has(step.name)) coordsByStreet.set(step.name, []);
    const points = (step.intersections && step.intersections.length > 0)
      ? step.intersections.filter(i => i.location).map(i => i.location)
      : [step.maneuver.location];
    for (const pt of points) {
      coordsByStreet.get(step.name).push(pt);
    }
  }

  const streetSegments = [];
  for (const [name, coords] of coordsByStreet.entries()) {
    const lats = coords.map(([lng, lat]) => lat);
    const lngs = coords.map(([lng, lat]) => lng);
    streetSegments.push({
      name,
      minLat: Math.min(...lats) - COORD_PADDING,
      maxLat: Math.max(...lats) + COORD_PADDING,
      minLng: Math.min(...lngs) - COORD_PADDING,
      maxLng: Math.max(...lngs) + COORD_PADDING,
    });
  }

  console.log('[routing] street segments on route:', streetSegments);
  return { polyline, streetSegments };
}

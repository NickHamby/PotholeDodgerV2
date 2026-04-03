// routing.js — fetches a driving route between two {lat, lng} points using OSRM

const NOMINATIM_DELAY_MS = 300;
const FALLBACK_MIN_HOUSE_NUM = 0;
const FALLBACK_MAX_HOUSE_NUM = 9999;

function _routingDelay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function _reverseGeocode(lng, lat) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'PotholeDodger/1.0' }
    });
    if (!response.ok) return null;
    const result = await response.json();
    const num = parseInt(result.address && result.address.house_number, 10);
    return isNaN(num) ? null : num;
  } catch (e) {
    return null;
  }
}

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

  // Collect first and last maneuver coords for each unique street name
  const streetMap = new Map(); // name -> { first: [lng, lat], last: [lng, lat] }
  for (const step of route.legs[0].steps) {
    const name = step.name;
    if (!name) continue;
    const coord = step.maneuver.location; // [lng, lat]
    if (!streetMap.has(name)) {
      streetMap.set(name, { first: coord, last: coord });
    } else {
      streetMap.get(name).last = coord;
    }
  }

  // Reverse geocode each street's endpoints with 300ms delay between calls
  const streetEntries = [...streetMap.entries()];
  const streetSegments = [];
  for (let i = 0; i < streetEntries.length; i++) {
    const [name, coords] = streetEntries[i];
    if (i > 0) await _routingDelay(NOMINATIM_DELAY_MS);
    const num1 = await _reverseGeocode(coords.first[0], coords.first[1]);
    await _routingDelay(NOMINATIM_DELAY_MS);
    const num2 = await _reverseGeocode(coords.last[0], coords.last[1]);

    const resolvedNums = [num1, num2].filter(n => n !== null);
    const minNum = resolvedNums.length > 0 ? Math.min(...resolvedNums) : FALLBACK_MIN_HOUSE_NUM;
    const maxNum = resolvedNums.length > 0 ? Math.max(...resolvedNums) : FALLBACK_MAX_HOUSE_NUM;

    streetSegments.push({ name, minNum, maxNum });
  }

  console.log('[routing] street segments on route:', streetSegments);
  return { polyline, streetSegments };
}

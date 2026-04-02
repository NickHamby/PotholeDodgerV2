// geocode.js — resolves an address string to {lat, lng} using Nominatim

async function geocodeAddress(address) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'PotholeDodger/1.0'
    }
  });
  const results = await response.json();
  if (!results || results.length === 0) {
    throw new Error(`No results found for: ${address}`);
  }
  return {
    lat: parseFloat(results[0].lat),
    lng: parseFloat(results[0].lon)
  };
}

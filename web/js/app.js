document.addEventListener('DOMContentLoaded', function () {
  const statusEl = document.getElementById('status');

  function setStatus(text) {
    statusEl.textContent = text;
  }

  async function run() {
    const origin = document.getElementById('origin').value.trim();
    const destination = document.getElementById('destination').value.trim();

    if (!origin || !destination) {
      setStatus('Please enter both an origin and destination.');
      return;
    }

    try {
      setStatus('Geocoding addresses...');
      const [originCoords, destCoords] = await Promise.all([
        geocodeAddress(origin),
        geocodeAddress(destination)
      ]);

      setStatus('Fetching route...');
      const { polyline, streetNames } = await getRoute(originCoords, destCoords);

      setStatus('Loading hazards...');
      const hazards = await getHazardsOnRoute(streetNames);

      drawRoute(polyline);
      plotHazards(hazards);

      setStatus(`Route loaded. ${hazards.length} hazard(s) found on route.`);
    } catch (error) {
      setStatus(`Error: ${error.message}`);
    }
  }

  document.getElementById('go-btn').addEventListener('click', run);

  document.getElementById('origin').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') run();
  });

  document.getElementById('destination').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') run();
  });
});

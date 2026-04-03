function attachAutocomplete(inputEl) {
  const list = inputEl.parentElement.querySelector('.autocomplete-list');
  let debounceTimer = null;

  function hideList() {
    list.classList.remove('open');
    list.innerHTML = '';
  }

  inputEl.addEventListener('input', function () {
    clearTimeout(debounceTimer);
    const query = inputEl.value.trim();

    if (query.length < 3) {
      hideList();
      return;
    }

    debounceTimer = setTimeout(async function () {
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=0&limit=5&q=${encodeURIComponent(query)}`;
        const response = await fetch(url, {
          headers: { 'User-Agent': 'PotholeDodger/1.0' }
        });
        const results = await response.json();

        list.innerHTML = '';

        if (!results.length) {
          hideList();
          return;
        }

        results.forEach(function (result) {
          const li = document.createElement('li');
          li.textContent = result.display_name;
          li.addEventListener('mousedown', function (e) {
            e.preventDefault();
          });
          li.addEventListener('click', function () {
            inputEl.value = result.display_name;
            hideList();
          });
          list.appendChild(li);
        });

        list.classList.add('open');
      } catch (e) {
        console.error('Autocomplete fetch failed:', e);
        hideList();
      }
    }, 300);
  });

  inputEl.addEventListener('blur', function () {
    setTimeout(hideList, 150);
  });
}

document.addEventListener('DOMContentLoaded', function () {
  const statusEl = document.getElementById('status');

  attachAutocomplete(document.getElementById('origin'));
  attachAutocomplete(document.getElementById('destination'));

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

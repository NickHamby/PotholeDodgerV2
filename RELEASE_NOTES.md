## 🚗 v0.5 - Potholes & Routes

First stable milestone — routing and hazard filtering are live and verified working.

### What's in this release

**Coordinate-based hazard filtering**
- Replaced house-number range filtering with GPS bounding boxes per street segment
- Removed all Nominatim reverse-geocoding from the routing path (~10 second latency improvement)
- Hazards are now matched using `minLat/maxLat/minLng/maxLng` bounding boxes built from OSRM intersection coordinates
- Malformed hazard coordinates (lat/lng = 0) are now safely skipped

**String sanitization**
- New `sanitize.js` module with `sanitizeInput()` — strips special characters, collapses whitespace, removes parentheticals
- Wired into both the autocomplete query and the Go button in `app.js`
- Improved `normalizeStreet()` in `hazards.js` — now strips trailing ZIP codes and handles positional directionals (N/S/E/W only expand at start or end of street name)

**Richmond bounding box fix**
- Forward geocoding in `geocode.js` now bounded to Richmond, VA (`bounded=1&viewbox=-77.6,37.7,-77.2,37.4&countrycodes=us`)
- Autocomplete also scoped to `countrycodes=us`
# Coordinate-Based Hazard Filtering — Technical Plan

**Status:** Planning only — no code changes in this document.  
**Replaces:** House-number-range filtering in `routing.js` / `hazards.js`  
**Date:** 2026-04-03

---

## 1. Problem with the Current System

The current pipeline in `routing.js` and `hazards.js` works as follows:

1. For each named street on the route, store only its first and last `maneuver.location` coordinates.
2. Reverse-geocode both points via Nominatim to extract house numbers.
3. Store `{ name, minNum, maxNum }` per street.
4. In `hazards.js`, filter hazards whose extracted house number falls in `[minNum - 100, maxNum + 100]`.

**Known failure modes:**

| Failure | Why it happens |
|---------|---------------|
| Nominatim returns no house number (intersection, dead-end, cul-de-sac) | Falls back to `minNum: 0 / maxNum: 9999` → includes the entire city |
| Route covers only the 400–600 block but pothole is at the 1200 block | Plain numeric range test passes; no spatial check is done |
| "Commerce Road" spans house numbers 1000–5000 over several miles | Entire multi-mile stretch matches every pothole on it |
| N/S Richmond streets: 400 block is south of the 700 block | Range math is directionally wrong for some grid orientations |
| 2 Nominatim calls × N streets × 300 ms delay | Adds 5–10 seconds of latency to every route request |

All five of these problems are solved simultaneously by switching to coordinate bounding boxes.

---

## 2. Proposed Approach: Coordinate Bounding Boxes

Instead of house numbers, collect the GPS coordinates of every point OSRM reports the route passes through for each named street, then build a `[minLat, maxLat] × [minLng, maxLng]` bounding box per street. A hazard already carries `latitude` and `longitude` in `hazards.json`, so filtering becomes a direct point-in-rectangle test with no string parsing or Nominatim calls required.

---

## 3. Data Collection in `routing.js`

### 3.1 Source of per-step coordinates

OSRM returns, for each step in `route.legs[0].steps`:

```json
{
  "name": "Arthur Ashe Boulevard",
  "maneuver": { "location": [-77.4601, 37.5410] },
  "intersections": [
    { "location": [-77.4601, 37.5410] },
    { "location": [-77.4618, 37.5412] },
    { "location": [-77.4635, 37.5415] }
  ]
}
```

`step.intersections[].location` provides a `[lng, lat]` pair at **every intersection** the step passes through, not just the start and end. This is the right data source because:

- It is already present in the OSRM response with `steps=true` — no extra API call needed.
- It covers intermediate cross-streets and gives denser spatial coverage than just the two maneuver endpoints.
- It does not require clipping the route geometry polyline to individual steps (complex, error-prone).

**Decision:** Use `step.intersections[].location` as the coordinate source. Do not use `step.maneuver.location` separately — it is identical to `step.intersections[0].location` and is already included.

### 3.2 Grouping by street name

Build a `Map<streetName, [lng, lat][]>` by iterating every step and appending all its intersection locations to the entry for `step.name`.

```
// Pseudocode
const coordsByStreet = new Map();   // name -> [[lng, lat], ...]

for (const step of route.legs[0].steps) {
  if (!step.name) continue;
  if (!coordsByStreet.has(step.name)) coordsByStreet.set(step.name, []);
  for (const intersection of (step.intersections || [])) {
    coordsByStreet.get(step.name).push(intersection.location);  // [lng, lat]
  }
}
```

### 3.3 Non-contiguous segments (same street crossed twice)

If a route crosses the same named street in two separate segments (e.g. a loop where the car travels "Main St" near the start and then again near the end), both sets of coordinates are appended to the same bucket in `coordsByStreet`. The resulting bounding box will span both segments.

**Tradeoff:** The bbox may then also cover the stretch of "Main St" between the two crossings that the route does not actually travel. This is acceptable because:

1. Street name matching is still required as a precondition (see §5.1).
2. In Richmond's compact grid, the gap between two crossings of the same street is typically short.
3. The alternative (storing separate bboxes per crossing) adds implementation complexity and is not warranted for this use case.

---

## 4. Bounding Box Construction

### 4.1 Computing the raw bbox

For each street entry in `coordsByStreet`:

```
// Pseudocode
const lats = coords.map(([lng, lat]) => lat);
const lngs = coords.map(([lng, lat]) => lng);

const rawMinLat = Math.min(...lats);
const rawMaxLat = Math.max(...lats);
const rawMinLng = Math.min(...lngs);
const rawMaxLng = Math.max(...lngs);
```

### 4.2 Padding / buffer

GPS coordinates in `hazards.json` come from citizen reports that may be slightly offset from the true pothole location. The hazard's `latitude`/`longitude` is also derived from Nominatim geocoding of the reported address, introducing additional uncertainty.

At Richmond's latitude (~37.5° N):
- 1° of latitude ≈ 111 km → **0.001° ≈ 111 m**
- 1° of longitude ≈ 88 km  → **0.001° ≈ 88 m**

A padding constant of **`COORD_PADDING = 0.0009`** (≈ 100 m) is recommended. This:
- Accounts for typical GPS / geocoding imprecision.
- Catches potholes reported at the intersection just before a turn that OSRM omits.
- Is small enough to exclude potholes one or two blocks away on a long straight street.

Apply the padding at construction time (in `routing.js`), so `hazards.js` can do a plain equality check:

```
// Pseudocode
streetSegments.push({
  name:   streetName,
  minLat: rawMinLat - COORD_PADDING,
  maxLat: rawMaxLat + COORD_PADDING,
  minLng: rawMinLng - COORD_PADDING,
  maxLng: rawMaxLng + COORD_PADDING,
});
```

### 4.3 New `streetSegments` shape

```js
// Old shape
{ name: string, minNum: number, maxNum: number }

// New shape
{ name: string, minLat: number, maxLat: number, minLng: number, maxLng: number }
```

The `name` key is preserved so `hazards.js`'s `normalizeStreet` name-matching logic requires no structural changes.

### 4.4 Elimination of Nominatim reverse geocoding

The new system makes **zero Nominatim calls** during the route-fetching path. The only remaining Nominatim call is the forward geocode of the user's typed origin/destination address (in `geocode.js`), which is unchanged.

**Functions and constants to remove from `routing.js`:**

| Item | Type | Reason |
|------|------|--------|
| `_reverseGeocode` | function | Entire function is dead code |
| `_routingDelay` | function | Only used to throttle Nominatim calls |
| `NOMINATIM_DELAY_MS` | constant | No longer needed |
| `FALLBACK_MIN_HOUSE_NUM` | constant | No longer needed |
| `FALLBACK_MAX_HOUSE_NUM` | constant | No longer needed |

---

## 5. Hazard Matching in `hazards.js`

### 5.1 Replacement filter condition

Replace the house number range test with a lat/lng bounds check:

```
// OLD condition (pseudocode)
hazardNum >= seg.minNum - HOUSE_NUMBER_BUFFER
  && hazardNum <= seg.maxNum + HOUSE_NUMBER_BUFFER

// NEW condition (pseudocode)
hazard.latitude  >= seg.minLat
  && hazard.latitude  <= seg.maxLat
  && hazard.longitude >= seg.minLng
  && hazard.longitude <= seg.maxLng
```

The padding is baked into `seg.minLat/maxLat/minLng/maxLng` at construction time, so no arithmetic is needed here.

### 5.2 Street name matching is retained as a precondition

Street name matching **must remain** as a required condition alongside the bbox check, not replaced by it. Reasons:

1. Bounding boxes are rectangles. A curved or diagonal street's bbox will include nearby addresses on perpendicular streets.
2. In Richmond's dense grid, two parallel streets can be as close as 100 m — within the padding radius.
3. The name match costs nothing (it is a string operation on pre-normalized data) and dramatically reduces false positives.

The filter logic remains a two-part AND:

```
// Pseudocode (inside the .filter callback)
tokens.some(token =>
  normalizedSegments.some(seg => {
    // Part 1: street name must match (existing logic, unchanged)
    const nameMatch = seg.name.includes(token) || token.includes(seg.name);
    if (!nameMatch) return false;

    // Part 2: coordinates must fall within the segment's bounding box
    const inBounds =
      hazard.latitude  >= seg.minLat &&
      hazard.latitude  <= seg.maxLat &&
      hazard.longitude >= seg.minLng &&
      hazard.longitude <= seg.maxLng;

    return inBounds;
  })
)
```

### 5.3 Intersection hazards

Hazard records with an intersection-style location (e.g. `"Hull St & W 14th St"`) already carry `latitude` and `longitude` fields in `hazards.json`. The filter condition above is identical for these records — no special handling is required. The `&`-split tokenization in the current `hazards.js` name-matching code is still useful for the name-match precondition.

### 5.4 Edge cases: malformed coordinates

A hazard with `latitude: 0` or `longitude: 0` is malformed (coordinates of 0,0 point to the Gulf of Guinea, not Richmond). These should be skipped before the bbox check:

```
// Pseudocode — add this guard at the top of the .filter callback
if (!hazard.latitude || !hazard.longitude) return false;
```

As of April 2026 there are zero such records in `hazards.json`, but this guard is defensive and costs nothing.

### 5.5 Constants to remove from `hazards.js`

| Item | Type | Reason |
|------|------|--------|
| `HOUSE_NUMBER_BUFFER` | constant | Replaced by `COORD_PADDING` in `routing.js` |

The `ABBR_MAP` constant and `normalizeStreet` function are **unchanged** — still needed for name matching.

---

## 6. Eliminating Nominatim Reverse Geocoding — Latency Impact

### Current latency breakdown (10-street route example)

```
geocodeAddress(origin)       →  ~300 ms  (1 Nominatim forward geocode)
geocodeAddress(destination)  →  ~300 ms  (1 Nominatim forward geocode, parallel)
getRoute(origin, dest)       →  ~400 ms  (OSRM fetch)
  ├─ street 1, call 1        →  +300 ms delay + ~200 ms HTTP
  ├─ street 1, call 2        →  +300 ms delay + ~200 ms HTTP
  ├─ street 2, call 1        →  +300 ms delay + ~200 ms HTTP
  ├─ ...
  └─ street 10, call 2       →  +300 ms delay + ~200 ms HTTP
                                = 10 streets × 2 calls × (300 ms + 200 ms) = 10,000 ms
Total (typical):             ≈  11+ seconds
```

### New latency breakdown (same route)

```
geocodeAddress(origin)       →  ~300 ms  (unchanged)
geocodeAddress(destination)  →  ~300 ms  (unchanged, parallel)
getRoute(origin, dest)       →  ~400 ms  (OSRM fetch, no extra calls)
getHazardsOnRoute(segments)  →  ~0 ms    (local JSON already loaded, pure CPU)
Total (typical):             ≈  700 ms
```

**Expected improvement: ~10 seconds removed from every route request.**

---

## 7. Tradeoffs and Risks

### 7.1 Bounding boxes are rectangles

A street that curves significantly (e.g. Riverside Drive, which follows the James River) may have a bounding box that covers blocks or addresses the route never passes through. 

**Mitigation:** The required street name match pre-filter ensures only potholes on the correct named street are considered. In practice, curved streets in Richmond are long roads, and a pothole on a section of Riverside Drive the route does not travel will still bear the "Riverside Drive" street name match — so this risk cannot be eliminated by geometry alone.

**Acceptable risk:** Riverside Drive-style false inclusions are an inherent limitation of bbox filtering. A polygon-based or nearest-segment approach would fix this, but adds significant complexity. This is an acceptable risk for the current scope.

### 7.2 Padding size sensitivity

| Padding | Approx. distance | Risk |
|---------|-----------------|------|
| 0.0005° | ~50 m | May miss hazards at segment boundaries; too tight |
| **0.0009°** | **~100 m** | **Recommended — matches block-scale GPS error** |
| 0.002°  | ~200 m | Likely to include potholes one block over on cross streets |
| 0.005°  | ~500 m | Equivalent to half a kilometer; no meaningful filtering |

### 7.3 Non-contiguous same-named streets

If "Hull Street" appears at two separate points of the route (start and end of a loop), the single bounding box spans both segments and covers the gap between them. Potholes on Hull Street in that gap will be included even though the route does not travel there.

**Mitigation:** Acceptable for current scope. A future improvement could store per-segment bboxes as an array, but this is out of scope per CLAUDE.md Rule 3.

### 7.4 OSRM steps with no intersections array

Some OSRM steps (typically `arrive` or `depart` maneuvers) may have an empty or absent `intersections` array. The implementation must guard:

```
for (const intersection of (step.intersections || [])) { ... }
```

If a step has no intersections but has `step.maneuver.location`, that single coordinate can be used as a fallback:

```
// Pseudocode — fallback if intersections is empty
const points = (step.intersections && step.intersections.length > 0)
  ? step.intersections.map(i => i.location)
  : [step.maneuver.location];
```

---

## 8. Migration Path

### 8.1 Changes to `routing.js`

**Remove:**
- `const NOMINATIM_DELAY_MS = 300;`
- `const FALLBACK_MIN_HOUSE_NUM = 0;`
- `const FALLBACK_MAX_HOUSE_NUM = 9999;`
- `function _routingDelay(ms) { ... }`
- `async function _reverseGeocode(lng, lat) { ... }`
- The entire `for` loop that calls `_reverseGeocode` and builds `{ name, minNum, maxNum }` entries

**Add:**
- `const COORD_PADDING = 0.0009;`

**Replace the streetMap construction block with:**

```js
// Pseudocode for new routing.js interior
const coordsByStreet = new Map(); // name -> [[lng, lat], ...]

for (const step of route.legs[0].steps) {
  if (!step.name) continue;
  if (!coordsByStreet.has(step.name)) coordsByStreet.set(step.name, []);
  const points = (step.intersections && step.intersections.length > 0)
    ? step.intersections.map(i => i.location)
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
```

**Result:** `getRoute` is now synchronous after the single OSRM `fetch` call. No `async` iteration, no delays.

### 8.2 Changes to `hazards.js`

**Remove:**
- `const HOUSE_NUMBER_BUFFER = 100;`
- The `houseNumMatch` regex and `hazardNum` extraction inside `getHazardsOnRoute`

**Add (at top of `.filter` callback):**
- The `latitude: 0` / `longitude: 0` guard

**Replace the `normalizedSegments` map and filter with:**

```js
// Pseudocode for new hazards.js getHazardsOnRoute

async function getHazardsOnRoute(streetSegments) {
  // ... (fetch hazards.json — unchanged) ...

  const normalizedSegments = streetSegments.map(seg => ({
    name:   normalizeStreet(seg.name),
    minLat: seg.minLat,   // padding already applied
    maxLat: seg.maxLat,
    minLng: seg.minLng,
    maxLng: seg.maxLng,
  }));

  return hazards.filter(hazard => {
    // Guard: skip malformed coordinates
    if (!hazard.latitude || !hazard.longitude) return false;

    const tokens = hazard.location.split('&').map(normalizeStreet);

    const matched = tokens.some(token =>
      normalizedSegments.some(seg => {
        // Pre-filter: street name must match
        const nameMatch = seg.name.includes(token) || token.includes(seg.name);
        if (!nameMatch) return false;

        // Primary check: coordinates must fall within bounding box
        return (
          hazard.latitude  >= seg.minLat &&
          hazard.latitude  <= seg.maxLat &&
          hazard.longitude >= seg.minLng &&
          hazard.longitude <= seg.maxLng
        );
      })
    );

    console.log(`[hazards] "${hazard.location}" → ${matched ? 'INCLUDED' : 'excluded'}`);
    return matched;
  });
}
```

### 8.3 Changes to `app.js`

**None.** The variable name `streetSegments` is preserved. `app.js` destructures `{ polyline, streetSegments }` from `getRoute` and passes `streetSegments` directly to `getHazardsOnRoute` — this interface is unchanged.

### 8.4 Changes to `geocode.js`

**None.** The forward geocoding of the user's typed address is unrelated to this change.

### 8.5 Changes to `map.js`

**None.**

### 8.6 Backwards compatibility and atomicity

The `streetSegments` array changes shape (`minNum/maxNum` → `minLat/maxLat/minLng/maxLng`). Both `routing.js` and `hazards.js` must be updated in a single atomic commit. Updating only one file will cause a runtime error:

- If `routing.js` is updated but `hazards.js` is not: `hazards.js` will try to read `seg.minNum` and get `undefined`, matching every hazard or none.
- If `hazards.js` is updated but `routing.js` is not: `hazards.js` will try to read `seg.minLat` and get `undefined`, and the bbox check will always fail — no hazards returned.

**Commit both files together. Do not split into two separate PRs.**

---

## 9. Summary of What Changes and What Stays the Same

| Component | Changes | Stays the Same |
|-----------|---------|---------------|
| `routing.js` | Remove `_reverseGeocode`, `_routingDelay`, delays, `minNum/maxNum`; add coord-collection loop and bbox construction | OSRM fetch, polyline extraction, `getRoute` signature |
| `hazards.js` | Remove house number parsing and `HOUSE_NUMBER_BUFFER`; replace range check with bbox check | `normalizeStreet`, `ABBR_MAP`, `getAllHazards`, `getHazardsOnRoute` signature |
| `app.js` | Nothing | Everything |
| `geocode.js` | Nothing | Everything |
| `map.js` | Nothing | Everything |
| `hazards.json` | Nothing | Everything |

---

## 10. Open Questions (not blockers)

1. **Should `COORD_PADDING` be configurable?** Currently a module-level constant in `routing.js`. Could be exposed as a parameter to `getRoute` for future tuning without code changes. Not required for initial implementation.

2. **Should the console log in `hazards.js` be kept at the per-hazard level?** With 766 records, this logs 766 lines per route. Consider reducing to a summary log once the feature is confirmed working.

3. **Tests:** Per CLAUDE.md Rule 5, tests are written after the user confirms the feature works manually. The key behaviors to lock in will be:
   - `normalizeStreet` output for known inputs (already tested if a test exists)
   - `getHazardsOnRoute` returns a hazard whose coordinates fall inside the route bbox
   - `getHazardsOnRoute` excludes a hazard whose coordinates fall outside the route bbox
   - `getHazardsOnRoute` excludes a hazard at `latitude: 0`

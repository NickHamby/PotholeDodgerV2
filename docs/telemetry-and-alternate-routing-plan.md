# Telemetry & Alternate Routing — Technical Plan

**Status:** Draft  
**Date:** 2026-04-03  
**Scope:** Planning only — no code changes are part of this document.

---

## Table of Contents

1. [Codebase Baseline](#1-codebase-baseline)
2. [Part 1 — Telemetry Data Collection](#2-part-1--telemetry-data-collection)
   - 2.1 [Events to Capture](#21-events-to-capture)
   - 2.2 [Where Telemetry Goes](#22-where-telemetry-goes)
   - 2.3 [Recommended Approach: Umami Cloud + Custom Fallback](#23-recommended-approach-umami-cloud--custom-fallback)
   - 2.4 [Event Schema](#24-event-schema)
   - 2.5 [Privacy Constraints](#25-privacy-constraints)
   - 2.6 [How Telemetry Improves Hazard Filtering](#26-how-telemetry-improves-hazard-filtering)
3. [Part 2 — Alternate Route Feature](#3-part-2--alternate-route-feature)
   - 3.1 [OSRM Alternatives API](#31-osrm-alternatives-api)
   - 3.2 [Scoring Routes by Hazard Exposure](#32-scoring-routes-by-hazard-exposure)
   - 3.3 [UI Presentation](#33-ui-presentation)
   - 3.4 [Fallback When Alternatives Are Not Distinct Enough](#34-fallback-when-alternatives-are-not-distinct-enough)
   - 3.5 [Telemetry Feeding Back Into Route Scoring](#35-telemetry-feeding-back-into-route-scoring)
4. [Phased Implementation Roadmap](#4-phased-implementation-roadmap)
5. [Open Questions & Parking Lot](#5-open-questions--parking-lot)

---

## 1. Codebase Baseline

Before designing telemetry and alternate routing, it is important to understand the current data flow so every recommendation is grounded in the real code.

### Current flow (as-built)

```
User input (origin, destination)
  → geocode.js  → Nominatim → {lat, lng} for each endpoint
  → routing.js  → OSRM router.project-osrm.org → {polyline, streetSegments[]}
                   (also reverse-geocodes each street endpoint via Nominatim
                    to obtain minNum/maxNum for house-number filtering)
  → hazards.js  → fetch web/data/hazards.json
                   filter by normalizeStreet() + house-number range ± 100
  → map.js      → drawRoute(polyline)
                   plotHazards(allHazards, routeHazards)
                     red  circle = on-route hazard
                     yellow circle = area hazard (not on this route)
  → app.js      → setStatus("Route loaded. N hazard(s) found on route.")
```

### Relevant touchpoints for instrumentation

| Location | What is available | Why it matters |
|----------|------------------|----------------|
| `app.js → run()` | origin/destination strings, timing | Route requested event |
| `app.js → run()` (after `getRoute` resolves) | `streetSegments`, route distance/duration | Route loaded event |
| `app.js → run()` (after `getHazardsOnRoute` resolves) | `routeHazards.length` | On-route hazard count |
| `map.js → plotHazards()` | every `L.circleMarker` created | Hazard marker click event |
| `app.js → attachAutocomplete()` | suggestion `click` listener | Autocomplete selection vs. manual entry |

### What the OSRM response currently contains

```
route.legs[0].distance   // metres (float)
route.legs[0].duration   // seconds (float)
route.geometry           // GeoJSON LineString, coordinates: [[lng,lat], ...]
route.legs[0].steps[]    // turn-by-turn steps with maneuver.location, name
```

`routing.js` currently discards `distance` and `duration`. Both should be forwarded to `app.js` for telemetry.

---

## 2. Part 1 — Telemetry Data Collection

### 2.1 Events to Capture

| Event name | Trigger | Key properties |
|------------|---------|----------------|
| `route_requested` | User clicks Go or presses Enter | `origin_query`, `dest_query`, `session_id` |
| `geocode_completed` | Both geocode calls resolve | `origin_lat`, `origin_lng`, `dest_lat`, `dest_lng`, `duration_ms` |
| `route_loaded` | `getRoute()` resolves | `route_distance_m`, `route_duration_s`, `street_count`, `duration_ms` |
| `hazards_counted` | `getHazardsOnRoute()` resolves | `on_route_count`, `total_hazard_count`, `duration_ms` |
| `hazard_clicked` | Popup opened on a marker | `hazard_id`, `on_route` (bool), `service_name` |
| `autocomplete_selected` | Suggestion `li` is clicked | `field` (`origin`/`destination`), `query_length`, `suggestion_rank` |
| `alternate_route_requested` | (future) User requests alternate | `session_id`, `primary_hazard_count` |
| `alternate_route_selected` | (future) User switches to alternate | `session_id`, `primary_hazard_count`, `alternate_hazard_count` |

`session_id` is a random UUID generated once per page load (stored in `sessionStorage`). It links a sequence of events without identifying the user across sessions.

### 2.2 Where Telemetry Goes

Four options evaluated for a **GitHub Pages static site with no backend**:

#### Option A — Write to `telemetry.json` via GitHub API  
Writes a JSON file to the repo using a Personal Access Token embedded in the JS.  
**Verdict: Rejected.** Embedding a write-capable PAT in client-side JS is a critical security vulnerability. Rate-limited to 5,000 requests/hour. Commits would pollute the repo history.

#### Option B — Browser `localStorage` accumulation  
Events queue in `localStorage`; a background task batches them to an external endpoint.  
**Verdict: Partial.** Useful as a local buffer (data survives page refresh) but still requires an external sink. Not useful alone.

#### Option C — Third-party analytics (Plausible or Umami)  
Both are open-source, privacy-focused tools that can run in the cloud or self-hosted.  
- **Plausible** — requires a paid plan for custom events; $9/month minimum.  
- **Umami Cloud** — free tier (up to 100k events/month), supports custom `umami.track()` events, no cookies, no PII by default, GDPR-compliant.  
**Verdict: Recommended primary approach.** Zero backend to maintain, generous free tier, first-class custom event support, open source (self-hostable if needed).

#### Option D — Cloudflare Workers (or Vercel Edge Function)  
A small serverless function receives `POST /event` from the JS, writes to a KV store or forwards to a database.  
- Cloudflare Workers free tier: 100,000 requests/day.  
- Requires writing and deploying a Worker (30–60 min of setup).  
**Verdict: Recommended secondary approach** for teams that want full data ownership and more complex aggregation. Implement after Umami is proven insufficient.

### 2.3 Recommended Approach: Umami Cloud + Custom Fallback

**Primary:** Embed the Umami tracking script in `web/index.html`. Use `umami.track(eventName, properties)` at each instrumentation point in `app.js` and `map.js`.

**Why Umami over Plausible:**
- Free tier covers ~100k events/month (vs. Plausible's page-view-only free tier).
- `umami.track()` API is trivial to add without changing the app's architecture.
- Self-hostable on any $5/month VPS or Render free tier if the project scales.

**Fallback:** A `telemetry.js` module that wraps `umami.track()` so the implementation can be swapped to a Cloudflare Worker endpoint with a one-line config change.

```js
// telemetry.js (pseudocode — do NOT implement yet)
const TELEMETRY_BACKEND = 'umami'; // or 'worker'
const WORKER_ENDPOINT   = 'https://potholedodger.YOUR-SUBDOMAIN.workers.dev/event';

function trackEvent(name, props = {}) {
  const payload = {
    event: name,
    ts:    Date.now(),
    session_id: getOrCreateSessionId(), // reads/writes sessionStorage
    props
  };

  if (TELEMETRY_BACKEND === 'umami' && typeof umami !== 'undefined') {
    umami.track(name, payload);
  } else if (TELEMETRY_BACKEND === 'worker') {
    navigator.sendBeacon(WORKER_ENDPOINT, JSON.stringify(payload));
  }
  // Silent no-op if neither is available — never throw
}

function getOrCreateSessionId() {
  let id = sessionStorage.getItem('pd_session_id');
  if (!id) {
    // crypto.randomUUID() requires a secure context (HTTPS or localhost).
    // GitHub Pages always serves over HTTPS, so this is safe. For local
    // development over plain HTTP, fall back to a Math.random-based UUID.
    id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
          const r = Math.random() * 16 | 0;
          return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    sessionStorage.setItem('pd_session_id', id);
  }
  return id;
}
```

`navigator.sendBeacon` is preferred over `fetch` for fire-and-forget events because it completes even if the page is navigated away.

### 2.4 Event Schema

All events share a common envelope:

```json
{
  "event":      "route_loaded",
  "ts":         1712178671234,
  "session_id": "a3f7c291-84b2-41e1-9b0d-d2c3e8f01234",
  "props": {
    "route_distance_m":  4823.7,
    "route_duration_s":  612.0,
    "street_count":      8,
    "on_route_hazards":  5,
    "total_hazards":     766,
    "duration_ms":       1342
  }
}
```

Full schema per event type:

```json
// route_requested
{
  "event": "route_requested",
  "ts": 1712178670000,
  "session_id": "...",
  "props": {
    "origin_query": "broad st richmond",
    "dest_query": "cary st richmond va"
  }
}

// geocode_completed
{
  "event": "geocode_completed",
  "ts": 1712178670800,
  "session_id": "...",
  "props": {
    "origin_lat": 37.5471,
    "origin_lng": -77.4523,
    "dest_lat": 37.5380,
    "dest_lng": -77.4601,
    "duration_ms": 780
  }
}

// route_loaded
{
  "event": "route_loaded",
  "ts": 1712178671234,
  "session_id": "...",
  "props": {
    "route_distance_m": 4823.7,
    "route_duration_s": 612.0,
    "street_count": 8,
    "on_route_hazards": 5,
    "total_hazards": 766,
    "duration_ms": 1342
  }
}

// hazard_clicked
{
  "event": "hazard_clicked",
  "ts": 1712178675000,
  "session_id": "...",
  "props": {
    "hazard_id": "DPW000231648",
    "on_route": true,
    "service_name": "Pothole on Road"
  }
}

// autocomplete_selected
{
  "event": "autocomplete_selected",
  "ts": 1712178669500,
  "session_id": "...",
  "props": {
    "field": "origin",
    "query_length": 7,
    "suggestion_rank": 0
  }
}

// alternate_route_requested  (Phase 2)
{
  "event": "alternate_route_requested",
  "ts": 1712178680000,
  "session_id": "...",
  "props": {
    "primary_hazard_count": 7
  }
}

// alternate_route_selected  (Phase 3)
{
  "event": "alternate_route_selected",
  "ts": 1712178682000,
  "session_id": "...",
  "props": {
    "primary_hazard_count": 7,
    "alternate_hazard_count": 2,
    "delta": -5
  }
}
```

**What is intentionally excluded:**
- Full address strings after geocoding (lat/lng is enough; raw address strings may contain PII)
- IP address (Umami strips this by default; the Worker must also strip it server-side)
- User agent beyond browser family (not useful for this app)
- Any device identifiers or cookies

### 2.5 Privacy Constraints

- No cookies. `session_id` lives only in `sessionStorage` and expires when the tab closes.
- No IP logging. Umami anonymizes IPs by default. A custom Worker must never store `req.headers['cf-connecting-ip']`.
- No raw addresses beyond the query string as typed (not the resolved display_name from Nominatim).
- Events fire client-side only; there is no server-side tracking of individual users.
- A one-sentence privacy notice should be added to `web/index.html` footer: _"This app collects anonymous usage data to improve route quality. No personal information is stored."_

### 2.6 How Telemetry Improves Hazard Filtering

The current hazard filter (street name + house number range) has two known failure modes:

1. **Too narrow** — potholes near the route that are missed because the house number or street name normalization doesn't match.  
   *Signal:* Users clicking yellow (off-route) markers near their route indicates missed matches.

2. **Too wide** — potholes on the same street but far from the driven segment being incorrectly flagged as on-route.  
   *Signal:* Users never clicking red markers on a particular street, or frequently requesting alternate routes despite seemingly few hazards.

#### Feedback loop design (Phase 3):

```
telemetry events
  → aggregate by hazard_id:
      { total_clicks, on_route_clicks, off_route_clicks }
  → compute "false positive" score:
      fp_score = on_route_clicks / (on_route_clicks + off_route_clicks)
      # fp_score close to 0 → hazard rarely on routes where it's flagged
      # fp_score close to 1 → consistently on routes → filter is working
  → use fp_score to tune HOUSE_NUMBER_BUFFER in hazards.js:
      buffer = BASE_BUFFER * fp_score
      # fp_score → 0 (false positives) → tighter buffer (stop over-including)
      # fp_score → 1 (confirmed on-route) → maintain full buffer
      # floor at 0.25 * BASE_BUFFER to avoid zeroing out the buffer entirely
```

This is a low-volume feedback signal (Richmond is a small city) so it should be treated as directional, not algorithmic truth. Manual review of aggregated click patterns is recommended before changing filter constants.

---

## 3. Part 2 — Alternate Route Feature

### 3.1 OSRM Alternatives API

OSRM's public routing API supports route alternatives via the `alternatives` query parameter.

#### Updated API call

```
GET https://router.project-osrm.org/route/v1/driving/{lng1},{lat1};{lng2},{lat2}
  ?overview=full
  &geometries=geojson
  &steps=true
  &alternatives=true
```

`alternatives=true` returns up to 3 candidate routes. `alternatives=2` or `alternatives=3` can be used to request a specific number; the server returns as many as are available.

#### Response shape

```json
{
  "code": "Ok",
  "routes": [
    {
      "geometry": { "type": "LineString", "coordinates": [[lng,lat], ...] },
      "legs": [{
        "distance": 4823.7,
        "duration": 612.0,
        "steps": [{ "name": "Broad Street", "maneuver": { "location": [lng, lat] }, ... }]
      }],
      "distance": 4823.7,
      "duration": 612.0,
      "weight": 612.0
    },
    {
      "geometry": { ... },   // alternate route 1
      "legs": [{ ... }],
      "distance": 5210.3,
      "duration": 654.0,
      "weight": 654.0
    }
  ],
  "waypoints": [...]
}
```

`data.routes[0]` is always the primary (fastest) route. `data.routes[1]` is the first alternate, if one exists.

#### Extracting the alternate in `routing.js`

The current `getRoute()` function only processes `data.routes[0]`. To support alternates, `getRoute()` should return an array of route objects:

```js
// pseudocode — routing.js change outline (do NOT implement yet)
async function getRoute(origin, destination) {
  const url = `...&alternatives=true`;
  const data = await fetch(url).then(r => r.json());

  const results = [];
  for (const route of data.routes) {
    const polyline = route.geometry.coordinates;
    const streetSegments = extractStreetSegments(route.legs[0].steps);
    results.push({
      polyline,
      streetSegments,
      distanceM: route.distance,
      durationS: route.duration,
    });
  }
  return results; // [primaryRoute, alternateRoute?, ...]
}
```

`extractStreetSegments()` would encapsulate the existing `streetMap` logic so it can be applied to each route without duplication.

#### Are OSRM alternatives geographically distinct enough?

OSRM generates alternatives using the "via" algorithm — it finds a route that passes through a different midpoint. For Richmond's urban street grid, this typically produces a parallel route one or two blocks away. That is often enough to avoid a cluster of potholes on a single block.

However, for very short trips (< 1 km) or trips between two points connected by only one practical corridor, OSRM may return zero alternatives or an alternative that shares 90%+ of its path with the primary.

**Distinctness check:** Before presenting an alternate route, compute the Jaccard similarity of the two routes' bounding-box grid cells. If similarity > 0.8, treat the alternate as "not meaningfully different" and show a user-facing message instead of the toggle button. See §3.4 for fallback strategy.

### 3.2 Scoring Routes by Hazard Exposure

Given two routes (primary and alternate), each with its own `streetSegments`, the hazard filter in `hazards.js` already knows how to compute `routeHazards` for any segment list. The scoring logic is:

#### Simple count (Phase 2 baseline)

```js
// pseudocode
const primaryHazards   = await getHazardsOnRoute(primaryRoute.streetSegments);
const alternateHazards = await getHazardsOnRoute(alternateRoute.streetSegments);

const score = {
  primary:   primaryHazards.length,
  alternate: alternateHazards.length,
  delta:     primaryHazards.length - alternateHazards.length, // positive = primary is worse
};
```

#### Weighted count (Phase 3 enhancement)

Not all potholes are equal. The hazard schema has:
- `requestDate` — recency: newer reports are more likely to be unrepaired
- `description` — free text that may contain severity signals

**Recency weight:**

```js
function recencyWeight(requestDateMs) {
  const ageMs  = Date.now() - requestDateMs;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  // Decay: weight = 1 at age 0, 0.5 at 90 days, ~0 at 365 days
  return Math.max(0, 1 - ageDays / 365);
}
```

**Description severity weight:**  
Parse `hazard.description` for keywords that suggest severity. This is intentionally conservative because 311 descriptions vary widely in quality:

```js
const SEVERITY_KEYWORDS = ['large', 'deep', 'dangerous', 'severe', 'major', 'sinkhole'];

function descriptionWeight(description) {
  if (!description) return 1.0;
  const lower = description.toLowerCase();
  const hits   = SEVERITY_KEYWORDS.filter(k => lower.includes(k)).length;
  return 1 + hits * 0.25; // max ~2.5x multiplier
}
```

**Combined score per route:**

```js
function scoreHazards(hazards) {
  return hazards.reduce((sum, h) => {
    return sum + recencyWeight(h.requestDate) * descriptionWeight(h.description);
  }, 0);
}
```

**Recommendation:** Start with simple count (Phase 2) because it is transparent and debuggable. Add weighted scoring in Phase 3 only after telemetry data shows that simple counts are misleading (e.g., a route with 1 critical pothole scores as "better" than one with 3 minor ones).

### 3.3 UI Presentation

#### Visual design

| Element | Primary route | Alternate route |
|---------|--------------|-----------------|
| Polyline color | Blue (`#4285f4`) — unchanged | Green (`#2ecc71`) |
| Polyline weight | 5px | 4px |
| Polyline opacity | 0.85 (active) / 0.3 (inactive) | 0.85 (active) / 0.3 (inactive) |
| Hazard markers | Red/yellow as today | Same styling, filtered to that route's hazards |

Both routes are drawn on the map simultaneously. The user's currently-selected route is rendered at full opacity; the other is dimmed.

#### Comparison banner

Below the status bar, add a comparison strip (visible only when an alternate exists):

```
┌─────────────────────────────────────────────────────────────────┐
│  Primary route: 7 hazards  ●  Alternate route: 3 hazards        │
│  [ Use primary route ]     [ ✓ Use alternate route ]            │
└─────────────────────────────────────────────────────────────────┘
```

The active route button is highlighted. Clicking the inactive button:
1. Swaps the active/inactive visual state of both polylines.
2. Replots hazard markers filtered to the newly active route's `streetSegments`.
3. Fires `alternate_route_selected` or `primary_route_selected` telemetry event.
4. Updates the status bar text.

#### HTML sketch (do NOT implement yet)

```html
<!-- Insert after #status, hidden by default -->
<div id="route-comparison" class="hidden">
  <span id="primary-label">Primary: <strong id="primary-count">0</strong> hazards</span>
  <button id="use-primary-btn" class="route-btn active">Use primary</button>
  <button id="use-alternate-btn" class="route-btn">Use alternate</button>
  <span id="alternate-label">Alternate: <strong id="alternate-count">0</strong> hazards</span>
</div>
```

#### app.js wiring sketch (do NOT implement yet)

```js
// After getRoute() returns an array of routes:
const [primaryRoute, alternateRoute] = routes;

if (alternateRoute) {
  const [primaryHazards, alternateHazards] = await Promise.all([
    getHazardsOnRoute(primaryRoute.streetSegments),
    getHazardsOnRoute(alternateRoute.streetSegments),
  ]);

  drawRoute(primaryRoute.polyline, 'primary');
  drawRoute(alternateRoute.polyline, 'alternate');

  plotHazards(allHazards, primaryHazards, 'primary');
  plotHazards(allHazards, alternateHazards, 'alternate');

  showRouteComparison(primaryHazards.length, alternateHazards.length);
  trackEvent('route_loaded', {
    on_route_hazards: primaryHazards.length,
    alternate_hazards: alternateHazards.length,
    has_alternate: true,
    route_distance_m: primaryRoute.distanceM,
    route_duration_s: primaryRoute.durationS,
  });
} else {
  // Single route — existing behavior
}
```

### 3.4 Fallback When Alternatives Are Not Distinct Enough

#### Detection

Compute overlap between primary and alternate using a coarse grid approach:

```js
function routeOverlapFraction(polyline1, polyline2) {
  // Snap each coordinate to a 0.0005-degree grid (~50m cells).
  // Use Math.floor() rather than bitwise | 0 so that negative coordinates
  // (west longitudes, south latitudes) snap to the correct cell boundary.
  const cell = ([lng, lat]) =>
    `${Math.floor(lat / 0.0005)},${Math.floor(lng / 0.0005)}`;
  const cells1 = new Set(polyline1.map(cell));
  const cells2 = new Set(polyline2.map(cell));
  const intersection = [...cells1].filter(c => cells2.has(c)).length;
  return intersection / Math.max(cells1.size, cells2.size);
}
// If routeOverlapFraction(p1, p2) > 0.75 → too similar → use fallback
```

#### Fallback Strategy 1: Force a waypoint via a hazard-free zone

Identify the densest cluster of on-route hazards (e.g., the 300m segment with the most potholes). Find a point ~100m off that segment (perpendicular, using a heading offset). Add it as a forced intermediate waypoint:

```
GET .../route/v1/driving/{lng1},{lat1};{waypointLng},{waypointLat};{lng2},{lat2}
  ?overview=full&geometries=geojson&steps=true
```

The forced waypoint guarantees the route detours around the worst cluster. The route may be slightly longer but will have fewer potholes.

#### Fallback Strategy 2: Use OSRM's `snapping` hints

OSRM does not have an `exclude=coordinate` parameter on the public API. However, the `snapping=any` flag plus careful waypoint placement is the most practical approach on the free public server.

A custom OSRM server deployment would allow the `exclude=motorway,toll` parameter to be extended, but that is out of scope for this plan.

#### Fallback Strategy 3: Inform the user

If neither OSRM alternative nor a forced-waypoint route reduces hazard count meaningfully (delta < 2), display a message instead of a toggle button:

```
"No significantly better alternate route found. Primary route has N hazards."
```

This is honest and avoids showing a "use alternate" option that provides no real benefit.

### 3.5 Telemetry Feeding Back Into Route Scoring

#### Short-term (Phase 2)

Every `alternate_route_selected` event records:
- `primary_hazard_count`
- `alternate_hazard_count`
- `delta` (negative means alternate was better)

Aggregate over time: if >60% of sessions with an available alternate choose it, that is evidence the primary route through that area has worse real-world conditions than the count alone suggests.

#### Medium-term (Phase 3)

Track `hazard_clicked` events by `hazard_id` and whether the hazard was `on_route`. Build an engagement score per hazard:

```
engagement_score(hazard) = (total clicks on this hazard across all sessions)
                         / (total sessions where this hazard was on the route)
```

- High engagement → users notice this hazard → it's real and impactful → increase its weight in scoring
- Zero engagement on red markers → hazard is being over-included → tighten the filter

This score should be reviewed manually and adjusted in `hazards.js` constants, not applied algorithmically without review, given the low traffic volumes expected.

#### Long-term (Phase 4 — crowd-sourcing)

Add a "Confirm hazard" button to the marker popup. Users who encounter a pothole click it to confirm. This generates a `hazard_confirmed` telemetry event. After N confirmations, a hazard's weight doubles. This transforms the app from a static 311 data viewer into a live crowd-sourced hazard map — but is explicitly out of scope for the current build state.

---

## 4. Phased Implementation Roadmap

### Phase 1 — Telemetry (no new features visible to users)

**Goal:** Instrument the existing app to collect anonymized usage data.

**Files to create/modify:**

| Action | File | Change |
|--------|------|--------|
| Create | `web/js/telemetry.js` | `trackEvent()`, `getOrCreateSessionId()`, Umami wrapper |
| Modify | `web/index.html` | Add Umami embed script tag; add `telemetry.js` script tag; add privacy notice |
| Modify | `web/js/app.js` | Call `trackEvent()` at `run()` start, after geocode, after routing, after hazard load |
| Modify | `web/js/map.js` | Add `marker.on('popupopen', ...)` to fire `hazard_clicked` event |
| Modify | `web/js/app.js` | Track autocomplete selection in `attachAutocomplete()` |
| Modify | `web/js/routing.js` | Return `distanceM` and `durationS` from `getRoute()` |

**Acceptance criteria:**
- [ ] `trackEvent('route_requested', ...)` fires on every Go click
- [ ] `trackEvent('route_loaded', ...)` fires with correct hazard count and distance
- [ ] `trackEvent('hazard_clicked', ...)` fires with the correct `hazard_id` and `on_route` value
- [ ] Umami dashboard shows events appearing in real time
- [ ] No PII in any event payload (verified by inspecting Umami event log)
- [ ] `telemetry.js` is a no-op when Umami is not loaded (e.g., ad blockers)

**Estimated effort:** 2–4 hours

---

### Phase 2 — Alternate Route UI

**Goal:** Show a second route on the map when OSRM returns one; let the user choose.

**Files to create/modify:**

| Action | File | Change |
|--------|------|--------|
| Modify | `web/js/routing.js` | Add `&alternatives=true`; return `routes[]` array instead of single route |
| Modify | `web/js/app.js` | Handle array return from `getRoute()`; call `getHazardsOnRoute()` for each route |
| Modify | `web/js/map.js` | `drawRoute(polyline, role)` where role is `'primary'` or `'alternate'`; manage two `routeLayer` objects; dim inactive route |
| Modify | `web/index.html` | Add `#route-comparison` comparison strip (hidden until alternate exists) |
| Create | `web/css/` | Add comparison strip styles to `theme.css` |
| Modify | `web/js/app.js` | Wire comparison strip buttons to swap active route |

**Acceptance criteria:**
- [ ] When OSRM returns 2 routes, both are drawn (blue primary, green alternate)
- [ ] Comparison strip shows correct hazard counts for each route
- [ ] Switching routes replots hazard markers filtered to the active route
- [ ] Switching routes fires the correct telemetry event
- [ ] When OSRM returns only 1 route, the comparison strip is hidden and behavior is identical to today
- [ ] Overlap detection hides the comparison strip when routes are >75% identical

**Estimated effort:** 4–8 hours

---

### Phase 3 — Feedback Loop

**Goal:** Use accumulated telemetry to tune hazard filtering and route scoring.

**Files to create/modify:**

| Action | File | Change |
|--------|------|--------|
| Create | `scripts/analyze_telemetry.py` | Reads exported Umami CSV/JSON; computes per-hazard engagement scores; outputs tuning recommendations |
| Modify | `web/js/hazards.js` | Optionally load a `hazard_weights.json` file (generated by the script) to apply per-hazard multipliers |
| Create | `web/data/hazard_weights.json` | Generated artifact; maps `hazard_id → weight` |
| Modify | `.github/workflows/` | Add a workflow to run `analyze_telemetry.py` on schedule and commit updated `hazard_weights.json` |

**Acceptance criteria:**
- [ ] `analyze_telemetry.py` runs without error on a real Umami export
- [ ] `hazard_weights.json` is committed to the repo via GitHub Actions on a weekly schedule
- [ ] `hazards.js` applies weights when `hazard_weights.json` is present, ignores it gracefully when absent
- [ ] A PR is generated for human review before the weights file is merged (do not auto-merge)

**Estimated effort:** 6–12 hours

---

## 5. Open Questions & Parking Lot

These items came up during planning and are intentionally deferred:

| Item | Why deferred |
|------|-------------|
| Replace Nominatim reverse-geocoding with coordinate bbox filtering | Separate plan exists: `docs/coordinate-based-filtering-plan.md` |
| Cluster high-density hazard areas on the map | Out of scope per CLAUDE.md |
| "Find better route" multi-waypoint optimization | Out of scope per CLAUDE.md |
| Google Maps deep-link from popup | Out of scope per CLAUDE.md |
| Phase 4 crowd-sourced hazard confirmation | Requires significant new UI and backend; deferred indefinitely |
| OSRM self-hosting to unlock `exclude` parameter | Only necessary if public OSRM alternatives prove consistently too similar; re-evaluate after Phase 2 data |
| Plausible as alternative to Umami | Re-evaluate if Umami free tier is exhausted or self-hosting becomes impractical |

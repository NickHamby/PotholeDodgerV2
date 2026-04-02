# HISTORY.md — PotholeDodger V2

> Running log of sessions, decisions, and actions taken on this project.
> Read CLAUDE.md first for current rules.

---

## Session 1 — 2026-04-02

### Decisions made
- V2 is a clean rewrite of PotholeDodger V1
- Hazard data fetched via pipeline (not on every app run), stored as `web/data/hazards.json`
- Route-first logic: OSRM route → extract street names → filter potholes by street name match
- Fetch path for hazards: `web/data/hazards.json`
- Root `index.html` is a redirect shim to `web/index.html`
- Scope locked: no alternate routes, no detour logic, no clustering, no Google Maps links

### Build order (confirmed)

| # | File | Status |
|---|------|--------|
| 1 | `scripts/rva311_pipeline.py` | ✅ Done |
| 2 | `web/index.html` + `web/css/theme.css` | 🔲 Not started |
| 3 | `web/js/geocode.js` | 🔲 Not started |
| 4 | `web/js/routing.js` | 🔲 Not started |
| 5 | `web/js/hazards.js` | 🔲 Not started |
| 6 | `web/js/map.js` | 🔲 Not started |
| 7 | `web/js/app.js` | 🔲 Not started |

### Actions taken
- Created `CLAUDE.md` with project rules
- Wrote `scripts/rva311_pipeline.py` — scrapes RVA 311 API, outputs `web/data/hazards.json`
  - Outputs JSON (not Google Maps URLs like V1)
  - Keeps all fields: `id`, `serviceName`, `latitude`, `longitude`, `location`, `status`, `requestDate`, `description`
  - Output path resolved using `__file__` so script works regardless of working directory
- Created `.github/workflows/run-pipeline.yml` — runs pipeline via GitHub Actions (`workflow_dispatch` + on push to pipeline script)
- Created `HISTORY.md` (this file)

### What's next
- File 2: `web/index.html` + `web/css/theme.css` — UI shell only (two inputs, button, status area, map div)
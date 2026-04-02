# HISTORY.md — PotholeDodger V2

> Running log of sessions, decisions, and actions taken on this project.
> Read CLAUDE.md first for current architecture and rules.

---

## Session 1 — 2026-04-02

### Decisions made
- V2 is a clean rewrite of PotholeDodger V1
- No clustering — work with individual pothole points and street names
- Hazard data fetched weekly via pipeline, not on every app run
- Pothole data stored as JSON (`web/data/hazards.json`) with full record fields
- Route-first logic: get OSRM route → extract street names → filter potholes by street name match
- No proximity radius — street name matching only
- Fuzzy street name matching via abbreviation expansion + normalization (pure function, testable)
- Split pothole `location` on `&` to handle intersections before matching
- Testing process: user confirms behavior manually first, then test is written to lock it in
- Test framework: TBD (Jest or Vitest — decide when we get there)
- GitHub Pages deployment from repo root on `main`
- Fetch path for hazards: `web/data/hazards.json`
- Scope locked: no alternate routes, no detour logic, no clustering, no Google Maps links, no debug.js
- Root `index.html` is a redirect shim to `web/index.html`

### Actions taken
- Wrote `scripts/rva311_pipeline.py` — fetches RVA 311 API, outputs `web/data/hazards.json`
  - `OUTPUT_PATH` resolved using `__file__` so script works regardless of working directory
  - Outputs JSON with full fields: `id`, `serviceName`, `latitude`, `longitude`, `location`, `status`, `requestDate`, `description`
- Created `.github/workflows/run-pipeline.yml` — runs pipeline via GitHub Actions (`workflow_dispatch` + on push to pipeline script)
  - Required because Copilot coding agent sandbox has no outbound internet access
- Pipeline ran successfully via Actions — `web/data/hazards.json` committed to `main`

### Pipeline output (verified)
```
Fetching page 1...
Page 1: 100 records (running total: 100)
...
Page 8: 88 records (running total: 788)
Page 9 returned empty — pagination complete.
Parsed 788 records with valid coordinates.
Deduplicated to 766 records.
Wrote 766 records to web/data/hazards.json
```

| Service | Count |
|---|---|
| Pothole on Road | 494 |
| Repair Road | 264 |
| Raise or Lower Sewer Manhole | 8 |

---

## Session 2 — 2026-04-02 (context lost mid-session)

### Context loss
Copilot lost all session context mid-conversation. The user exported the full chat transcript and pasted it back to rebuild context. Full transcript saved externally as `thu_apr_02_2026_getting_started_with_git_hub_assistance.md`.

### Actions taken to recover
- User pasted full exported chat transcript into new session
- `CLAUDE.md` created with project rules (had not been written before context was lost)
- `HISTORY.md` created (this file) to prevent future context loss
- Both `CLAUDE.md` and `HISTORY.md` updated with full architecture, decisions, and build state

### What's next
- File 2: `web/index.html` + `web/css/theme.css` — UI shell only (two inputs, button, status area, map div)
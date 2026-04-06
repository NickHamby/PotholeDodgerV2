# String Sanitization Plan for PotholeDodger

**Status:** Planning  
**Target branch:** `copilot/docs-user-input-sanitization-plan`  
**Last updated:** 2026-04-03

---

## 1. Audit of All String Entry Points

The following table maps every place where a user-supplied or data-supplied string is consumed for matching or geocoding:

| # | File | Function / Location | Input source | Current sanitization | Nominatim? | Internal matching? |
|---|------|---------------------|--------------|---------------------|------------|--------------------|
| 1 | `web/js/app.js` | `attachAutocomplete()` — the `query` variable (line ~17) | `inputEl.value.trim()` | `.trim()` only | ✅ yes — sent to Nominatim `/search` | ❌ no |
| 2 | `web/js/app.js` | `run()` — the `origin` / `destination` variables (line ~74) | `getElementById(...).value.trim()` | `.trim()` only | ✅ yes — passed to `geocodeAddress()` | ❌ no |
| 3 | `web/js/geocode.js` | `geocodeAddress(address)` — `address` param | Caller (app.js) | None | ✅ yes — `encodeURIComponent(address)` on query | ❌ no |
| 4 | `web/js/hazards.js` | `normalizeStreet(str)` — hazard `.location` strings | `web/data/hazards.json` | ABBR_MAP + strip leading house numbers + strip non-alphanumeric | ❌ no | ✅ yes — matched against OSRM step names |
| 5 | `web/js/hazards.js` | `normalizeStreet(str)` — OSRM segment names (via `normalizedSegments`) | `routing.js` → `streetSegments[].name` | Same `normalizeStreet()` | ❌ no | ✅ yes — matched against hazard location tokens |
| 6 | `web/js/routing.js` | `getRoute()` — `step.name` used as `streetMap` key | OSRM API response | None | ❌ no | ✅ yes — becomes `streetSegments[].name` |

### Key gaps identified

- **Entry points 1–3** receive raw user text with no protection against special characters, extra whitespace, parentheticals, or ZIP codes before hitting Nominatim.
- **Entry point 6** passes OSRM step names straight into `streetMap` with no normalization; mismatches with hazard location strings arise from casing, abbreviation, and directional-prefix differences.
- **Entry points 4–5** share `normalizeStreet()`, which handles abbreviations and leading house numbers, but does not strip ZIP codes, handle address ranges, handle trailing directionals, or handle bare street names.

---

## 2. Proposed `sanitizeInput(str)` Function

### Design decisions

| Decision | Recommendation | Rationale |
|----------|---------------|-----------|
| Own file or existing file? | New file: `web/js/sanitize.js` | Keeps the function pure, independently testable, and imported before all consumers. |
| Apply abbreviation expansion before Nominatim? | **No** — keep abbreviation expansion only in `normalizeStreet()`. | Nominatim handles abbreviations natively. Expanding `"St"→"Street"` before sending to Nominatim is harmless but unnecessary and risks mangling legitimate place names (e.g. a city called "St. Louis"). |
| Strip commas before Nominatim? | **No** — commas are meaningful Nominatim field separators (city, state, country). | |
| Strip ZIP codes before Nominatim? | **No** — Nominatim resolves addresses with or without ZIP codes just fine. Strip ZIPs only inside `normalizeStreet()` for internal matching. | |
| Apply at input time or submit time? | **Both** — sanitize the autocomplete `query` on every keystroke (before the debounce check), and sanitize origin/destination at submit time inside `run()`. | Sanitizing on keystroke improves autocomplete result quality. Sanitizing at submit prevents junk reaching `geocodeAddress()`. |

### Function signature

```js
/**
 * Sanitizes a raw user-supplied address string for use as a Nominatim query
 * or as one side of an internal street-name comparison.
 *
 * Does NOT expand abbreviations (leave that to normalizeStreet).
 * Does NOT strip commas (Nominatim uses them as field separators).
 * Does NOT modify coordinates (lat/lng values must never pass through here).
 *
 * @param {string} str  Raw input string
 * @returns {string}    Cleaned string, safe for use in Nominatim queries
 */
function sanitizeInput(str) { ... }
```

### Full pseudocode

```
function sanitizeInput(str):
  if str is not a string or str is empty:
    return ''

  // Step 1 — remove parenthetical context
  //   "Main St (near the park)" → "Main St "
  s = str.replace(/\([^)]*\)/g, '')

  // Step 2 — remove characters that break Nominatim or have no address meaning
  //   Keep: letters, digits, spaces, commas, hyphens, forward slashes (for fractional house numbers like "8 1/2")
  //   Remove: # " ' . ; : ! ? @ ^ * [ ] { } | \ ~ ` = + < > % & _
  //   Note: ampersand (&) is kept only for internal matching (intersection separator).
  //   For Nominatim queries, & can be encoded harmlessly via encodeURIComponent,
  //   but it does not help geocoding, so strip it here.
  s = s.replace(/[^a-zA-Z0-9\s,\-\/]/g, '')

  // Step 3 — collapse multiple consecutive spaces into a single space
  s = s.replace(/\s{2,}/g, ' ')

  // Step 4 — trim leading and trailing whitespace
  s = s.trim()

  return s
```

### Character-by-character disposition

| Character | Keep? | Reason |
|-----------|-------|--------|
| Letters `a-z A-Z` | ✅ | Core address content |
| Digits `0-9` | ✅ | House numbers, street numbers |
| Comma `,` | ✅ | Nominatim field separator (`"Richmond, VA"`) |
| Hyphen `-` | ✅ | Address ranges (`"4628-4998 Commerce Road"`) and hyphenated street names |
| Forward slash `/` | ✅ | Fractional house numbers (`"8 1/2"`) |
| Space | ✅ | Word separator |
| `(` `)` | ❌ | Parentheticals; strip content within them first (Step 1), then strip the characters |
| `'` apostrophe | ❌ | Breaks some query parsers; edge case: `"O'Brien Rd"` — after stripping becomes `"OBrien Rd"` which still geocodes correctly in Nominatim (see §8 Edge Cases) |
| `"` quote | ❌ | No address meaning |
| `#` | ❌ | No Nominatim meaning for street addresses |
| `.` period | ❌ | `"St."` → `"St"` is safe; Nominatim handles both |
| `&` ampersand | ❌ | Not meaningful to Nominatim; stripped here. Hazard location strings (which use `&` as an intersection separator) **never pass through `sanitizeInput()`** — they come from `hazards.json` and go directly to `normalizeStreet()`. `sanitizeInput()` is only called on user-typed input in the origin/destination fields. Therefore stripping `&` here has no effect on internal hazard matching. |
| `;` `:` `!` `?` `@` `^` `*` `[` `]` `{` `}` `\|` `\\` `~` `` ` `` `=` `+` `<` `>` `%` `_` | ❌ | No address meaning |

---

## 3. Autocomplete-Specific Considerations

### 3.1 Debounce threshold — raw chars or sanitized chars?

**Recommendation:** Count **sanitized** characters.

`sanitizeInput` is called before the length check. If the raw string is `"  M "` (4 chars, 1 meaningful), the sanitized result is `"M"` (1 char) and the debounce will correctly not fire. This prevents unnecessary Nominatim calls triggered by whitespace-only or punctuation-only input.

```js
// Current code (app.js ~17):
const query = inputEl.value.trim();
if (query.length < 3) { hideList(); return; }

// Proposed change:
const query = sanitizeInput(inputEl.value);   // replaces .trim()
if (query.length < 3) { hideList(); return; }
```

### 3.2 Displaying autocomplete results — raw or sanitized `display_name`?

**Recommendation:** Display the **raw** `result.display_name` from Nominatim exactly as returned.

`display_name` values like `"Arthur Ashe Boulevard, Richmond, Virginia, 23220, United States"` are well-formed and human-readable. Sanitizing them would degrade the user experience (e.g. removing commas) and is unnecessary because they originate from Nominatim, not user input.

### 3.3 When a suggestion is selected — what goes into the input, and what's passed to `geocodeAddress()`?

**Current behavior:** When the user clicks an autocomplete suggestion, `inputEl.value` is set to the full `display_name`, e.g.:
```
"Arthur Ashe Boulevard, Richmond, Virginia, 23220, United States"
```

**Recommendation:** Place the full `display_name` into the input field unchanged (for user-readability), but pass `sanitizeInput(inputEl.value)` to `geocodeAddress()` at submit time (via `run()`). Do **not** strip after the first comma.

**Rationale:** Nominatim performs well with the full `"Street, City, State, ZIP, Country"` format — the extra specificity actually improves result accuracy. Stripping after the first comma would drop `"Richmond, Virginia"`, risking results from another city with the same street name.

The only risk is that a `display_name` might contain characters like `'` or `#` that `sanitizeInput` strips. In practice, Nominatim `display_name` values do not contain these characters, so this is safe.

---

## 4. Hazard Location String Normalization

### Current `normalizeStreet()` behavior

```js
function normalizeStreet(str) {
  let s = str;
  for (const [pattern, replacement] of ABBR_MAP) {
    s = s.replace(pattern, replacement);         // expand abbreviations
  }
  s = s.replace(/^\d+(\s+\d+\/\d+)?\s+/, '');  // strip leading house number
  s = s.replace(/[^a-zA-Z0-9\s]/g, '');         // strip punctuation
  return s.trim().toLowerCase();
}
```

### Problems with the current implementation

| Pattern | Input | Current output | Problem |
|---------|-------|---------------|---------|
| ZIP code at end | `"8 1/2 W Canal St, 23220"` | `"west canal street 23220"` | ZIP code `23220` remains; it can spuriously appear as part of the street name in a contains-check |
| Address range | `"4628-4998 Commerce Road"` | `"commerce road"` (leading `4628` stripped, `-4998` stripped as punctuation) | Accidentally works for the street name, but the house number extracted for range-check (`/^(\d+)/`) returns `4628`, which is correct. However, if the hazard is truly at `4628-4998`, using only the lower bound may miss hazards near `4998`. |
| Trailing directional | `"3001-3023 Williamsburg Ave E"` | `"williamsburg avenue east"` (after abbreviation expansion) | ✅ Already works correctly if `E` appears after `Ave`/`Avenue` and ABBR_MAP expansion order is correct. **Risk:** `S` (South) and `S` (street suffix) overlap — `"Commerce S"` would expand `S` to `South`, making `"Commerce South"` rather than `"Commerce Street"`. The ABBR_MAP currently has `\bSt\b → Street` and `\bS\b → South`. If input is `"Commerce S"`, `\bS\b` fires, giving `"Commerce South"`. This is wrong. See §8 Edge Cases. |
| Trailing directional | `"Hull St & W 14th St"` | Split on `&` gives tokens `["hull street", "west 14th street"]` | ✅ Already works correctly. |
| Bare street name | `"Byrd"` | `"byrd"` | ✅ Works — the token is just `"byrd"`. It will match any OSRM street segment whose normalized name contains `"byrd"`. No house number is extracted (null), so the range check is bypassed. |
| Fractional house number | `"8 1/2 W Canal St, 23220"` | `"west canal street 23220"` | ZIP remains (same as row 1). |

### Proposed changes to `normalizeStreet()`

Add the following transformations **in order**:

1. **Strip trailing ZIP code** — remove a 5-digit ZIP (with optional leading comma/space) at the end of the string, before abbreviation expansion.
   - Pattern: `s = s.replace(/[,\s]+\d{5}\s*$/, '')`
   - Before: `"8 1/2 W Canal St, 23220"` → After: `"8 1/2 W Canal St"`

2. **Fix directional-vs-suffix ambiguity in ABBR_MAP** — the single-letter directionals (`W`, `E`, `N`, `S`) must not fire if the letter is being used as a street-type abbreviation suffix (e.g., `"S"` for South in `"Commerce S"` is valid; `"S"` for the South directional in `"S Main St"` is also valid). The current regex `\bS\b` cannot distinguish these two uses.

   **Proposed fix:** Move directional expansion to a separate, position-aware step *after* street-type abbreviation expansion, and only expand a directional letter when it is:
   - At the beginning of the remaining string (prefix directional), **or**
   - At the very end of the string (suffix directional), **after** other abbreviations have already been expanded.

   This requires splitting `ABBR_MAP` into two groups:
   ```
   STREET_TYPE_ABBRS = [ St→Street, Ave→Avenue, Blvd→Boulevard, Dr→Drive, 
                         Rd→Road, Pkwy→Parkway, Ln→Lane, Ct→Court ]
   DIRECTIONAL_ABBRS = [ W→West, E→East, N→North, S→South ]
   ```

   Apply `STREET_TYPE_ABBRS` first (using `\bX\b`), then apply `DIRECTIONAL_ABBRS` only at word boundaries that are either the **start of the string** or the **end of the string**:
   ```
   s = s.replace(/^(W|E|N|S)\b/, match => expand(match))   // prefix directional
   s = s.replace(/\b(W|E|N|S)$/, match => expand(match))   // suffix directional
   ```

3. **Strip trailing ZIP code** must happen before step 2, otherwise `"23220"` at end could interfere with the suffix directional regex.

4. **Address range — house number extraction:** The current code already extracts only the leading number via `/^(\d+)/`, which gives the lower bound of a range. The `HOUSE_NUMBER_BUFFER` of 100 extends the match window. For large ranges (e.g. `"4628-4998"`, a span of 370), the lower bound plus the buffer may leave the upper portion of the range unmatched. **Implementing midpoint extraction (`(lower + upper) / 2`) is deferred as a separate enhancement** — it requires updating both `normalizeStreet()` and `getHazardsOnRoute()` (the caller that extracts `hazardNum` via `/^(\d+)/`). The ready-to-copy `normalizeStreet()` in §11 retains the current lower-bound behavior; see §9 for the known limitation and proposed improvement.

### Updated `normalizeStreet()` pseudocode

```
const STREET_TYPE_ABBRS = [
  [/\bSt\b/g, 'Street'],
  [/\bAve\b/g, 'Avenue'],
  [/\bBlvd\b/g, 'Boulevard'],
  [/\bDr\b/g, 'Drive'],
  [/\bRd\b/g, 'Road'],
  [/\bPkwy\b/g, 'Parkway'],
  [/\bLn\b/g, 'Lane'],
  [/\bCt\b/g, 'Court'],
]

const DIRECTIONAL_EXPAND = { W: 'West', E: 'East', N: 'North', S: 'South' }

function normalizeStreet(str):
  s = str

  // 1. Strip trailing ZIP code (5-digit, optionally preceded by comma/space)
  s = s.replace(/[,\s]+\d{5}\s*$/, '')

  // 2. Expand street type abbreviations
  for [pattern, replacement] in STREET_TYPE_ABBRS:
    s = s.replace(pattern, replacement)

  // 3. Expand directionals only at start and end of string
  s = s.replace(/^(W|E|N|S)\b\s*/, d => DIRECTIONAL_EXPAND[d.trim()] + ' ')
  s = s.replace(/\s*(W|E|N|S)$/, d => ' ' + DIRECTIONAL_EXPAND[d.trim()])

  // 4. Strip leading house numbers (including fractional like "8 1/2")
  s = s.replace(/^\d+(\s+\d+\/\d+)?\s+/, '')

  // 5. Strip remaining punctuation
  s = s.replace(/[^a-zA-Z0-9\s]/g, '')

  // 6. Collapse whitespace and trim
  s = s.replace(/\s{2,}/g, ' ')
  return s.trim().toLowerCase()
```

### Before/after examples

| Input | Current output | Proposed output |
|-------|---------------|-----------------|
| `"8 1/2 W Canal St, 23220"` | `"west canal street 23220"` | `"west canal street"` |
| `"Hull St & W 14th St"` | token 1: `"hull street"`, token 2: `"west 14th street"` | same ✅ |
| `"4628-4998 Commerce Road"` | `"commerce road"` | `"commerce road"` ✅ |
| `"Byrd"` | `"byrd"` | `"byrd"` ✅ |
| `"3001-3023 Williamsburg Ave E"` | `"williamsburg avenue east"` | `"williamsburg avenue east"` ✅ (now via explicit suffix directional rule) |
| `"715 N 5th St"` | `"north 5th street"` | `"north 5th street"` ✅ (N at start) |
| `"Commerce S"` (hypothetical; `S` = South suffix) | `"commerce south"` ✅ | `"commerce south"` ✅ |
| `"Commerce St, 23220"` | `"commerce street 23220"` | `"commerce street"` ✅ ZIP stripped |

---

## 5. OSRM Step Name Normalization

OSRM returns fully expanded, clean step names like `"Arthur Ashe Boulevard"`, `"West Broad Street"`, `"North 5th Street"`. These are already in the form that `normalizeStreet()` can handle.

### The mismatch problem

Hazard data uses abbreviated, direction-prefixed forms like `"715 N 5th St"`. After `normalizeStreet()`, this becomes `"north 5th street"`. OSRM says `"North 5th Street"`. After `normalizeStreet()` applied to the OSRM name, that also becomes `"north 5th street"`. So the match works.

The remaining risk is when OSRM includes a directional prefix (`"North 5th Street"`) but the hazard data records it without (`"5th Street"`). In this case:
- OSRM normalized → `"north 5th street"`
- Hazard token normalized → `"5th street"`
- The `token.includes(seg.name)` check: `"5th street".includes("north 5th street")` → **false**
- The `seg.name.includes(token)` check: `"north 5th street".includes("5th street")` → **true** ✅

The bidirectional `includes` already handles this. No change to OSRM name handling is required.

**Recommendation:** Apply the same `normalizeStreet()` to OSRM step names as is already done (it is already applied in `getHazardsOnRoute()`). Ensure that the updated `normalizeStreet()` (with the ZIP-stripping and fixed directional expansion) is applied consistently to both sides of the comparison.

### Casing

Both sides are lowercased by `normalizeStreet()`. No separate casing step is needed.

### Stripping directionals entirely vs. normalizing and keeping them

**Recommendation: Normalize and keep directionals.**

Stripping directionals would cause `"North 5th Street"` and `"South 5th Street"` to both collapse to `"5th street"`, creating false matches between streets on opposite sides of town. Normalizing (expanding abbreviations) and keeping them is safer.

---

## 6. Where Sanitization Should NOT Happen

| Context | Rule |
|---------|------|
| Coordinate values (`lat`, `lng` floats) | Never pass through `sanitizeInput`. They are numbers, not strings. |
| Nominatim API response bodies | Never sanitize. `display_name`, `address.*`, `lat`, `lon` are trusted API data. |
| OSRM API response bodies | Never sanitize raw JSON. Only normalize `step.name` via `normalizeStreet()` for matching. |
| Strings already passed to `encodeURIComponent()` | `sanitizeInput` runs *before* `encodeURIComponent`, not after. |
| Commas in strings going directly to Nominatim | Do not strip commas before Nominatim calls. They are field separators. |

---

## 7. Migration Path

### 7.1 New file to create

**`web/js/sanitize.js`**

This file exports a single function `sanitizeInput(str)`. Keeping it separate:
- Makes it independently testable.
- Avoids circular dependencies (it is imported by both `app.js` and potentially `geocode.js`).
- Follows the one-file-one-responsibility pattern already established by `geocode.js`, `routing.js`, etc.

### 7.2 Files to modify

| File | Change |
|------|--------|
| `web/index.html` | Add `<script src="js/sanitize.js"></script>` **before** `<script src="js/geocode.js"></script>` so `sanitizeInput` is available to all subsequent scripts. |
| `web/js/app.js` | In `attachAutocomplete()`: replace `const query = inputEl.value.trim()` with `const query = sanitizeInput(inputEl.value)`. In `run()`: replace `.value.trim()` with `sanitizeInput(document.getElementById(...).value)` for both `origin` and `destination`. |
| `web/js/geocode.js` | No change required. `geocodeAddress(address)` already calls `encodeURIComponent(address)`. The caller (`app.js`) will now pass a sanitized string. |
| `web/js/hazards.js` | Update `normalizeStreet()` as described in §4: add ZIP-stripping, split `ABBR_MAP` into `STREET_TYPE_ABBRS` + positional directional expansion. |
| `web/js/routing.js` | No change required. OSRM `step.name` values are clean; they are normalized when consumed by `getHazardsOnRoute()` in `hazards.js`. |

### 7.3 New `<script>` tag in `index.html`

Current script load order:
```html
<script src="js/geocode.js"></script>
<script src="js/routing.js"></script>
<script src="js/hazards.js"></script>
<script src="js/map.js"></script>
<script src="js/app.js"></script>
```

New script load order:
```html
<script src="js/sanitize.js"></script>   <!-- ADD THIS LINE FIRST -->
<script src="js/geocode.js"></script>
<script src="js/routing.js"></script>
<script src="js/hazards.js"></script>
<script src="js/map.js"></script>
<script src="js/app.js"></script>
```

### 7.4 Apply at input time or submit time?

**Both:**

| When | Where | Why |
|------|-------|-----|
| **Keystroke (input time)** | `attachAutocomplete()` in `app.js` | Sanitize `query` before the debounce check and before the Nominatim fetch. Improves autocomplete result quality on every keystroke. |
| **Submit time** | `run()` in `app.js` | Sanitize both `origin` and `destination` values before passing to `geocodeAddress()`. Catches junk that may have been typed directly without using autocomplete. |
| **Hazard data load time** | `getHazardsOnRoute()` in `hazards.js` | `normalizeStreet()` is already called on every hazard location token. The proposed updates to `normalizeStreet()` make this correct. No additional call to `sanitizeInput` is needed here — hazard data does not go to Nominatim. |

---

## 8. Entry Point → Sanitization Step Mapping Table

| Entry point | `sanitizeInput()` | ZIP strip | Abbr expand | Directional expand | House num strip | Punctuation strip | Notes |
|-------------|-------------------|-----------|-------------|-------------------|-----------------|-------------------|-------|
| Autocomplete query (`app.js`) | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ (via sanitizeInput) | ZIPs fine for Nominatim; abbr/directional not needed before Nominatim |
| Geocode address (`app.js` → `geocode.js`) | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ (via sanitizeInput) | Same as above |
| Hazard location tokens (`hazards.js`) | ❌ | ✅ (via normalizeStreet) | ✅ (via normalizeStreet) | ✅ (via normalizeStreet) | ✅ (via normalizeStreet) | ✅ (via normalizeStreet) | Internal matching only; sanitizeInput not called here |
| OSRM step names (`hazards.js` via normalizedSegments) | ❌ | ✅ (via normalizeStreet) | ✅ (via normalizeStreet) | ✅ (via normalizeStreet) | ✅ (via normalizeStreet) | ✅ (via normalizeStreet) | OSRM names are clean; normalizeStreet is still applied for consistency |
| Coordinates (`routing.js`, `geocode.js`) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | Never sanitize numeric values |
| Nominatim API responses | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | Trusted API data; never sanitize |

---

## 9. Edge Cases and Risks

| Edge case | Risk | Recommendation |
|-----------|------|---------------|
| Irish/possessive street names (`"O'Brien Rd"`) | `sanitizeInput` strips `'`, producing `"OBrien Rd"`. Nominatim returns the same result for both forms. | **Acceptable** — Nominatim handles `"OBrien"` and `"O'Brien"` identically. No special handling needed. |
| Street names with numbers as ordinals (`"1st Avenue"`, `"14th Street"`) | `normalizeStreet` strips the leading house number pattern `/^\d+(\s+\d+\/\d+)?\s+/`. For `"1st Avenue"`, the pattern requires `\s+` after the digit, so `"1st"` (digit followed by `st`) will **not** match. | ✅ Safe — `"1st"` is not `"\d+\s+"`. |
| `"S"` as street-type suffix vs. `"S"` as directional | Current ABBR_MAP expands all `\bS\b` to `"South"`, which can mangle `"Commerce S"` if `S` was intended as `"Street"` abbreviation. | Addressed by splitting directional expansion into positional-only rules (§4 proposed fix). |
| Fractional house numbers (`"8 1/2 W Canal St"`) | The existing `/^\d+(\s+\d+\/\d+)?\s+/` regex already handles this. The `/` in the fraction is preserved by `sanitizeInput` (forward slash is kept). | ✅ No change needed. |
| Very short sanitized strings (`"A"`, `""`) | If `sanitizeInput` reduces input to < 3 characters, autocomplete will correctly not fire. `geocodeAddress` will throw `"No results found for: ..."`. | ✅ Already handled by length check. |
| Autocomplete `display_name` as input to `geocodeAddress` | `display_name` like `"Arthur Ashe Boulevard, Richmond, Virginia, 23220, United States"` contains no dangerous characters. `sanitizeInput` will pass it through cleanly. | ✅ Safe. |
| Street names with `&` in OSRM step names | OSRM does not use `&` in step names. This separator is only in hazard data, which is split on `&` before `normalizeStreet` is called. | ✅ No conflict. |
| ZIP code `23220` matching a house number | If a hazard's location is `"Commerce St, 23220"` and `normalizeStreet` does not strip the ZIP, the string becomes `"commerce street 23220"`. A `contains` check against an OSRM step name `"commerce street"` would succeed (`"commerce street".includes("commerce street 23220")` → false, but `"commerce street 23220".includes("commerce street")` → true). So this accidentally works today — but it could cause a false positive if there is a street literally named `"Commerce Street 23220"` (there isn't). The proposed ZIP-stripping is still the correct fix. | Strip ZIPs in `normalizeStreet` as proposed. |
| Address range lower bound vs. true hazard position | `"4628-4998 Commerce Road"` — the house number `4628` is extracted for range checking, but the hazard could be anywhere up to `4998`. The `HOUSE_NUMBER_BUFFER` of 100 extends the match window by 100 in each direction. For a range spanning 370 numbers, this is inadequate. | **Proposed improvement:** When a range is detected (`/^(\d+)-(\d+)/`), use the midpoint `(lower + upper) / 2` as the effective house number for range-checking. This keeps the hazard within `HOUSE_NUMBER_BUFFER` of the actual segment endpoint. |
| Bare street name `"Byrd"` | No house number extracted; `hazardNum === null` bypasses range check. This means ALL segments named `"byrd"` will match regardless of position. Since `"Byrd"` likely refers to Byrd Street/Park, this is acceptable. | ✅ Acceptable. |

---

## 10. Complete `sanitizeInput` Implementation (Ready to Copy)

```js
// sanitize.js — sanitizes raw user input before geocoding or internal matching

/**
 * Sanitizes a raw user-supplied address string for use as a Nominatim query.
 *
 * - Trims leading/trailing whitespace
 * - Collapses multiple spaces into one
 * - Strips parenthetical context (e.g. "(near the park)")
 * - Removes characters that break queries: # " ' . ; : ! ? @ ^ * [ ] { } | \ ~ ` = + < > % & _
 * - Preserves commas (Nominatim field separators), hyphens (address ranges), slashes (fractions)
 * - Does NOT expand abbreviations (leave that to normalizeStreet in hazards.js)
 * - Does NOT strip ZIP codes (Nominatim handles them; strip only inside normalizeStreet)
 * - Must never be called on coordinate (lat/lng) values
 *
 * @param {string} str  Raw input string
 * @returns {string}    Sanitized string safe for Nominatim queries
 */
function sanitizeInput(str) {
  if (typeof str !== 'string') return '';
  let s = str;
  // Remove parenthetical content
  s = s.replace(/\([^)]*\)/g, '');
  // Keep: letters, digits, spaces, commas, hyphens, forward slashes
  s = s.replace(/[^a-zA-Z0-9\s,\-\/]/g, '');
  // Collapse multiple spaces
  s = s.replace(/\s{2,}/g, ' ');
  return s.trim();
}
```

---

## 11. Updated `normalizeStreet()` Implementation (Ready to Copy)

```js
// In hazards.js — replace the existing ABBR_MAP + normalizeStreet with the following:

const STREET_TYPE_ABBRS = [
  [/\bSt\b/g, 'Street'],
  [/\bAve\b/g, 'Avenue'],
  [/\bBlvd\b/g, 'Boulevard'],
  [/\bDr\b/g, 'Drive'],
  [/\bRd\b/g, 'Road'],
  [/\bPkwy\b/g, 'Parkway'],
  [/\bLn\b/g, 'Lane'],
  [/\bCt\b/g, 'Court'],
];

const DIRECTIONAL_EXPAND = {
  W: 'West',
  E: 'East',
  N: 'North',
  S: 'South',
};

function normalizeStreet(str) {
  let s = str;

  // 1. Strip trailing ZIP code (5 digits, optionally preceded by comma and/or space)
  s = s.replace(/[,\s]+\d{5}\s*$/, '');

  // 2. Expand street type abbreviations
  for (const [pattern, replacement] of STREET_TYPE_ABBRS) {
    s = s.replace(pattern, replacement);
  }

  // 3. Expand directionals at start of string (prefix directional)
  //    The \s* in the pattern consumes any space that followed the directional letter,
  //    and the replacement appends one space back, so "W Main St" → "West Main St".
  //    Any edge-case double-spaces are collapsed by step 7.
  s = s.replace(/^(W|E|N|S)\b\s*/, (_, d) => DIRECTIONAL_EXPAND[d] + ' ');

  // 4. Expand directionals at end of string (suffix directional)
  //    The \s+ in the pattern consumes the space before the directional letter,
  //    and the replacement prepends one space back, so "Williamsburg Avenue E" → "Williamsburg Avenue East".
  //    Any edge-case double-spaces are collapsed by step 7.
  s = s.replace(/\s+(W|E|N|S)$/, (_, d) => ' ' + DIRECTIONAL_EXPAND[d]);

  // 5. Strip leading house numbers (including fractional like "8 1/2")
  s = s.replace(/^\d+(\s+\d+\/\d+)?\s+/, '');

  // 6. Strip remaining punctuation
  s = s.replace(/[^a-zA-Z0-9\s]/g, '');

  // 7. Collapse whitespace and trim, lowercase
  s = s.replace(/\s{2,}/g, ' ');
  return s.trim().toLowerCase();
}
```

---

## Summary Checklist for Implementation

- [ ] Create `web/js/sanitize.js` with the `sanitizeInput(str)` function from §10
- [ ] Add `<script src="js/sanitize.js"></script>` as the first script tag in `web/index.html`
- [ ] In `web/js/app.js` `attachAutocomplete()`: replace `inputEl.value.trim()` with `sanitizeInput(inputEl.value)`
- [ ] In `web/js/app.js` `run()`: replace `document.getElementById('origin').value.trim()` and `document.getElementById('destination').value.trim()` with `sanitizeInput(document.getElementById('origin').value)` and `sanitizeInput(document.getElementById('destination').value)`
- [ ] In `web/js/hazards.js`: replace `ABBR_MAP` + `normalizeStreet()` with the updated version from §11 (adds ZIP stripping, splits directional expansion into positional rules)
- [ ] Write tests for `sanitizeInput()` covering: empty string, whitespace-only, parentheticals, special chars, commas preserved, hyphens preserved, slashes preserved, normal address
- [ ] Write tests for updated `normalizeStreet()` covering: ZIP suffix, address range, trailing directional, bare street name, fractional house number, prefix directional, intersection token split

// hazards.js — loads hazard data and filters it to streets matching the route

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
  s = s.replace(/^(W|E|N|S)\b\s*/, (_, d) => DIRECTIONAL_EXPAND[d] + ' ');

  // 4. Expand directionals at end of string (suffix directional)
  s = s.replace(/\s+(W|E|N|S)$/, (_, d) => ' ' + DIRECTIONAL_EXPAND[d]);

  // 5. Strip leading house numbers (including fractional like "8 1/2")
  s = s.replace(/^\d+(\s+\d+\/\d+)?\s+/, '');

  // 6. Strip remaining punctuation
  s = s.replace(/[^a-zA-Z0-9\s]/g, '');

  // 7. Collapse whitespace and trim, lowercase
  s = s.replace(/\s{2,}/g, ' ');
  return s.trim().toLowerCase();
}

async function getAllHazards() {
  const response = await fetch('web/data/hazards.json');
  if (!response.ok) {
    throw new Error(`Failed to load hazards: ${response.status} ${response.statusText}`);
  }
  return await response.json();
}

async function getHazardsOnRoute(streetSegments) {
  const response = await fetch('web/data/hazards.json');
  if (!response.ok) {
    throw new Error(`Failed to load hazards: ${response.status} ${response.statusText}`);
  }
  const hazards = await response.json();

  const normalizedSegments = streetSegments.map(seg => ({
    name:   normalizeStreet(seg.name),
    minLat: seg.minLat,
    maxLat: seg.maxLat,
    minLng: seg.minLng,
    maxLng: seg.maxLng,
  }));

  console.log('[hazards] normalized route street segments:', normalizedSegments);

  return hazards.filter(hazard => {
    // Guard: skip malformed coordinates
    if (hazard.latitude == null || hazard.longitude == null) return false;

    const tokens = hazard.location.split('&').map(normalizeStreet);

    const matched = tokens.some(token =>
      normalizedSegments.some(seg => {
        // Part 1: street name must match
        const nameMatch = seg.name.includes(token) || token.includes(seg.name);
        if (!nameMatch) return false;

        // Part 2: coordinates must fall within bounding box
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

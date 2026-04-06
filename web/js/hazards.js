// hazards.js — loads hazard data and filters it to streets matching the route

const ABBR_MAP = [
  [/\bSt\b/g, 'Street'],
  [/\bAve\b/g, 'Avenue'],
  [/\bBlvd\b/g, 'Boulevard'],
  [/\bDr\b/g, 'Drive'],
  [/\bRd\b/g, 'Road'],
  [/\bPkwy\b/g, 'Parkway'],
  [/\bLn\b/g, 'Lane'],
  [/\bCt\b/g, 'Court'],
  [/\bW\b/g, 'West'],
  [/\bE\b/g, 'East'],
  [/\bN\b/g, 'North'],
  [/\bS\b/g, 'South'],
];

function normalizeStreet(str) {
  let s = str;
  for (const [pattern, replacement] of ABBR_MAP) {
    s = s.replace(pattern, replacement);
  }
  // Strip leading house numbers (including fractional like "8 1/2") but preserve
  // street numbers that are part of the name (e.g. "1st Avenue")
  s = s.replace(/^\d+(\s+\d+\/\d+)?\s+/, '');
  s = s.replace(/[^a-zA-Z0-9\s]/g, '');
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

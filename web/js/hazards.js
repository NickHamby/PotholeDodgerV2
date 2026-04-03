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

const HOUSE_NUMBER_BUFFER = 100;

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

async function getHazardsOnRoute(streetSegments) {
  const response = await fetch('web/data/hazards.json');
  if (!response.ok) {
    throw new Error(`Failed to load hazards: ${response.status} ${response.statusText}`);
  }
  const hazards = await response.json();

  const normalizedSegments = streetSegments.map(seg => ({
    name: normalizeStreet(seg.name),
    minNum: seg.minNum,
    maxNum: seg.maxNum
  }));

  console.log('[hazards] normalized route street segments:', normalizedSegments);

  return hazards.filter(hazard => {
    const houseNumMatch = hazard.location.match(/^(\d+)/);
    const hazardNum = houseNumMatch ? parseInt(houseNumMatch[1], 10) : null;
    const tokens = hazard.location.split('&').map(normalizeStreet);
    const matched = tokens.some(token =>
      normalizedSegments.some(seg => {
        const nameMatch = seg.name.includes(token) || token.includes(seg.name);
        if (!nameMatch) return false;
        if (hazardNum === null) return true;
        return hazardNum >= seg.minNum - HOUSE_NUMBER_BUFFER && hazardNum <= seg.maxNum + HOUSE_NUMBER_BUFFER;
      })
    );
    console.log(`[hazards] "${hazard.location}" → tokens: ${JSON.stringify(tokens)} → ${matched ? 'INCLUDED' : 'excluded'}`);
    return matched;
  });
}

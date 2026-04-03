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

export function normalizeStreet(str) {
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

export async function getHazardsOnRoute(streetNames) {
  const response = await fetch('web/data/hazards.json');
  if (!response.ok) {
    throw new Error(`Failed to load hazards: ${response.status} ${response.statusText}`);
  }
  const hazards = await response.json();

  const normalizedRouteNames = streetNames.map(normalizeStreet);

  return hazards.filter(hazard => {
    const tokens = hazard.location.split('&').map(normalizeStreet);
    return tokens.some(token =>
      normalizedRouteNames.some(
        routeName => routeName.includes(token) || token.includes(routeName)
      )
    );
  });
}

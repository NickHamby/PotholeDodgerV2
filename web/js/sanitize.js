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

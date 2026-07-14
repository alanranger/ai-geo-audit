/**
 * Per-keyword DataForSEO tracking location for SERP rank + AI Mode.
 *
 * Authoritative source (Alan signed off 2026-07-12):
 *   config/keyword-tracking-locations-LOCKED.csv
 *   → lib/keyword-ranking/keyword-tracking-locations-LOCKED.json
 *
 * Rebuild JSON after CSV edits:
 *   node scripts/build-keyword-tracking-locations.mjs
 *
 * Unmapped / new keywords default to UK national and flag `unmapped: true`
 * so the dashboard can show "unmapped" instead of silent pattern-guessing.
 *
 * Historical keyword_rankings rows with NULL location_name = legacy national.
 */

import locked from './keyword-tracking-locations-LOCKED.json' with { type: 'json' };

export const LOCATION_NATIONAL = {
  location_name: 'United Kingdom',
  location_code: 2826,
  tier: 'N',
};

export const LOCATION_LOCAL = {
  location_name: 'Coventry,England,United Kingdom',
  // Borough code for exact DFS name "Coventry,England,United Kingdom".
  // Name-only requests intermittently return empty SERPs (HTTP 200, no items).
  location_code: 9215523,
  tier: 'L',
};

const BY_KEYWORD = locked.by_keyword || {};

export function normalizeTrackingKeyword(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Workshops tracked nationally even when the query says "near me". */
export function isWorkshopTrackingKeyword(keyword) {
  const k = normalizeTrackingKeyword(keyword);
  return /\bworkshops?\b/.test(k) || /\bholidays?\b/.test(k);
}

export function isProximityNoisyNational(keyword) {
  const k = normalizeTrackingKeyword(keyword);
  return isWorkshopTrackingKeyword(k) && /\bnear me\b/.test(k);
}

/**
 * @returns {{
 *   location_name: string,
 *   location_code: number|null,
 *   tier: 'L'|'N',
 *   proximity_noisy?: boolean,
 *   unmapped?: boolean,
 *   target_page?: string|null
 * }}
 */
export function resolveTrackingLocation(keyword) {
  const k = normalizeTrackingKeyword(keyword);
  if (!k) return { ...LOCATION_NATIONAL, unmapped: true };

  const row = BY_KEYWORD[k];
  if (!row) {
    return {
      ...LOCATION_NATIONAL,
      unmapped: true,
      proximity_noisy: isProximityNoisyNational(k),
    };
  }

  const isLocal = String(row.tracking_location).toLowerCase() === 'local';
  const base = isLocal
    ? {
        ...LOCATION_LOCAL,
        location_name: row.location_name_dfs || LOCATION_LOCAL.location_name,
      }
    : {
        ...LOCATION_NATIONAL,
        location_name: row.location_name_dfs || LOCATION_NATIONAL.location_name,
      };

  return {
    ...base,
    proximity_noisy: !isLocal && isProximityNoisyNational(k),
    unmapped: false,
    target_page: row.target_page || null,
  };
}

/** Short label for dashboard cells. */
export function trackingLocationLabel(loc) {
  if (!loc || !loc.location_name) return '—';
  if (loc.unmapped) return 'UK (unmapped)';
  if (loc.tier === 'L' || /coventry/i.test(loc.location_name)) return 'Coventry';
  if (loc.proximity_noisy) return 'UK ⚠';
  return 'UK';
}

export function lockedKeywordCount() {
  return Object.keys(BY_KEYWORD).length;
}

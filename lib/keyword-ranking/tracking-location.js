/**
 * Per-keyword DataForSEO tracking location for SERP rank + AI Mode.
 *
 * Tier L (Coventry): local-buyer service terms (near-me + non-geo courses/hire/etc.)
 * Tier N (United Kingdom): workshops (incl. "near me"), online, geo-explicit, brand/other.
 *
 * Historical keyword_rankings rows with NULL location_name = legacy national.
 */

export const LOCATION_NATIONAL = {
  location_name: 'United Kingdom',
  location_code: 2826,
  tier: 'N',
};

export const LOCATION_LOCAL = {
  location_name: 'Coventry,England,United Kingdom',
  location_code: null,
  tier: 'L',
};

const LOCAL_STEMS = [
  'photography course',
  'photography courses',
  'photography class',
  'photography classes',
  'photography lesson',
  'photography lessons',
  'beginners photography',
  'beginner photography',
  'beginning photography',
  'camera courses for beginners',
  'lightroom course',
  'lightroom courses',
  'photo editing course',
  'photo editing classes',
  'photography evening classes',
  'photography training',
  'best photography course',
  'best photography classes',
  'private photography',
  'photography tuition',
  'photography tutor',
  'photography mentor',
  'photography mentoring',
  'hire a photographer',
  'hire a professional photographer',
  'professional photographer',
  'commercial photographer',
  'commercial photography services',
  'rps courses',
  'professional headshots',
  'business headshots',
  'corporate headshots',
];

export function normalizeTrackingKeyword(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
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

function isOnlineKeyword(k) {
  return /\bonline\b/.test(k);
}

function isGeoExplicitKeyword(k) {
  return /\bcoventry\b|\bwarwickshire\b|\bwarwick\b|\bbirmingham\b/.test(k);
}

function isLocalBuyerStem(k) {
  if (/\bnear me\b/.test(k)) return true;
  return LOCAL_STEMS.some((stem) => k.includes(stem));
}

/**
 * @returns {{ location_name: string, location_code: number|null, tier: 'L'|'N', proximity_noisy?: boolean }}
 */
export function resolveTrackingLocation(keyword) {
  const k = normalizeTrackingKeyword(keyword);
  if (!k) return { ...LOCATION_NATIONAL };

  if (isWorkshopTrackingKeyword(k)) {
    return {
      ...LOCATION_NATIONAL,
      proximity_noisy: isProximityNoisyNational(k),
    };
  }
  if (isOnlineKeyword(k) || isGeoExplicitKeyword(k)) {
    return { ...LOCATION_NATIONAL };
  }
  if (isLocalBuyerStem(k)) {
    return { ...LOCATION_LOCAL };
  }
  return { ...LOCATION_NATIONAL };
}

/** Short label for dashboard cells. */
export function trackingLocationLabel(loc) {
  if (!loc || !loc.location_name) return '—';
  if (loc.tier === 'L' || /coventry/i.test(loc.location_name)) return 'Coventry';
  if (loc.proximity_noisy) return 'UK ⚠';
  return 'UK';
}

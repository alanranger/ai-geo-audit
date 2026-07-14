/**
 * Tracked keyword set v3 (2026-07-14): 90 → 98 keywords.
 * Removals are exact-match (case-sensitive for the capitalised duplicate).
 */

export const TRACKED_SET_CHANGE_DATE = '2026-07-14';

/** Exact keyword strings removed from tracking (historical rows retained). */
export const REMOVED_FROM_TRACKING_EXACT = Object.freeze([
  'photography tips',
  'photography blog',
  'Landscape Photography Workshops',
]);

/** Legacy segment overrides (segment_source = manual). */
export const SEGMENT_OVERRIDES = Object.freeze({
  'photography tutor': 'money',
  'photography tuition': 'money',
  'professional commercial photography': 'money',
  'corporate photography': 'money',
  'photography holidays uk': 'money',
  'photography presents': 'money',
  'rps distinctions': 'money',
  'photography course': 'money',
  'photographer near me': 'money',
  'photographer for hire': 'money',
  'basic photography lessons': 'money',
  'photography workshops coventry': 'money',
  'photography courses online': 'money',
  'free photography courses': 'money',
  'free online photography courses': 'money',
  'online photography courses uk': 'money',
  'photography experience gifts': 'money',
  'outdoor photography training': 'money',
});

export function normalizeTrackedKeyword(value) {
  return String(value || '').trim();
}

export function isRemovedFromTracking(keyword) {
  const k = normalizeTrackedKeyword(keyword);
  return k.length > 0 && REMOVED_FROM_TRACKING_EXACT.includes(k);
}

export function isTrackedKeyword(keyword) {
  const k = normalizeTrackedKeyword(keyword);
  return k.length > 0 && !isRemovedFromTracking(k);
}

export function filterTrackedKeywords(keywords) {
  return (keywords || [])
    .map((kw) => normalizeTrackedKeyword(kw))
    .filter((kw) => isTrackedKeyword(kw));
}

export function filterTrackedRows(rows) {
  return (rows || []).filter((row) => isTrackedKeyword(row?.keyword));
}

export function resolveSegmentOverride(keyword) {
  const k = normalizeTrackedKeyword(keyword).toLowerCase();
  return SEGMENT_OVERRIDES[k] || null;
}

/**
 * Tracked-set segment for write + render.
 * Brand stays brand; everything else is money (no education/other on the live set).
 */
export function resolveTrackedSegment(keyword, keywordClass = null, existingSegment = null) {
  const k = normalizeTrackedKeyword(keyword).toLowerCase();
  if (!k) return 'money';
  if (keywordClass === 'brand' || k === 'alan ranger' || k === 'alan ranger photography') {
    return 'brand';
  }
  const override = SEGMENT_OVERRIDES[k];
  if (override) return override;
  const existing = String(existingSegment || '').trim().toLowerCase();
  if (existing === 'brand') return 'brand';
  return 'money';
}

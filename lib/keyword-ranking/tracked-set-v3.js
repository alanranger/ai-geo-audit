/**
 * Tracked keyword set v3 (2026-07-14): 90 → 87 keywords.
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

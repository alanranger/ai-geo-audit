/**
 * Locked keyword class lookup (v2 CSV).
 * Lookup only — no pattern guessing. Unmapped → national-money + class_unmapped.
 */

import locked from './keyword-tracking-class-LOCKED.json' with { type: 'json' };

export const KEYWORD_CLASSES = Object.freeze([
  'local-money',
  'regional-money',
  'national-money',
  'brand',
  'education',
]);

const BY_KEYWORD = locked.by_keyword || {};

export function normalizeClassKeyword(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * @returns {{
 *   keyword_class: 'local-money'|'regional-money'|'national-money'|'brand'|'education',
 *   class_unmapped: boolean,
 *   tracking_location?: string|null,
 *   target_page?: string|null
 * }}
 */
export function resolveKeywordClass(keyword) {
  const k = normalizeClassKeyword(keyword);
  if (!k) {
    return { keyword_class: 'national-money', class_unmapped: true };
  }
  const row = BY_KEYWORD[k];
  if (!row || !row.keyword_class) {
    return { keyword_class: 'national-money', class_unmapped: true };
  }
  const cls = String(row.keyword_class).trim();
  if (!KEYWORD_CLASSES.includes(cls)) {
    return { keyword_class: 'national-money', class_unmapped: true };
  }
  return {
    keyword_class: cls,
    class_unmapped: false,
    tracking_location: row.tracking_location || null,
    target_page: row.target_page || null,
  };
}

export function lockedClassKeywordCount() {
  return Object.keys(BY_KEYWORD).length;
}

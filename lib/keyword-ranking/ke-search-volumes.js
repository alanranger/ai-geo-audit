/**
 * Keywords Everywhere UK search volumes (2026-07-14 export).
 * Used to seed null/zero volumes without overwriting existing non-null values.
 */

import volumes from './ke-search-volumes.json' with { type: 'json' };

const BY_KEYWORD = volumes.by_keyword || {};

export function normalizeKeKeyword(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** @returns {number|null} KE volume or null if unknown */
export function resolveKeSearchVolume(keyword) {
  const k = normalizeKeKeyword(keyword);
  if (!k || !(k in BY_KEYWORD)) return null;
  const vol = BY_KEYWORD[k];
  return Number.isFinite(Number(vol)) ? Number(vol) : null;
}

/** Fill null/zero only — never overwrite a positive stored volume. */
export function coalesceSearchVolume(keyword, stored) {
  const n = Number(stored);
  if (Number.isFinite(n) && n > 0) return n;
  const ke = resolveKeSearchVolume(keyword);
  return ke != null ? ke : (Number.isFinite(n) ? n : null);
}

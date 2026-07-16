/**
 * Tracked-keyword empty-SERP stubs (2026-07-16).
 * When DFS returns no stack/rank for a LOCKED tracked keyword, persist a stub
 * row instead of silently omitting it from the audit_date snapshot.
 *
 * `error` is a save-keyword-batch request-body gate only (not a DB column).
 * Persisted marker: serp_features.stub + serp_features.fetch_error.
 */

import { resolveKeywordClass } from './tracking-class.js';
import { resolveTrackingLocation } from './tracking-location.js';
import { coalesceSearchVolume } from './ke-search-volumes.js';

export const EMPTY_SERP_STUB_ERROR = 'empty_serp_surface_stack';

export function isLockedTrackedKeyword(keyword) {
  return resolveKeywordClass(keyword).class_unmapped === false;
}

export function isEmptySerpSignal(row) {
  if (!row) return true;
  const stack = row.serp_surface_stack;
  const emptyStack = !Array.isArray(stack) || stack.length === 0;
  const noRank = row.best_rank_absolute == null && row.best_rank_group == null;
  return emptyStack && noRank;
}

export function buildTrackedEmptySerpStub(row) {
  const keyword = String(row?.keyword || '').trim();
  const cls = resolveKeywordClass(keyword);
  const loc = resolveTrackingLocation(keyword);
  const features = (row?.serp_features && typeof row.serp_features === 'object')
    ? { ...row.serp_features }
    : {};
  features.stub = true;
  features.fetch_error = EMPTY_SERP_STUB_ERROR;

  return {
    ...row,
    keyword,
    best_rank_group: null,
    best_rank_absolute: null,
    best_url: row?.best_url || null,
    best_title: row?.best_title || keyword,
    serp_surface_stack: null,
    error: EMPTY_SERP_STUB_ERROR,
    keyword_class: row?.keyword_class || cls.keyword_class,
    class_unmapped: cls.class_unmapped,
    location_name: row?.location_name || loc.location_name,
    location_unmapped: row?.location_unmapped === true || loc.unmapped === true,
    search_volume: coalesceSearchVolume(keyword, row?.search_volume ?? null),
    serp_features: features,
    segment_reason: row?.segment_reason || EMPTY_SERP_STUB_ERROR,
  };
}

/** Convert empty/failed LOCKED tracked rows into saveable stubs. Untracked unchanged. */
export function applyTrackedEmptySerpStubs(rows) {
  return (rows || []).map((row) => {
    if (!row?.keyword || !isLockedTrackedKeyword(row.keyword)) return row;
    if (!isEmptySerpSignal(row)) return row;
    return buildTrackedEmptySerpStub(row);
  });
}

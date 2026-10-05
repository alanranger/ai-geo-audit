/**
 * Tracked-keyword empty-SERP stubs (2026-07-16).
 * When DFS returns no stack/rank for a LOCKED tracked keyword, persist a stub
 * row instead of silently omitting it from the audit_date snapshot.
 *
 * `error` is a save-keyword-batch request-body gate only (not a DB column).
 * Persisted marker: serp_features.stub + serp_features.fetch_error + capture_status.
 */

import { resolveKeywordClass } from './tracking-class.js';
import { resolveTrackingLocation } from './tracking-location.js';
import { coalesceSearchVolume } from './ke-search-volumes.js';
import { stampLocalCaptureOnRow } from './local-capture-preflight.js';
import {
  EMPTY_SERP_STUB_ERROR,
  CAPTURE_STATUS,
  buildSerpCaptureFeatures,
  isFailedSerpCapture,
} from './dfs-serp-quality.js';

export { EMPTY_SERP_STUB_ERROR };

export function isLockedTrackedKeyword(keyword) {
  return resolveKeywordClass(keyword).class_unmapped === false;
}

export function organicCountOf(row) {
  const n = Number(row?.organic_count ?? row?.serp_features?.organic_count ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function isEmptySerpSignal(row) {
  if (!row) return true;
  // Incomplete thin crawls may keep a stack — not an empty stub.
  if (row.crawl_incomplete === true) return false;
  if (row.serp_features?.capture_status === CAPTURE_STATUS.INCOMPLETE) return false;
  // Paid SERP with organics but missing stack is incomplete, not empty.
  if (organicCountOf(row) > 0) return false;
  const stack = row.serp_surface_stack;
  const emptyStack = !Array.isArray(stack) || stack.length === 0;
  const noRank = row.best_rank_absolute == null && row.best_rank_group == null;
  return emptyStack && noRank;
}

/** Mark incomplete when organics exist but stack is missing — do not wipe as empty. */
export function buildTrackedIncompleteSerpRow(row) {
  const keyword = String(row?.keyword || '').trim();
  const cls = resolveKeywordClass(keyword);
  const loc = resolveTrackingLocation(keyword);
  const org = organicCountOf(row);
  const features = buildSerpCaptureFeatures(row?.serp_features, {
    capture_status: CAPTURE_STATUS.INCOMPLETE,
    crawl_incomplete: true,
    organic_count: org,
    dfs_cost: row?.dfs_cost ?? row?.serp_features?.dfs_cost ?? null,
    se_results_count: row?.se_results_count ?? row?.serp_features?.se_results_count ?? null,
    serp_depth: row?.serp_depth ?? 50,
    location_code: row?.location_code ?? loc.location_code,
    location_coordinate: row?.location_coordinate ?? null,
    error: 'DFS incomplete crawl (organics present, serp_surface_stack missing)',
    fetch_error: 'DFS incomplete crawl (organics present, serp_surface_stack missing)',
    checked_at: new Date().toISOString(),
    best_rank_group: row?.best_rank_group ?? null,
    best_rank_absolute: row?.best_rank_absolute ?? null,
    serp_surface_stack: row?.serp_surface_stack ?? null,
  });
  return stampLocalCaptureOnRow({
    ...row,
    keyword,
    crawl_incomplete: true,
    error: 'DFS incomplete crawl (organics present, serp_surface_stack missing)',
    organic_count: org,
    keyword_class: row?.keyword_class || cls.keyword_class,
    class_unmapped: cls.class_unmapped,
    location_name: row?.location_name || loc.location_name,
    location_unmapped: row?.location_unmapped === true || loc.unmapped === true,
    search_volume: coalesceSearchVolume(keyword, row?.search_volume ?? null),
    serp_features: features,
  });
}

export function buildTrackedEmptySerpStub(row) {
  const keyword = String(row?.keyword || '').trim();
  const cls = resolveKeywordClass(keyword);
  const loc = resolveTrackingLocation(keyword);
  const features = buildSerpCaptureFeatures(row?.serp_features, {
    capture_status: CAPTURE_STATUS.EMPTY,
    crawl_incomplete: true,
    organic_count: row?.organic_count ?? 0,
    dfs_cost: row?.dfs_cost ?? null,
    se_results_count: row?.se_results_count ?? null,
    serp_depth: row?.serp_depth ?? 50,
    location_code: row?.location_code ?? loc.location_code,
    location_coordinate: null,
    error: EMPTY_SERP_STUB_ERROR,
    fetch_error: EMPTY_SERP_STUB_ERROR,
    checked_at: new Date().toISOString(),
    best_rank_group: null,
    best_rank_absolute: null,
    serp_surface_stack: null,
  });

  const stub = {
    ...row,
    keyword,
    best_rank_group: null,
    best_rank_absolute: null,
    best_url: null,
    best_title: row?.best_title || keyword,
    serp_surface_stack: null,
    error: EMPTY_SERP_STUB_ERROR,
    crawl_incomplete: true,
    organic_count: row?.organic_count ?? 0,
    keyword_class: row?.keyword_class || cls.keyword_class,
    class_unmapped: cls.class_unmapped,
    location_name: row?.location_name || loc.location_name,
    location_unmapped: row?.location_unmapped === true || loc.unmapped === true,
    search_volume: coalesceSearchVolume(keyword, row?.search_volume ?? null),
    serp_features: features,
    segment_reason: row?.segment_reason || EMPTY_SERP_STUB_ERROR,
  };
  return stampLocalCaptureOnRow(stub);
}

/** Convert empty/failed LOCKED tracked rows into saveable stubs. Untracked unchanged. */
export function applyTrackedEmptySerpStubs(rows) {
  return (rows || []).map((row) => {
    if (!row?.keyword || !isLockedTrackedKeyword(row.keyword)) return row;
    // Incomplete-with-diagnostics already saveable — do not overwrite as empty stub.
    if (isFailedSerpCapture(row) && row.serp_features?.capture_status === CAPTURE_STATUS.INCOMPLETE) {
      return row;
    }
    const stack = row.serp_surface_stack;
    const emptyStack = !Array.isArray(stack) || stack.length === 0;
    if (emptyStack && organicCountOf(row) > 0) {
      return buildTrackedIncompleteSerpRow(row);
    }
    if (!isEmptySerpSignal(row)) return row;
    return buildTrackedEmptySerpStub(row);
  });
}

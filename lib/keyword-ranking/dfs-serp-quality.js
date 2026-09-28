/**
 * Detect DataForSEO Live Advanced crawls that accepted depth>10 but only
 * returned a page-1 / degraded SERP (status 20000, often cost ≈ $0.002).
 * Those must not be persisted as confident "unranked".
 *
 * Capture status lives on serp_features (compatible JSON — no migration).
 */

export const SERP_CRAWL_INCOMPLETE_ERROR = 'DFS incomplete crawl (thin SERP vs requested depth)';
export const EMPTY_SERP_STUB_ERROR = 'empty_serp_surface_stack';

/** @typedef {'complete_ranked'|'complete_no_match'|'incomplete'|'empty'|'error'} SerpCaptureStatus */

export const CAPTURE_STATUS = {
  COMPLETE_RANKED: 'complete_ranked',
  COMPLETE_NO_MATCH: 'complete_no_match',
  INCOMPLETE: 'incomplete',
  EMPTY: 'empty',
  ERROR: 'error',
};

/** Primary Local series (restored): Coventry code + verified GBP pin. */
export const GEO_METHOD_GBP_PIN = 'gbp_pin';
/** Separate Local series (Sep28 city-only day / opt-in city measurements). Never mix with pin. */
export const GEO_METHOD_CITY_CODE = 'coventry_city_code';
export const GEO_METHOD_NATIONAL = 'uk_national';
export const METHOD_VERSION_LOCAL_PIN = 'local_gbp_pin_v1';
export const METHOD_VERSION_LOCAL_CITY = 'local_city_code_v1';
export const METHOD_VERSION_NATIONAL = 'national_uk_v1';
/**
 * Calendar day Local captures used city-code only (no GBP pin). That day's Local
 * observations are a separate series — do not compare to pin history or relabel.
 * Going forward (pin restored) pre-Sep28 pin history is comparable again.
 */
export const GEO_METHOD_CITY_ONLY_DATE = '2026-09-28';
/** @deprecated alias — prefer GEO_METHOD_CITY_ONLY_DATE / isCityOnlyLocalGeoDate */
export const GEO_METHOD_BREAK_DATE = GEO_METHOD_CITY_ONLY_DATE;
export const GEO_METHOD_BREAK_NOTE =
  'Local pin series restored. Do not compare to 2026-09-28 city-code-only Local ranks; city-wide is a separate method.';
/** Rows saved before capture_status existed — measurable but not proven complete. */
export const CAPTURE_LEGACY_UNVERIFIED = 'legacy_unverified';

/** @param {{ depth?: number, organicCount?: number, itemsCount?: number, seResultsCount?: number|null, cost?: number|null, error?: string|null }} p */
export function isIncompleteSerpCrawl(p = {}) {
  const depth = Number(p.depth) || 0;
  const organicCount = Number(p.organicCount) || 0;
  const itemsCount = Number(p.itemsCount) || 0;
  const seResultsCount = p.seResultsCount == null ? null : Number(p.seResultsCount);
  const cost = p.cost == null ? null : Number(p.cost);
  const err = p.error ? String(p.error) : '';

  if (itemsCount <= 0) return true;
  if (err && /empty SERP|Unexpected server|request failed/i.test(err) && organicCount <= 0) {
    return true;
  }

  // Relative to requested depth: page-1-only deliveries look like ~6–12 organics
  // when we asked for 50. Full crawls typically return 40+.
  const minOrganic = depth >= 50 ? 15 : depth >= 30 ? 12 : depth >= 20 ? 8 : 0;
  if (minOrganic > 0 && organicCount < minOrganic) return true;

  // Live base price is $0.002 for page 1; depth 50 should bill multi-page (~$0.008+).
  if (depth >= 40 && cost != null && Number.isFinite(cost) && cost > 0 && cost <= 0.0025) {
    return true;
  }

  // DFS sometimes reports se_results_count ≈ organic count on thin crawls (6–8)
  // while a healthy UK SERP reports hundreds+.
  if (
    depth >= 40
    && seResultsCount != null
    && Number.isFinite(seResultsCount)
    && seResultsCount > 0
    && seResultsCount < 20
    && organicCount < 15
  ) {
    return true;
  }

  return false;
}

/**
 * Resolve capture status for a SERP row (after retries).
 * Incomplete/empty/error are NOT genuine unranked.
 */
export function resolveSerpCaptureStatus(row = {}) {
  const features = (row.serp_features && typeof row.serp_features === 'object')
    ? row.serp_features
    : {};
  if (features.capture_status) return String(features.capture_status);

  if (row.crawl_incomplete === true) return CAPTURE_STATUS.INCOMPLETE;
  if (features.stub === true || features.fetch_error === EMPTY_SERP_STUB_ERROR) {
    return CAPTURE_STATUS.EMPTY;
  }
  const err = row.error ? String(row.error) : '';
  if (err === SERP_CRAWL_INCOMPLETE_ERROR) return CAPTURE_STATUS.INCOMPLETE;
  if (err === EMPTY_SERP_STUB_ERROR) return CAPTURE_STATUS.EMPTY;
  if (err && /empty SERP|request failed|Unexpected server|timed out|Aborted after fatal/i.test(err)) {
    return CAPTURE_STATUS.ERROR;
  }

  const stack = row.serp_surface_stack;
  const emptyStack = !Array.isArray(stack) || stack.length === 0;
  const noRank = row.best_rank_group == null && row.best_rank_absolute == null;
  if (emptyStack && noRank) return CAPTURE_STATUS.EMPTY;
  if (noRank) return CAPTURE_STATUS.COMPLETE_NO_MATCH;
  return CAPTURE_STATUS.COMPLETE_RANKED;
}

/** Failed observation — must not count as confident unranked in scores/coverage. */
export function isFailedSerpCapture(row = {}) {
  const status = resolveSerpCaptureStatus(row);
  return status === CAPTURE_STATUS.INCOMPLETE
    || status === CAPTURE_STATUS.EMPTY
    || status === CAPTURE_STATUS.ERROR;
}

/** Complete crawl where Alan was absent from organic within requested depth. */
export function isCompleteSerpNoMatch(row = {}) {
  return resolveSerpCaptureStatus(row) === CAPTURE_STATUS.COMPLETE_NO_MATCH;
}

export function hasExplicitCaptureStatus(row = {}) {
  const s = row?.serp_features?.capture_status;
  return !!(s && String(s).trim());
}

/**
 * Rollup/UI quality kind. Unlike resolveSerpCaptureStatus, does NOT invent
 * complete_* for legacy rows that never stored capture_status.
 */
export function resolveCaptureQualityKind(row = {}) {
  const features = (row.serp_features && typeof row.serp_features === 'object')
    ? row.serp_features
    : {};
  if (features.capture_status) return String(features.capture_status);

  if (row.crawl_incomplete === true) return CAPTURE_STATUS.INCOMPLETE;
  if (features.stub === true || features.fetch_error === EMPTY_SERP_STUB_ERROR) {
    return CAPTURE_STATUS.EMPTY;
  }
  const err = row.error ? String(row.error) : '';
  if (err === SERP_CRAWL_INCOMPLETE_ERROR) return CAPTURE_STATUS.INCOMPLETE;
  if (err === EMPTY_SERP_STUB_ERROR) return CAPTURE_STATUS.EMPTY;
  if (err && /empty SERP|request failed|Unexpected server|timed out|Aborted after fatal/i.test(err)) {
    return CAPTURE_STATUS.ERROR;
  }

  const stack = row.serp_surface_stack;
  const emptyStack = !Array.isArray(stack) || stack.length === 0;
  const noRank = row.best_rank_group == null && row.best_rank_absolute == null;
  if (emptyStack && noRank) return CAPTURE_STATUS.EMPTY;
  return CAPTURE_LEGACY_UNVERIFIED;
}

export function isFailedCaptureQuality(row = {}) {
  const kind = resolveCaptureQualityKind(row);
  return kind === CAPTURE_STATUS.INCOMPLETE
    || kind === CAPTURE_STATUS.EMPTY
    || kind === CAPTURE_STATUS.ERROR;
}

/** Include in score means / coverage denominators (excludes incomplete/empty/error). */
export function isMeasurableForRollup(row = {}) {
  return !isFailedCaptureQuality(row);
}

/** True when prior audit_date is the city-code-only Local day (incomparable to pin). */
export function isCityOnlyLocalGeoDate(dateStr) {
  if (!dateStr) return false;
  return String(dateStr).slice(0, 10) === GEO_METHOD_CITY_ONLY_DATE;
}

/**
 * @deprecated Prefer isCityOnlyLocalGeoDate. Kept for callers; now means
 * "prior Local day is the city-only island", not "all history before break".
 */
export function isPreGeoMethodBreakDate(dateStr) {
  return isCityOnlyLocalGeoDate(dateStr);
}

export function resolveGeoMethod(row = {}) {
  const feats = (row?.serp_features && typeof row.serp_features === 'object')
    ? row.serp_features
    : {};
  if (feats.geo_method) return String(feats.geo_method);
  if (row.location_coordinate) return GEO_METHOD_GBP_PIN;
  if (Number(row.location_code) === 9215523) return GEO_METHOD_CITY_CODE;
  if (Number(row.location_code) === 2826) return GEO_METHOD_NATIONAL;
  return null;
}

export function resolveMethodVersion(row = {}) {
  const feats = (row?.serp_features && typeof row.serp_features === 'object')
    ? row.serp_features
    : {};
  if (feats.method_version) return String(feats.method_version);
  const geo = resolveGeoMethod(row);
  if (geo === GEO_METHOD_GBP_PIN) return METHOD_VERSION_LOCAL_PIN;
  if (geo === GEO_METHOD_CITY_CODE) return METHOD_VERSION_LOCAL_CITY;
  if (geo === GEO_METHOD_NATIONAL) return METHOD_VERSION_NATIONAL;
  return null;
}

/** Historical comparison requires matching geo method (national↔national, pin↔pin). */
export function geoMethodsComparable(a, b) {
  const ga = resolveGeoMethod(a);
  const gb = resolveGeoMethod(b);
  if (!ga || !gb) return false;
  return ga === gb;
}

export function summarizeSerpCaptureCoverage(rows = []) {
  let tracked = 0;
  let measurable = 0;
  let knownComplete = 0;
  let legacy = 0;
  let incomplete = 0;
  let empty = 0;
  let error = 0;
  for (const row of rows || []) {
    if (!row) continue;
    tracked += 1;
    const kind = resolveCaptureQualityKind(row);
    if (kind === CAPTURE_STATUS.INCOMPLETE) { incomplete += 1; continue; }
    if (kind === CAPTURE_STATUS.EMPTY) { empty += 1; continue; }
    if (kind === CAPTURE_STATUS.ERROR) { error += 1; continue; }
    measurable += 1;
    if (kind === CAPTURE_LEGACY_UNVERIFIED) legacy += 1;
    else if (
      kind === CAPTURE_STATUS.COMPLETE_RANKED
      || kind === CAPTURE_STATUS.COMPLETE_NO_MATCH
    ) {
      knownComplete += 1;
    } else {
      legacy += 1;
    }
  }
  const failed = incomplete + empty + error;
  return {
    tracked,
    measurable,
    known_complete: knownComplete,
    legacy_unverified: legacy,
    incomplete,
    empty,
    error,
    failed,
    provisional: failed > 0 || legacy > 0 || measurable < tracked,
  };
}

export function formatCaptureCoverageLine(cov = {}) {
  const tracked = Number(cov.tracked) || 0;
  const measured = Number(cov.measurable) || 0;
  const failed = Number(cov.failed) || 0;
  const legacy = Number(cov.legacy_unverified) || 0;
  const parts = [`${measured} measured of ${tracked} tracked`];
  if (failed > 0) parts.push(`${failed} incomplete/empty/error`);
  if (legacy > 0) parts.push(`${legacy} legacy quality unavailable`);
  if (cov.provisional) parts.push('provisional — not all checks known-complete');
  parts.push('tracked denominator kept (excluding unknowns does not inflate the score)');
  return parts.join(' · ');
}

export function defaultSerpDepth(depth) {
  const n = Number(depth);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 50;
}

/**
 * Build serp_features capture diagnostics (merged into existing features object).
 * Prefer this JSON over new DB columns.
 */
export function buildSerpCaptureFeatures(baseFeatures, meta = {}) {
  const features = (baseFeatures && typeof baseFeatures === 'object')
    ? { ...baseFeatures }
    : {};
  const depth = defaultSerpDepth(meta.serp_depth ?? meta.depth);
  const organicCount = meta.organic_count != null ? Number(meta.organic_count) : null;
  const status = meta.capture_status
    || resolveSerpCaptureStatus({
      ...meta,
      serp_features: features,
      best_rank_group: meta.best_rank_group,
      best_rank_absolute: meta.best_rank_absolute,
      serp_surface_stack: meta.serp_surface_stack,
    });

  features.capture_status = status;
  features.crawl_incomplete = status === CAPTURE_STATUS.INCOMPLETE
    || meta.crawl_incomplete === true;
  if (organicCount != null && Number.isFinite(organicCount)) {
    features.organic_count = organicCount;
  }
  if (meta.dfs_cost != null && Number.isFinite(Number(meta.dfs_cost))) {
    features.dfs_cost = Number(meta.dfs_cost);
  }
  if (meta.se_results_count != null && Number.isFinite(Number(meta.se_results_count))) {
    features.se_results_count = Number(meta.se_results_count);
  }
  features.serp_depth_requested = depth;
  if (meta.checked_at) features.capture_checked_at = String(meta.checked_at);
  if (meta.dfs_task_id) features.dfs_task_id = String(meta.dfs_task_id);
  if (meta.fetch_error || meta.error) {
    features.fetch_error = String(meta.fetch_error || meta.error);
  }
  if (status === CAPTURE_STATUS.EMPTY) {
    features.stub = true;
    features.fetch_error = features.fetch_error || EMPTY_SERP_STUB_ERROR;
  }
  // Geography method + version (pin series vs city series vs national).
  if (meta.geo_method) features.geo_method = String(meta.geo_method);
  else if (meta.location_coordinate) features.geo_method = GEO_METHOD_GBP_PIN;
  else if (Number(meta.location_code) === 9215523) features.geo_method = GEO_METHOD_CITY_CODE;
  else if (Number(meta.location_code) === 2826) features.geo_method = GEO_METHOD_NATIONAL;

  if (meta.method_version) features.method_version = String(meta.method_version);
  else if (features.geo_method === GEO_METHOD_GBP_PIN) features.method_version = METHOD_VERSION_LOCAL_PIN;
  else if (features.geo_method === GEO_METHOD_CITY_CODE) features.method_version = METHOD_VERSION_LOCAL_CITY;
  else if (features.geo_method === GEO_METHOD_NATIONAL) features.method_version = METHOD_VERSION_NATIONAL;

  // Optional last successful rank — never written into best_rank_*.
  if (meta.last_good_rank_group != null) {
    features.last_good_rank_group = Number(meta.last_good_rank_group);
  }
  if (meta.last_good_rank_absolute != null) {
    features.last_good_rank_absolute = Number(meta.last_good_rank_absolute);
  }
  if (meta.last_good_url) features.last_good_url = String(meta.last_good_url);
  if (meta.last_good_at) features.last_good_at = String(meta.last_good_at);

  // Dated last *confirmed* position (confirmation state machine) — never current.
  if (meta.last_confirmed_rank_group != null) {
    features.last_confirmed_rank_group = Number(meta.last_confirmed_rank_group);
  }
  if (meta.last_confirmed_rank_absolute != null) {
    features.last_confirmed_rank_absolute = Number(meta.last_confirmed_rank_absolute);
  }
  if (meta.last_confirmed_url) features.last_confirmed_url = String(meta.last_confirmed_url);
  if (meta.last_confirmed_at) features.last_confirmed_at = String(meta.last_confirmed_at);
  if (meta.last_confirmed_geo_method) {
    features.last_confirmed_geo_method = String(meta.last_confirmed_geo_method);
  }
  if (meta.confirmation_state) features.confirmation_state = String(meta.confirmation_state);
  if (Array.isArray(meta.confirmation_observations)) {
    features.confirmation_observations = meta.confirmation_observations.slice(0, 4);
  }

  return features;
}

/**
 * When a failed capture would overwrite a good same-day rank, stash last_good
 * from the previous row without treating it as current.
 */
export function attachLastGoodFromPrevious(features, previousRow) {
  const out = (features && typeof features === 'object') ? { ...features } : {};
  if (!previousRow) return out;
  const prevStatus = resolveSerpCaptureStatus(previousRow);
  const prevGood = previousRow.best_rank_group != null
    && (prevStatus === CAPTURE_STATUS.COMPLETE_RANKED || !previousRow.serp_features?.capture_status);
  if (prevGood) {
    out.last_good_rank_group = Number(previousRow.best_rank_group);
    if (previousRow.best_rank_absolute != null) {
      out.last_good_rank_absolute = Number(previousRow.best_rank_absolute);
    }
    if (previousRow.best_url) out.last_good_url = String(previousRow.best_url);
    out.last_good_at = String(
      previousRow.last_refreshed_at
      || previousRow.updated_at
      || previousRow.serp_features?.capture_checked_at
      || ''
    ) || new Date().toISOString();
    return out;
  }
  const pf = previousRow.serp_features || {};
  if (pf.last_good_rank_group != null && out.last_good_rank_group == null) {
    out.last_good_rank_group = Number(pf.last_good_rank_group);
    if (pf.last_good_rank_absolute != null) out.last_good_rank_absolute = Number(pf.last_good_rank_absolute);
    if (pf.last_good_url) out.last_good_url = String(pf.last_good_url);
    if (pf.last_good_at) out.last_good_at = String(pf.last_good_at);
  }
  return out;
}

/** UI / metric helper: organic depth label (default 50). */
export function organicDepthLabel(row = {}) {
  const fromFeat = row?.serp_features?.serp_depth_requested;
  return defaultSerpDepth(row.serp_depth ?? fromFeat ?? 50);
}

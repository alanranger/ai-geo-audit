/**
 * Monday Ranking Acceptance Gate — post-finalize integrity checks.
 * Failed days mark ranking_incomplete so CEO / get-latest skip them.
 */

import { computeSurfaceVisibilityRollup } from '../audit/surfaceScores.js';
import { isMeasurableForRollup } from './dfs-serp-quality.js';
import { assessRankingCompleteness } from './ranking-completeness.js';

export const PACK_MISMATCH_MAX = 0;
export const MEASURABLE_MIN_PCT = 0.9;
export const CLASS_COUNT_MIN_PCT = 0.85;
/** Large Surface drop only fails when pack integrity is also broken. */
export const SURFACE_DROP_ALERT_PTS = 15;

function stackHasPack(row) {
  const stack = Array.isArray(row?.serp_surface_stack) ? row.serp_surface_stack : [];
  return stack.some((e) => e?.type === 'local_pack');
}

/** Evidence pack was on the SERP (stack, features, or position). */
export function hasPackEvidence(row) {
  if (stackHasPack(row)) return true;
  if (row?.serp_features?.local_pack === true) return true;
  const pos = row?.local_pack_position;
  return pos != null && Number(pos) > 0;
}

export function countPackFlagMismatches(rows) {
  let n = 0;
  for (const row of rows || []) {
    if (hasPackEvidence(row) && row?.local_pack_present_any !== true) n += 1;
  }
  return n;
}

function pushCheck(checks, id, ok, detail, warn = false) {
  checks.push({ id, ok, detail, warn: warn === true });
}

/**
 * @param {object[]} rows keyword_rankings (prefer DB)
 * @param {{
 *   expectedTracked?: number,
 *   priorSurface?: number|null,
 *   priorLocalN?: number|null,
 *   priorNationalN?: number|null,
 *   dialSource?: string,
 * }} [opts]
 */
export function assessRankingAcceptance(rows, opts = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const completeness = assessRankingCompleteness(list);
  const packMismatches = countPackFlagMismatches(list);
  const measurable = list.filter((r) => isMeasurableForRollup(r)).length;
  const expectedN = Number(opts.expectedTracked) > 0 ? Number(opts.expectedTracked) : list.length;
  const minMeasurable = Math.floor(expectedN * MEASURABLE_MIN_PCT);
  const rollup = computeSurfaceVisibilityRollup(list);
  const localN = rollup.byClass?.['local-money']?.count ?? 0;
  const nationalN = rollup.byClass?.['national-money']?.count ?? 0;
  const surface = rollup.overall;
  const checks = [];

  pushCheck(
    checks,
    'completeness',
    !completeness.incomplete,
    completeness.reason || `null_stack ${completeness.null_stack}/${completeness.n}`
  );
  pushCheck(
    checks,
    'pack_flag_vs_stack',
    packMismatches <= PACK_MISMATCH_MAX,
    packMismatches ? `${packMismatches} pack flag mismatches` : '0 mismatches'
  );
  pushCheck(
    checks,
    'measurable_coverage',
    list.length >= minMeasurable && measurable >= minMeasurable,
    `${measurable}/${list.length} measurable (need ≥${minMeasurable} of ${expectedN})`
  );

  let classOk = true;
  let classDetail = `local ${localN}, national ${nationalN}`;
  if (opts.priorLocalN != null && Number(opts.priorLocalN) > 0) {
    const floor = Math.floor(Number(opts.priorLocalN) * CLASS_COUNT_MIN_PCT);
    if (localN < floor) {
      classOk = false;
      classDetail += ` (local < ${floor} vs prior ${opts.priorLocalN})`;
    }
  }
  if (opts.priorNationalN != null && Number(opts.priorNationalN) > 0) {
    const floor = Math.floor(Number(opts.priorNationalN) * CLASS_COUNT_MIN_PCT);
    if (nationalN < floor) {
      classOk = false;
      classDetail += ` (national < ${floor} vs prior ${opts.priorNationalN})`;
    }
  }
  pushCheck(checks, 'class_counts', classOk, classDetail);

  let dropPts = null;
  let dropOk = true;
  let dropDetail = 'no prior surface';
  let dropWarn = false;
  if (opts.priorSurface != null && Number.isFinite(Number(opts.priorSurface)) && surface != null) {
    dropPts = Number(opts.priorSurface) - Number(surface);
    dropDetail = `surface ${opts.priorSurface}→${surface} (drop ${dropPts})`;
    if (dropPts >= SURFACE_DROP_ALERT_PTS && packMismatches > 0) {
      dropOk = false;
      dropDetail += '; large drop with pack mismatches';
    } else if (dropPts >= SURFACE_DROP_ALERT_PTS) {
      dropWarn = true;
      dropDetail += '; large drop (pack integrity ok — real SEO review)';
    }
  }
  pushCheck(checks, 'surface_drop_integrity', dropOk, dropDetail, dropWarn);

  const dialFromDb = opts.dialSource !== 'combined_rows';
  pushCheck(
    checks,
    'dial_from_db',
    list.length === 0 || dialFromDb,
    opts.dialSource || 'keyword_rankings'
  );

  const failed = checks.filter((c) => !c.ok);
  const incomplete = failed.length > 0;
  return {
    incomplete,
    ranking_quality: incomplete ? 'incomplete' : 'complete',
    reason: incomplete ? failed.map((c) => `${c.id}:${c.detail}`).join('; ') : null,
    checks,
    pack_mismatches: packMismatches,
    measurable,
    n: list.length,
    local_n: localN,
    national_n: nationalN,
    surface,
    surface_drop_pts: dropPts,
    completeness,
    warnings: checks.filter((c) => c.warn).map((c) => c.detail),
  };
}

/** Shape stored on audit_results.ranking_quality_detail. */
export function acceptanceDetailForAudit(assessment, nowIso = new Date().toISOString()) {
  return {
    gate: 'ranking_acceptance_v1',
    null_stack: assessment.completeness?.null_stack ?? null,
    empty_capture: assessment.completeness?.empty_capture ?? null,
    incomplete_capture: assessment.completeness?.incomplete_capture ?? null,
    n: assessment.n,
    null_stack_pct: assessment.completeness?.null_stack_pct ?? null,
    pack_mismatches: assessment.pack_mismatches,
    measurable: assessment.measurable,
    local_n: assessment.local_n,
    national_n: assessment.national_n,
    surface: assessment.surface,
    surface_drop_pts: assessment.surface_drop_pts,
    checks: assessment.checks,
    warnings: assessment.warnings,
    reason: assessment.reason,
    checked_at: nowIso,
  };
}

/**
 * Bounded confirmation state machine for significant organic rank worsenings.
 *
 * Never picks the “best” of conflicting captures. Never promotes last_confirmed
 * into current. Never treats failed/unknown as a confident zero/absence.
 *
 * States:
 *   no_comparable_baseline | agreement | confirmed_change |
 *   unconfirmed_unstable | partial_failure | exhausted_budget | unknown
 */

import {
  CAPTURE_STATUS,
  resolveSerpCaptureStatus,
  isFailedSerpCapture,
  geoMethodsComparable,
  resolveGeoMethod,
} from './dfs-serp-quality.js';

export const CONFIRM_STATE = Object.freeze({
  NO_BASELINE: 'no_comparable_baseline',
  AGREEMENT: 'agreement',
  CONFIRMED_CHANGE: 'confirmed_change',
  UNCONFIRMED_UNSTABLE: 'unconfirmed_unstable',
  PARTIAL_FAILURE: 'partial_failure',
  EXHAUSTED_BUDGET: 'exhausted_budget',
  UNKNOWN: 'unknown',
});

/** Prior “strong” = organic top-10 on a complete (or legacy ranked) capture. */
export const STRONG_RANK_MAX = 10;
/** Absolute drop of this many positions (when still ranked) counts as significant. */
export const SIGNIFICANT_DROP_POSITIONS = 10;

function rankOrNull(row) {
  if (!row || isFailedSerpCapture(row)) return null;
  const status = resolveSerpCaptureStatus(row);
  if (status === CAPTURE_STATUS.INCOMPLETE
    || status === CAPTURE_STATUS.EMPTY
    || status === CAPTURE_STATUS.ERROR) {
    return null;
  }
  if (row.best_rank_group == null) return null;
  return Number(row.best_rank_group);
}

function isUsableComplete(row) {
  if (!row || isFailedSerpCapture(row)) return false;
  const status = resolveSerpCaptureStatus(row);
  return status === CAPTURE_STATUS.COMPLETE_RANKED
    || status === CAPTURE_STATUS.COMPLETE_NO_MATCH
    || (status === 'legacy_unverified' && row.best_rank_group != null);
}

function inTop10(rank) {
  return rank != null && Number.isFinite(rank) && rank > 0 && rank <= STRONG_RANK_MAX;
}

/**
 * Significant worsening vs a comparable prior strong position.
 * Disappearance from top-10, or drop of ≥ SIGNIFICANT_DROP_POSITIONS while ranked.
 */
export function isSignificantWorsening(baseline, current) {
  if (!baseline || !isUsableComplete(baseline)) return false;
  const priorRank = rankOrNull(baseline);
  if (!inTop10(priorRank)) return false;
  if (!geoMethodsComparable(baseline, current)) return false;
  if (!isUsableComplete(current)) return false;

  const curRank = rankOrNull(current);
  // Complete no-match after prior top-10 = significant disappearance.
  if (curRank == null) return true;
  if (priorRank <= STRONG_RANK_MAX && curRank > STRONG_RANK_MAX) return true;
  if (curRank - priorRank >= SIGNIFICANT_DROP_POSITIONS) return true;
  return false;
}

function sameOutcomeBucket(a, b) {
  const ra = rankOrNull(a);
  const rb = rankOrNull(b);
  const aTop = inTop10(ra);
  const bTop = inTop10(rb);
  if (aTop && bTop) return true;
  if (!aTop && !bTop && isUsableComplete(a) && isUsableComplete(b)) return true;
  return false;
}

/**
 * Resolve confirmation state from primary + optional confirmation observations.
 * @param {object|null} baseline comparable prior row
 * @param {object} primary first usable (or failed) capture
 * @param {object|null} confirmation optional second capture
 * @param {{ budgetExhausted?: boolean }} [meta]
 */
export function resolveConfirmationState(baseline, primary, confirmation = null, meta = {}) {
  if (!primary) {
    return { state: CONFIRM_STATE.UNKNOWN, needs_confirmation: false };
  }
  if (isFailedSerpCapture(primary) && !confirmation) {
    return {
      state: meta.budgetExhausted ? CONFIRM_STATE.EXHAUSTED_BUDGET : CONFIRM_STATE.UNKNOWN,
      needs_confirmation: false,
    };
  }
  if (!baseline || !isUsableComplete(baseline) || !inTop10(rankOrNull(baseline))) {
    return { state: CONFIRM_STATE.NO_BASELINE, needs_confirmation: false };
  }
  if (!geoMethodsComparable(baseline, primary)) {
    return { state: CONFIRM_STATE.NO_BASELINE, needs_confirmation: false };
  }

  const significant = isSignificantWorsening(baseline, primary);
  if (!significant) {
    return { state: CONFIRM_STATE.AGREEMENT, needs_confirmation: false };
  }

  if (!confirmation) {
    if (meta.budgetExhausted) {
      return { state: CONFIRM_STATE.EXHAUSTED_BUDGET, needs_confirmation: false };
    }
    return { state: CONFIRM_STATE.UNCONFIRMED_UNSTABLE, needs_confirmation: true };
  }

  if (isFailedSerpCapture(confirmation)) {
    return { state: CONFIRM_STATE.PARTIAL_FAILURE, needs_confirmation: false };
  }

  if (sameOutcomeBucket(primary, confirmation)) {
    return { state: CONFIRM_STATE.CONFIRMED_CHANGE, needs_confirmation: false };
  }
  return { state: CONFIRM_STATE.UNCONFIRMED_UNSTABLE, needs_confirmation: false };
}

/**
 * Build provenance fields for serp_features. Never writes last_confirmed into best_rank_*.
 */
export function buildConfirmationFeatures(baseFeatures, {
  state,
  baseline = null,
  primary = null,
  confirmation = null,
  budgetExhausted = false,
} = {}) {
  const out = (baseFeatures && typeof baseFeatures === 'object') ? { ...baseFeatures } : {};
  const resolved = state || resolveConfirmationState(baseline, primary, confirmation, { budgetExhausted }).state;
  out.confirmation_state = resolved;

  const observations = [];
  const pushObs = (row, role) => {
    if (!row) return;
    observations.push({
      role,
      best_rank_group: row.best_rank_group ?? null,
      capture_status: resolveSerpCaptureStatus(row),
      geo_method: resolveGeoMethod(row),
      dfs_cost: row.dfs_cost ?? row.serp_features?.dfs_cost ?? null,
      checked_at: row.serp_features?.capture_checked_at || row.checked_at || null,
      dfs_task_id: row.dfs_task_id || row.serp_features?.dfs_task_id || null,
    });
  };
  pushObs(primary, 'primary');
  pushObs(confirmation, 'confirmation');
  if (observations.length) out.confirmation_observations = observations.slice(0, 4);

  // Dated last_confirmed from comparable baseline when current is worsened/unstable/failed.
  if (baseline && isUsableComplete(baseline) && inTop10(rankOrNull(baseline))) {
    const keepLast = resolved === CONFIRM_STATE.CONFIRMED_CHANGE
      || resolved === CONFIRM_STATE.UNCONFIRMED_UNSTABLE
      || resolved === CONFIRM_STATE.PARTIAL_FAILURE
      || resolved === CONFIRM_STATE.EXHAUSTED_BUDGET
      || resolved === CONFIRM_STATE.UNKNOWN
      || isFailedSerpCapture(primary);
    if (keepLast) {
      out.last_confirmed_rank_group = Number(baseline.best_rank_group);
      if (baseline.best_rank_absolute != null) {
        out.last_confirmed_rank_absolute = Number(baseline.best_rank_absolute);
      }
      if (baseline.best_url) out.last_confirmed_url = String(baseline.best_url);
      out.last_confirmed_at = String(
        baseline.audit_date
        || baseline.last_refreshed_at
        || baseline.serp_features?.capture_checked_at
        || baseline.updated_at
        || ''
      ) || null;
      out.last_confirmed_geo_method = resolveGeoMethod(baseline);
    }
  }

  // Preserve prior last_confirmed if we did not set a new one.
  if (out.last_confirmed_rank_group == null && baseFeatures?.last_confirmed_rank_group != null) {
    out.last_confirmed_rank_group = Number(baseFeatures.last_confirmed_rank_group);
    if (baseFeatures.last_confirmed_rank_absolute != null) {
      out.last_confirmed_rank_absolute = Number(baseFeatures.last_confirmed_rank_absolute);
    }
    if (baseFeatures.last_confirmed_url) out.last_confirmed_url = String(baseFeatures.last_confirmed_url);
    if (baseFeatures.last_confirmed_at) out.last_confirmed_at = String(baseFeatures.last_confirmed_at);
    if (baseFeatures.last_confirmed_geo_method) {
      out.last_confirmed_geo_method = String(baseFeatures.last_confirmed_geo_method);
    }
  }

  return out;
}

/** Summarize confirmation / unknown counts for shared Ranking / Health / CEO badges. */
export function summarizeConfirmationCoverage(rows = []) {
  const counts = {
    tracked: 0,
    agreement: 0,
    confirmed_change: 0,
    unconfirmed_unstable: 0,
    partial_failure: 0,
    exhausted_budget: 0,
    unknown: 0,
    no_comparable_baseline: 0,
    with_last_confirmed: 0,
  };
  for (const row of rows || []) {
    if (!row) continue;
    counts.tracked += 1;
    const st = row.serp_features?.confirmation_state || null;
    if (st && counts[st] != null) counts[st] += 1;
    else if (isFailedSerpCapture(row)) counts.unknown += 1;
    if (row.serp_features?.last_confirmed_rank_group != null) counts.with_last_confirmed += 1;
  }
  counts.pending_or_unknown = counts.unconfirmed_unstable
    + counts.partial_failure
    + counts.exhausted_budget
    + counts.unknown;
  return counts;
}

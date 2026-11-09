/**
 * Scan stability guards (9 Nov 2026):
 * - PRIMARY "suspect: matching": more than MATCHING_FAILURE_SHARE of organic / local-pack results are still
 *   unresolved google.com links after decoding. The scan is held: its Surface / Top-of-page scores are not
 *   published (dial history, CEO brief).
 * - SECONDARY "volatile capture": more than VOLATILE_FLIP_RATE of keywords flipped between #1–3 and not found
 *   since the last published scan. A note on the dial only; the scan is not held (week-to-week capture noise
 *   is 15–24% since 28 Sep).
 * Comparable = same keyword + location in both scans, both measurable (failed captures don't count).
 */

import { isMeasurableForRollup } from './dfs-serp-quality.js';
import { googleOwnerShare, MATCHING_GUARD_TYPES } from './serp-redirect-owner.js';

/** Stored 2 Nov / 9 Nov responses: fixed matcher 0.2–1.7% unresolved, broken (domain-only) matcher 64–100%. */
export const MATCHING_FAILURE_SHARE = 0.2;
/** Above every observed week pair since 28 Sep (max 24%), below the broken-matcher signature (27%). */
export const VOLATILE_FLIP_RATE = 0.25;

export const SUSPECT_MATCHING = 'suspect_matching';

const pct = (x) => `${Math.round(x * 100)}%`;
const round3 = (x) => Math.round(x * 1000) / 1000;

/** 'top3' (#1–3), 'not_found' (not in the top 50 organic), or 'other'. */
export function rankBucket(rank) {
  if (rank == null) return 'not_found';
  const n = Number(rank);
  if (!Number.isFinite(n)) return 'not_found';
  return n <= 3 ? 'top3' : 'other';
}

const rowKey = (r) => `${String(r?.keyword || '').trim().toLowerCase()}|${String(r?.location_name || '').trim().toLowerCase()}`;

function measurableByKey(rows) {
  const map = new Map();
  for (const r of rows || []) if (isMeasurableForRollup(r)) map.set(rowKey(r), r);
  return map;
}

function isFlip(before, after) {
  const a = rankBucket(before?.best_rank_group);
  const b = rankBucket(after?.best_rank_group);
  return (a === 'top3' && b === 'not_found') || (a === 'not_found' && b === 'top3');
}

/** PRIMARY: organic + local-pack owner slots still on google.com after decoding. */
export function matchingGuard(rows, { maxShare = MATCHING_FAILURE_SHARE } = {}) {
  const o = googleOwnerShare(rows, MATCHING_GUARD_TYPES);
  const suspect = o.share > maxShare;
  const reason = suspect
    ? `suspect: matching — ${o.google} of ${o.total} organic / local-pack results still unresolved google.com links (${pct(o.share)}; limit ${pct(maxShare)})`
    : null;
  return { google: o.google, total: o.total, share: round3(o.share), max_share: maxShare, suspect, reason };
}

/**
 * SECONDARY: keywords flipping between #1–3 and not found vs the previous published scan.
 * @returns {{ compared: number, flipped: number, share: number, volatile: boolean, note: string|null, flips: object[] }}
 */
export function scanFlipGuard(priorRows, currentRows, { volatileShare = VOLATILE_FLIP_RATE } = {}) {
  const prior = measurableByKey(priorRows);
  const flips = [];
  let compared = 0;
  for (const [key, cur] of measurableByKey(currentRows)) {
    const before = prior.get(key);
    if (!before) continue;
    compared += 1;
    if (isFlip(before, cur)) flips.push({ keyword: cur.keyword, location: cur.location_name, from: before.best_rank_group ?? null, to: cur.best_rank_group ?? null });
  }
  const share = compared ? flips.length / compared : 0;
  const volatile = share > volatileShare;
  const note = volatile
    ? `volatile capture — ${flips.length} of ${compared} keywords flipped between #1–3 and not found since the last scan (${pct(share)}; usual 15–24%, note above ${pct(volatileShare)})`
    : null;
  return { compared, flipped: flips.length, share: round3(share), volatile, note, flips };
}

/**
 * Like-for-like dial scores: prior and current scored on the keywords present in BOTH scans, so a scan with
 * more or fewer keywords (155 → 87 → 94 in Oct–Nov 2026) cannot move the week-on-week comparison.
 * @param {(rows: object[]) => { surface: number|null, top: number|null, measured: number }} scoreFn scoreSurfaceAndTop
 */
export function cohortCompare(priorRows, currentRows, scoreFn) {
  const priorKeys = new Set((priorRows || []).map(rowKey));
  const curKeys = new Set((currentRows || []).map(rowKey));
  const cur = (currentRows || []).filter((r) => priorKeys.has(rowKey(r)));
  const prior = (priorRows || []).filter((r) => curKeys.has(rowKey(r)));
  const a = scoreFn(prior);
  const b = scoreFn(cur);
  return {
    keywords: cur.length,
    prior: { surface_visibility_score: a.surface, top_of_page_score: a.top, measured: a.measured },
    current: { surface_visibility_score: b.surface, top_of_page_score: b.top, measured: b.measured },
  };
}

/**
 * Guards + dial denominators for one scan vs the last published scan (stored on ranking_quality_detail).
 * `cohortSize` = the fixed tracked keyword set the dials are scored on (LOCKED list), shown as "of N keywords".
 */
export function buildScanStability({ priorAuditDate = null, priorRows = [], currentRows = [], scoreFn, cohortSize = null }) {
  const current = scoreFn(currentRows);
  const matching = matchingGuard(currentRows);
  const { flips, ...volatility } = scanFlipGuard(priorRows, currentRows);
  return {
    prior_audit_date: priorAuditDate,
    guard: { suspect: matching.suspect, reason: matching.reason, matching, volatility, flips },
    cohort: {
      size: cohortSize ?? (currentRows || []).length,
      keywords: (currentRows || []).length,
      measured: current.measured,
      like_for_like: priorAuditDate ? cohortCompare(priorRows, currentRows, scoreFn) : null,
    },
  };
}

function withVolatilityNote(out, note) {
  if (!note) return out;
  return {
    ...out,
    warnings: [...(out.warnings || []), note],
    checks: [...(out.checks || []), { id: 'capture_volatility', ok: true, detail: note, warn: true }],
  };
}

/** Acceptance assessment with the guards applied: a suspect scan is held like a failed one; a volatile one gets a note. */
export function withStabilityGuard(assessment, stability) {
  const out = withVolatilityNote({ ...assessment, stability: stability || null }, stability?.guard?.volatility?.note);
  if (!stability?.guard?.suspect) return out;
  return {
    ...out,
    incomplete: true,
    ranking_quality: SUSPECT_MATCHING,
    reason: stability.guard.reason,
    checks: [...(out.checks || []), { id: 'scan_stability', ok: false, detail: stability.guard.reason, warn: false }],
  };
}

/** ranking_quality_detail fields for the guard (flip list capped so the audit row stays small). */
export function stabilityDetail(assessment) {
  const s = assessment?.stability;
  if (!s) return {};
  return { stability: { ...s, guard: { ...s.guard, flips: (s.guard?.flips || []).slice(0, 25) } } };
}

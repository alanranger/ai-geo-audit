/**
 * Surface Visibility Score — server-canonical (Release 2).
 *
 * Per-keyword weighted average of organic / pack / aio / fs_paa / kp,
 * with class-specific weights and proportional redistribution when a
 * surface was not served by Google (never count unserved as Alan's miss).
 */

export const SURFACE_VISIBILITY_SCHEMA_VERSION = 2;

/** First date with serp_surface_stack history usable for trend / persistence. */
export const SURFACE_VISIBILITY_BASELINE_DATE = '2026-07-13';

export const CLASS_WEIGHTS = Object.freeze({
  'local-money': Object.freeze({ pack: 35, organic: 30, aio: 25, fs_paa: 10, kp: 0 }),
  // Regional = travel-in ~90min (central England). Pack still matters; organic/AIO closer to national.
  'regional-money': Object.freeze({ pack: 25, organic: 38, aio: 28, fs_paa: 12, kp: 0 }),
  'national-money': Object.freeze({ pack: 10, organic: 45, aio: 30, fs_paa: 15, kp: 0 }),
  brand: Object.freeze({ pack: 15, organic: 35, aio: 10, fs_paa: 0, kp: 40 }),
  education: Object.freeze({ pack: 0, organic: 40, aio: 35, fs_paa: 25, kp: 0 }),
});

const SURFACES = ['pack', 'organic', 'aio', 'fs_paa', 'kp'];

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function roundScore(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(clamp(n, 0, 100));
}

/** Organic blue-link curve. */
export function scoreOrganic(rank) {
  if (rank == null || !Number.isFinite(Number(rank))) return 0;
  const r = Number(rank);
  if (r <= 0) return 0;
  if (r === 1) return 100;
  if (r === 2) return 90;
  if (r === 3) return 80;
  if (r >= 4 && r <= 10) {
    // linear 75 → 50 across ranks 4..10
    return roundScore(75 - ((r - 4) * (25 / 6)));
  }
  if (r >= 11 && r <= 20) {
    // linear 45 → 20 across ranks 11..20
    return roundScore(45 - ((r - 11) * (25 / 9)));
  }
  return roundScore(Math.max(0, 15 - (r - 21)));
}

/** Pack position curve. Only call when pack was served. */
export function scorePack(position) {
  if (position == null || !Number.isFinite(Number(position))) return 0; // pack shown, Alan absent
  const p = Number(position);
  if (p === 1) return 100;
  if (p === 2) return 70;
  if (p === 3) return 50;
  if (p > 3) return 30;
  return 0;
}

/** Google AIO citation curve (SERP slot only). Only when AIO served. */
export function scoreAio(alanCitationsCount) {
  const n = Number(alanCitationsCount) || 0;
  if (n >= 2) return 100;
  if (n === 1) return 80;
  return 0;
}

/** Featured snippet / PAA ownership. Only when FS or PAA served. */
export function scoreFsPaa(fsOurs, paaOurs) {
  if (fsOurs) return 100;
  if (paaOurs) return 60;
  return 0;
}

/** Knowledge panel. Only when KP served. */
export function scoreKp(kpOurs) {
  return kpOurs ? 100 : 0;
}

/**
 * Redistribute class weights across served surfaces only.
 * @returns {Record<string, number>} weights summing to 100 (or 0 if none)
 */
export function redistributeWeights(classWeights, served) {
  const base = classWeights || CLASS_WEIGHTS['national-money'];
  let servedSum = 0;
  for (const s of SURFACES) {
    if (served[s] && (base[s] || 0) > 0) servedSum += base[s];
  }
  if (servedSum <= 0) return Object.fromEntries(SURFACES.map((s) => [s, 0]));
  const out = {};
  for (const s of SURFACES) {
    out[s] = served[s] && base[s] > 0 ? (base[s] / servedSum) * 100 : 0;
  }
  return out;
}

function googleAioCitationCount(row) {
  const slot = row?.ai_engines?.google_aio;
  if (slot && slot.alan_citations_count != null) return Number(slot.alan_citations_count) || 0;
  return 0;
}

/**
 * Per-keyword Surface Visibility Score.
 * @returns {{
 *   score: number,
 *   keyword_class: string,
 *   subscores: object,
 *   served: object,
 *   weights_used: object
 * }}
 */
export function computeKeywordSurfaceScore(row) {
  const keywordClass = row?.keyword_class || 'national-money';
  const weights = CLASS_WEIGHTS[keywordClass] || CLASS_WEIGHTS['national-money'];

  const packPresent = row?.local_pack_present_any === true;
  const stack = Array.isArray(row?.serp_surface_stack) ? row.serp_surface_stack : [];
  const aioPresent = stack.some((e) => e.type === 'ai_overview' && e.slot != null);
  const fsPresent = row?.featured_snippet_present_any === true;
  const paaPresent = row?.paa_present_any === true;
  const kpPresent = row?.kp_present === true;

  const served = {
    organic: true,
    pack: packPresent,
    aio: aioPresent,
    fs_paa: fsPresent || paaPresent,
    kp: kpPresent,
  };

  const subscores = {
    organic: scoreOrganic(row?.best_rank_group),
    pack: packPresent ? scorePack(row?.local_pack_position) : null,
    aio: aioPresent ? scoreAio(googleAioCitationCount(row)) : null,
    fs_paa: fsPresent || paaPresent
      ? scoreFsPaa(row?.featured_snippet_ours === true, row?.paa_ours === true)
      : null,
    kp: kpPresent ? scoreKp(row?.kp_ours === true) : null,
  };

  const weightsUsed = redistributeWeights(weights, served);
  let total = 0;
  for (const s of SURFACES) {
    if (subscores[s] == null) continue;
    total += (weightsUsed[s] / 100) * subscores[s];
  }

  return {
    score: roundScore(total),
    keyword_class: keywordClass,
    subscores,
    served,
    weights_used: weightsUsed,
  };
}

function demandWeight(row) {
  const v = row?.search_volume;
  if (v == null || !Number.isFinite(Number(v)) || Number(v) <= 0) return 10;
  return Number(v);
}

/**
 * Demand-weighted mean of keyword surface scores.
 */
export function demandWeightedMean(scoredRows) {
  let wSum = 0;
  let sSum = 0;
  for (const r of scoredRows || []) {
    const w = demandWeight(r.row || r);
    const score = r.score != null ? r.score : r.surface?.score;
    if (score == null) continue;
    wSum += w;
    sSum += w * score;
  }
  if (wSum <= 0) return 0;
  return roundScore(sSum / wSum);
}

/**
 * Roll up Overall + by-class dials from keyword rows.
 */
export function computeSurfaceVisibilityRollup(rows) {
  const perKeyword = [];
  const byClass = {
    'local-money': [],
    'regional-money': [],
    'national-money': [],
    brand: [],
    education: [],
  };

  for (const row of rows || []) {
    const surface = computeKeywordSurfaceScore(row);
    const entry = { row, surface, score: surface.score, keyword: row.keyword };
    perKeyword.push(entry);
    const cls = surface.keyword_class;
    if (byClass[cls]) byClass[cls].push(entry);
  }

  const dials = {};
  for (const cls of Object.keys(byClass)) {
    dials[cls] = {
      score: demandWeightedMean(byClass[cls]),
      count: byClass[cls].length,
    };
  }

  const overall = demandWeightedMean(perKeyword);
  let weakestClass = null;
  let weakestScore = Infinity;
  for (const [cls, d] of Object.entries(dials)) {
    if (d.count === 0) continue;
    if (d.score < weakestScore) {
      weakestScore = d.score;
      weakestClass = cls;
    }
  }

  return {
    schema_version: SURFACE_VISIBILITY_SCHEMA_VERSION,
    baseline_date: SURFACE_VISIBILITY_BASELINE_DATE,
    overall,
    byClass: dials,
    weakestClass,
    perKeyword: perKeyword.map((p) => ({
      keyword: p.keyword,
      keyword_class: p.surface.keyword_class,
      score: p.score,
      subscores: p.surface.subscores,
      served: p.surface.served,
    })),
  };
}

export function surfaceRag(score) {
  if (score >= 70) return 'strong';
  if (score >= 40) return 'moderate';
  return 'weak';
}

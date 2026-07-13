/**
 * Top-of-Page Score — server-canonical (Release 0, schema_version 3).
 * Served-order slot decay + within-surface ownership multipliers.
 */

import { scoreOrganic } from './surfaceScores.js';

export const TOP_OF_PAGE_SCHEMA_VERSION = 3;

/** Set on first passing v3 baseline audit (Alan's scheduled run). */
export const TOP_OF_PAGE_BASELINE_DATE = null;

const SLOT_VALUES = [100, 75, 55, 40, 30, 22];
const OWNABLE_TYPES = new Set([
  'ai_overview',
  'local_pack',
  'people_also_ask',
  'featured_snippet',
  'organic',
]);

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function roundScore(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(clamp(n, 0, 100));
}

export function slotValue(slot) {
  if (slot == null || slot < 1) return 0;
  if (slot <= SLOT_VALUES.length) return SLOT_VALUES[slot - 1];
  return 15;
}

export function packMultiplier(position) {
  if (position == null || !Number.isFinite(Number(position))) return 0;
  const p = Number(position);
  if (p === 1) return 1.0;
  if (p === 2) return 0.85;
  if (p === 3) return 0.7;
  return 0.5;
}

export function organicMultiplier(rank) {
  return scoreOrganic(rank) / 100;
}

export function surfaceMultiplier(element) {
  const type = element?.type;
  if (!OWNABLE_TYPES.has(type)) return 0;
  if (type === 'ai_overview') return element.ours === true ? 1.0 : 0;
  if (type === 'local_pack') return packMultiplier(element.our_position);
  if (type === 'organic') return organicMultiplier(element.our_position);
  if (type === 'featured_snippet') return element.ours === true ? 1.0 : 0;
  if (type === 'people_also_ask') return element.ours === true ? 0.6 : 0;
  return 0;
}

function stackSummary(stack) {
  return (stack || [])
    .filter((el) => el.slot != null)
    .map((el) => `${el.slot}:${el.type}${el.ours ? '*' : ''}`)
    .join(',');
}

function ownedSurfaces(stack) {
  return (stack || []).filter((el) => {
    if (el.slot == null) return false;
    return OWNABLE_TYPES.has(el.type) && surfaceMultiplier(el) > 0;
  });
}

/**
 * @param {object} row keyword row with serp_surface_stack + keyword_class
 */
export function computeKeywordTopOfPageScore(row) {
  const keywordClass = row?.keyword_class || 'national-money';
  const stack = Array.isArray(row?.serp_surface_stack) ? row.serp_surface_stack : [];

  if (keywordClass === 'brand' && row?.kp_ours === true) {
    return {
      score: 100,
      keyword_class: keywordClass,
      best_surface: 'knowledge_panel',
      best_slot: null,
      components: { brand_kp_override: true },
      stack_summary: stackSummary(stack),
    };
  }

  let bestScore = 0;
  let bestSurface = null;
  let bestSlot = null;
  const components = [];

  for (const el of stack) {
    if (el.slot == null || !OWNABLE_TYPES.has(el.type)) continue;
    const mult = surfaceMultiplier(el);
    if (mult <= 0) continue;
    const sv = slotValue(el.slot);
    const contribution = sv * mult;
    components.push({
      type: el.type,
      slot: el.slot,
      slot_value: sv,
      multiplier: mult,
      contribution,
    });
    if (contribution > bestScore) {
      bestScore = contribution;
      bestSurface = el.type;
      bestSlot = el.slot;
    }
  }

  const owned = ownedSurfaces(stack);
  const extraOwned = Math.max(0, owned.length - (bestScore > 0 ? 1 : 0));
  const breadthBonus = Math.min(10, extraOwned * 5);
  const total = roundScore(bestScore + breadthBonus);

  return {
    score: total,
    keyword_class: keywordClass,
    best_surface: bestSurface,
    best_slot: bestSlot,
    components: {
      best_contribution: bestScore,
      breadth_bonus: breadthBonus,
      appearances: components,
    },
    stack_summary: stackSummary(stack),
  };
}

function demandWeight(row) {
  const v = row?.search_volume;
  if (v == null || !Number.isFinite(Number(v)) || Number(v) <= 0) return 10;
  return Number(v);
}

export function demandWeightedMean(scoredRows) {
  let wSum = 0;
  let sSum = 0;
  for (const r of scoredRows || []) {
    const w = demandWeight(r.row || r);
    const score = r.score != null ? r.score : r.top?.score;
    if (score == null) continue;
    wSum += w;
    sSum += w * score;
  }
  if (wSum <= 0) return 0;
  return roundScore(sSum / wSum);
}

export function topOfPageRag(score) {
  if (score >= 70) return 'strong';
  if (score >= 40) return 'moderate';
  return 'weak';
}

export function computeTopOfPageRollup(rows) {
  const perKeyword = [];
  const byClass = {
    'local-money': [],
    'national-money': [],
    brand: [],
    education: [],
  };

  for (const row of rows || []) {
    const top = computeKeywordTopOfPageScore(row);
    const entry = { row, top, score: top.score, keyword: row.keyword };
    perKeyword.push(entry);
    const cls = top.keyword_class;
    if (byClass[cls]) byClass[cls].push(entry);
  }

  const dials = {};
  for (const cls of Object.keys(byClass)) {
    dials[cls] = {
      score: demandWeightedMean(byClass[cls]),
      count: byClass[cls].length,
    };
  }

  return {
    schema_version: TOP_OF_PAGE_SCHEMA_VERSION,
    baseline_date: TOP_OF_PAGE_BASELINE_DATE,
    overall: demandWeightedMean(perKeyword),
    byClass: dials,
    perKeyword: perKeyword.map((p) => ({
      keyword: p.keyword,
      score: p.score,
      best_surface: p.top.best_surface,
      best_slot: p.top.best_slot,
      stack_summary: p.top.stack_summary,
    })),
  };
}

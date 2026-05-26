/**
 * AI Overview citation model — probability-of-win, lift range, query/page
 * intent classification, local-variant routing.
 *
 * Pure functions only. No DB, no HTTP. Tested via revenue-funnel-smart-priorities.
 *
 * Rationale (2026-05-26, see Docs/CHANGELOG.md):
 * The original AIO model treated citation capture as a certainty
 * (volume × 3% × AOV × GP%) regardless of organic rank or local/national
 * fit. A local-business page ranking #23 for a national head term was
 * being shown +£234/mo as a point estimate. This module re-prices that
 * lift as a RANGE bounded by an explicit P(win) drawn from the page's
 * organic rank, query/page intent fit, and answer readiness — and
 * surfaces the full assumption stack so the figure is auditable.
 *
 * Calibration NOTE: starting values below are illustrative. They should
 * be re-tuned against alanranger.com's own AIO citation log once enough
 * before/after data exists.
 */

// Base probability of winning an AIO citation by organic rank band.
const RANK_BAND_P_WIN = [
  { maxRank: 5,  p: 0.35, label: 'rank 1-5' },
  { maxRank: 10, p: 0.20, label: 'rank 6-10' },
  { maxRank: 20, p: 0.08, label: 'rank 11-20' },
  { maxRank: 50, p: 0.03, label: 'rank 21-50' }
];
const RANK_FLOOR_P_WIN = { p: 0.01, label: 'rank 50+' };

// Query/page intent fit modifier.
const INTENT_MODIFIER = {
  local_local:       { mult: 1.5, label: 'local page + local query' },
  national_national: { mult: 1.0, label: 'national page + national query' },
  local_national:    { mult: 0.4, label: 'local page + national query (off-target)' },
  national_local:    { mult: 0.7, label: 'national page + local query (off-target)' }
};

const ANSWER_READINESS_MODIFIER = {
  clean:   { mult: 1.3, label: 'clean extractable answer block at top' },
  neutral: { mult: 1.0, label: 'standard intro paragraph' },
  fluffy:  { mult: 0.7, label: 'rhetorical/marketing opener (no extractable answer)' }
};

const DEFAULT_CAPTURE_RATE = 0.03;
const LOW_HIGH_SPREAD = { low: 0.4, high: 1.4 };

const LOCAL_PAGE_INTENTS = new Set(['local_courses', 'local_workshops', 'commercial_hire']);
const LOCAL_QUERY_TOKENS = /\b(coventry|warwickshire|midlands|near me|near-me|local)\b/i;
const NATIONAL_QUERY_TOKENS = /\b(uk|united kingdom|britain|british)\b/i;

export function classifyQueryIntent(keyword) {
  if (!keyword) return 'national';
  const k = String(keyword);
  if (LOCAL_QUERY_TOKENS.test(k)) return 'local';
  if (NATIONAL_QUERY_TOKENS.test(k)) return 'national';
  return 'national';
}

export function classifyPageScope(pageIntent) {
  if (!pageIntent) return 'national';
  return LOCAL_PAGE_INTENTS.has(pageIntent) ? 'local' : 'national';
}

function intentModifierFor(queryIntent, pageScope) {
  const key = `${pageScope}_${queryIntent}`;
  return INTENT_MODIFIER[key] || INTENT_MODIFIER.national_national;
}

function rankBandFor(rank) {
  const r = Number(rank);
  if (!Number.isFinite(r) || r <= 0) return RANK_FLOOR_P_WIN;
  for (const band of RANK_BAND_P_WIN) {
    if (r <= band.maxRank) return band;
  }
  return RANK_FLOOR_P_WIN;
}

function clampP(p) {
  if (!Number.isFinite(p)) return 0;
  if (p < 0) return 0;
  if (p > 1) return 1;
  return p;
}

/**
 * Probability of winning the AIO citation, decomposed for auditing.
 * Returns { p, stack: [{ factor, value, label }] } where the product
 * of stack values equals p (within float precision).
 */
export function pWinCitation(rank, queryIntent, pageScope, answerReadiness) {
  const band = rankBandFor(rank);
  const intent = intentModifierFor(queryIntent, pageScope);
  const readinessKey = ANSWER_READINESS_MODIFIER[answerReadiness] ? answerReadiness : 'neutral';
  const readiness = ANSWER_READINESS_MODIFIER[readinessKey];
  const p = clampP(band.p * intent.mult * readiness.mult);
  return {
    p,
    stack: [
      { factor: 'rank_base',        value: band.p,         label: band.label },
      { factor: 'intent_fit',       value: intent.mult,    label: intent.label },
      { factor: 'answer_readiness', value: readiness.mult, label: readiness.label }
    ]
  };
}

// Sanity bounds for "revenue per click" (AOV × conversion rate). Outside
// these bounds the value is almost certainly miscalibrated (unset default
// or parsing error) and the headline figure should be flagged provisional.
const REV_PER_CLICK_MIN = 0.5;
const REV_PER_CLICK_MAX = 10;

/**
 * Lift range in £/month: low / expected / high. Returns an explicit
 * assumption stack so the card can render every multiplier used.
 *
 * 2026-05-26: aov is the TRUE average booking value; conversionRate is
 * the click-to-booking rate. Older callers may still pass `aov` already
 * baked at 1% conv (the AOV_PER_CLICK constant) — in that case pass
 * `conversionRate: 1` so the maths stays identical and the stack still
 * makes sense.
 *
 * `seasonalityFactor` (optional, default 1.0) is applied AFTER the
 * expected calculation so headline + range + per-hour all share one
 * labelled basis. The unscaled value is preserved in the stack as
 * `expected_unscaled` for auditability.
 */
export function liftRange(opts) {
  const volume = Number(opts.volume) || 0;
  const captureRate = Number(opts.captureRate) || DEFAULT_CAPTURE_RATE;
  const aov = Number(opts.aov) || 0;
  const gpPct = Number(opts.gpPct) || 0;
  const pWin = clampP(opts.pWin);
  const conversionRate = (opts.conversionRate != null) ? Number(opts.conversionRate) : 1;
  const seasonality = (opts.seasonalityFactor != null) ? Number(opts.seasonalityFactor) : 1;
  const revPerClick = aov * conversionRate;
  const expectedUnscaled = volume * pWin * captureRate * revPerClick;
  const expected = expectedUnscaled * seasonality;
  const expectedGp = expected * (gpPct / 100);
  const aovFlag = (revPerClick < REV_PER_CLICK_MIN || revPerClick > REV_PER_CLICK_MAX)
    ? { unverified: true, reason: `revenue per click £${revPerClick.toFixed(2)} outside sane bounds £${REV_PER_CLICK_MIN}–£${REV_PER_CLICK_MAX}` }
    : { unverified: false };
  const stack = [
    { label: 'AIO query volume',         value: volume,           unit: '/mo' },
    { label: 'P(win citation)',          value: pWin,             unit: 'prob' },
    { label: 'Click capture rate',       value: captureRate,      unit: 'frac' },
    { label: 'Tier AOV (avg booking)',   value: aov,              unit: 'gbp', flagged: aovFlag.unverified },
    { label: 'Booking conversion rate',  value: conversionRate,   unit: 'frac' },
    { label: 'Revenue per click',        value: revPerClick,      unit: 'gbp', derived: true },
    { label: 'Tier GP%',                 value: gpPct,            unit: 'pct' }
  ];
  if (seasonality !== 1) {
    stack.push({ label: 'Seasonality factor',  value: seasonality,  unit: 'mult' });
  }
  return {
    basis: seasonality === 1 ? 'flat' : 'seasonally_adjusted',
    seasonality_factor: seasonality,
    revenue: {
      low:      Math.round(expected * LOW_HIGH_SPREAD.low),
      expected: Math.round(expected),
      high:     Math.round(expected * LOW_HIGH_SPREAD.high),
      expected_unscaled: Math.round(expectedUnscaled)
    },
    profit: {
      low:      Math.round(expectedGp * LOW_HIGH_SPREAD.low),
      expected: Math.round(expectedGp),
      high:     Math.round(expectedGp * LOW_HIGH_SPREAD.high),
      expected_unscaled: Math.round(expectedUnscaled * (gpPct / 100))
    },
    aov_flag: aovFlag,
    assumption_stack: stack
  };
}

const LOCAL_SUFFIXES = ['coventry', 'near me', 'warwickshire'];

/**
 * Given a national head term, propose local variants for re-routing.
 * Only used when a local-business page is targeted at a national query
 * it ranks >#20 for.
 */
export function localVariantsFor(keyword) {
  if (!keyword) return [];
  const base = String(keyword).trim().toLowerCase();
  if (LOCAL_QUERY_TOKENS.test(base)) return [base];
  return LOCAL_SUFFIXES.map(suf => `${base} ${suf}`);
}

/**
 * Find a keyword row by exact (case-insensitive, trimmed) match. Returns
 * the matching row or null. Used by the AIO picker to honour a
 * URL's assigned keyword override before applying the local-variant
 * reroute heuristic.
 */
export function findKeywordRowByText(keyword, keywords) {
  if (!keyword || !Array.isArray(keywords) || !keywords.length) return null;
  const needle = String(keyword).trim().toLowerCase();
  if (!needle) return null;
  for (const row of keywords) {
    const kw = String(row.keyword || '').toLowerCase().trim();
    if (kw === needle) return row;
  }
  return null;
}

/**
 * Search the live `keywords` snapshot for a local variant of `keyword`
 * that matches one of localVariantsFor(keyword). Returns the matching
 * row (best_rank_group, search_volume, etc.) so the picker can re-route
 * with real volume/rank rather than guessed numbers.
 */
export function findLocalVariantInKeywords(keyword, keywords) {
  if (!keyword || !Array.isArray(keywords) || !keywords.length) return null;
  const variants = new Set(localVariantsFor(keyword));
  let best = null;
  for (const row of keywords) {
    const kw = String(row.keyword || '').toLowerCase().trim();
    if (!variants.has(kw)) continue;
    if (!best || (Number(row.search_volume) || 0) > (Number(best.search_volume) || 0)) {
      best = row;
    }
  }
  return best;
}

/**
 * Decide whether to re-route an AIO recommendation off a national head
 * term to a local variant. Returns { reroute: true, target } or
 * { reroute: false }.
 *
 * Re-route conditions (ALL required):
 *   1. Target page is a local-business page (page scope = local).
 *   2. Original keyword is national-intent.
 *   3. Page ranks worse than #20 for the national term (low P(win)).
 *   4. A local variant exists in the keywords snapshot (so we have
 *      real volume to model with).
 */
export function shouldRerouteToLocal(opts) {
  const { pageScope, queryIntent, rank, keyword, keywords } = opts;
  if (pageScope !== 'local') return { reroute: false, reason: 'page_not_local' };
  if (queryIntent !== 'national') return { reroute: false, reason: 'query_already_local' };
  const r = Number(rank);
  if (Number.isFinite(r) && r > 0 && r <= 20) {
    return { reroute: false, reason: 'rank_in_range' };
  }
  const variant = findLocalVariantInKeywords(keyword, keywords);
  if (!variant) return { reroute: false, reason: 'no_local_variant_in_data' };
  return { reroute: true, target: variant };
}

/**
 * Evidence-confidence tag for individual recommendation items.
 * UI uses this to colour-code and (for HEURISTIC) re-phrase as
 * "may help / believed to".
 */
export const EVIDENCE = {
  HIGH:      'high',      // well-evidenced industry consensus (e.g. title-tag rank impact)
  MEDIUM:    'medium',    // plausible model with thin direct evidence
  HEURISTIC: 'heuristic'  // belief / pattern observation, NOT proven
};

/**
 * Task type taxonomy. The recommendation engine now produces three
 * kinds of tasks instead of always emitting ADD steps.
 */
export const TASK_TYPE = {
  ADD:       'ADD',
  REWRITE:   'REWRITE',
  REMEDIATE: 'REMEDIATE'
};

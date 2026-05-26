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
// 2026-05-26 phase K-2: build the assumption stack rows for either
// the single-step booking model (courses/workshops/services/hire) or
// the two-step trial-funnel model (academy: AIO click → trial signup
// → trial-to-paid → blended AOV). Kept separate so the maths in
// liftRange stays one place and the stack composition is the only
// per-tier branching.
// 2026-05-26 phase K-2 corrected: caveats per user instruction.
// - Trial signup row: over-attribution caveat (not all trials are
//   from organic clicks; true organic rate likely 1.5–2.5%).
// - Trial-to-paid row: sample-size caveat (9/208 all-time).
// - Effective AOV row: price split not tracked in Stripe.
// - Volume row: tagged "incremental" so it's clear the figure models
//   AIO-driven uplift, not the page's existing organic volume.
// - NEW row: organic→AIO conversion join — AIO-sourced clicks are
//   assumed to convert at the same observed rate as organic clicks.
//   This is the unstated assumption that multiplies an observed-from-
//   sample per-click value by a hypothetical-traffic multiplier; the
//   user (correctly) demanded the join be visible, not silent.
function priceBlendLabel(blend) {
  if (!blend || blend.fullShare == null) return '\u2014';
  const fullPct = Math.round(blend.fullShare * 100);
  const discPct = Math.round(blend.discountShare * 100);
  return `${fullPct}% \u00a3${blend.full} / ${discPct}% \u00a3${blend.discount}`;
}

function buildAssumptionStackRows(opts, derived) {
  const { volume, pWin, captureRate, revPerClick, gpPct, aovFlag, convFlag } = derived;
  if (opts.trialFunnel) {
    const tf = opts.trialFunnel;
    const rows = [
      { label: 'AIO query volume (incremental)', value: volume,      unit: '/mo', sub: 'clicks modelled as won from the AIO citation, not the page\u2019s existing organic volume' },
      { label: 'P(win citation)',          value: pWin,              unit: 'prob' },
      { label: 'Click capture rate',       value: captureRate,       unit: 'frac' },
      { label: 'Trial signup rate',        value: tf.signupRate,     unit: 'frac', assumed: !tf.signupRateMeasured, sub: 'free page \u2192 trial start (16/588, 28d). Over-attributes \u2014 not all trials originate from organic clicks; true organic rate likely 1.5\u20132.5%.' },
      { label: 'Trial-to-paid rate',       value: tf.paidRate,       unit: 'frac', assumed: !tf.paidRateMeasured, sub: 'free trial \u2192 paid annual (9/208 all-time). The 14-day trial means a 28d window structurally misses conversions \u2014 all-time is the only undistorted figure.' },
      { label: `Effective AOV (blend ${priceBlendLabel(tf.priceBlend)})`, value: tf.effectiveAov, unit: 'gbp', assumed: !tf.priceBlendMeasured, derived: true, sub: 'Discount not tracked in Stripe \u2014 split user-supplied.' },
      { label: 'AIO-click \u2194 organic-click conversion join', value: 1, unit: 'mult', assumed: true, sub: 'ASSUMED: clicks won via AIO citation convert at the same trial-signup and trial-to-paid rates measured on organic traffic. Unverified.' },
      { label: 'Revenue per click',        value: revPerClick,       unit: 'gbp', derived: true, sub: 'signup \u00d7 paid \u00d7 AOV' },
      { label: 'Tier GP%',                 value: gpPct,             unit: 'pct', sub: 'self-serve digital subscription \u2014 no real delivery cost' }
    ];
    return { rows, convFlag };
  }
  return {
    rows: [
      { label: 'AIO query volume (incremental)', value: volume,     unit: '/mo', sub: 'clicks modelled as won from the AIO citation' },
      { label: 'P(win citation)',          value: pWin,             unit: 'prob' },
      { label: 'Click capture rate',       value: captureRate,      unit: 'frac' },
      { label: 'Tier AOV (avg booking)',   value: opts.aov || 0,    unit: 'gbp', flagged: aovFlag.unverified },
      { label: 'Booking conversion rate',  value: opts.conversionRate != null ? Number(opts.conversionRate) : 1, unit: 'frac', assumed: convFlag.assumed },
      { label: 'AIO-click \u2194 organic-click conversion join', value: 1, unit: 'mult', assumed: !opts.conversionRateMeasured, sub: 'ASSUMED: AIO-sourced clicks convert at the same rate as the tier\u2019s organic clicks. Unverified.' },
      { label: 'Revenue per click',        value: revPerClick,      unit: 'gbp', derived: true },
      { label: 'Tier GP%',                 value: gpPct,             unit: 'pct' }
    ],
    convFlag
  };
}

// Compute revenue-per-click given either a single-step booking model
// or a two-step trial funnel. Single-step: aov × conversionRate.
// Two-step (academy): signupRate × paidRate × effectiveAov. Both
// produce the same per-AIO-click revenue figure the lift maths
// requires; the difference is which assumed inputs the stack surfaces.
function revPerClickFromOpts(opts) {
  if (opts.trialFunnel) {
    const tf = opts.trialFunnel;
    return (Number(tf.signupRate) || 0) * (Number(tf.paidRate) || 0) * (Number(tf.effectiveAov) || 0);
  }
  const aov = Number(opts.aov) || 0;
  const conversionRate = (opts.conversionRate != null) ? Number(opts.conversionRate) : 1;
  return aov * conversionRate;
}

// 2026-05-26 phase K-2 (academy two-step model):
// `opts.trialFunnel = { signupRate, paidRate, effectiveAov, priceBlend, signupRateMeasured, paidRateMeasured, priceBlendMeasured }`
// switches liftRange onto a two-step conversion chain matching the
// academy reality (free trial → paid annual, one-off payment in the
// conversion month, NO ÷12 amortisation). The stack composition is
// the only branch — the headline maths stays in one place via
// revPerClickFromOpts(). All three two-step inputs are independently
// flagged ASSUMED until measured rates are wired in.
export function liftRange(opts) {
  const volume = Number(opts.volume) || 0;
  const captureRate = Number(opts.captureRate) || DEFAULT_CAPTURE_RATE;
  const gpPct = Number(opts.gpPct) || 0;
  const pWin = clampP(opts.pWin);
  const conversionRateMeasured = opts.conversionRateMeasured === true;
  const seasonality = (opts.seasonalityFactor != null) ? Number(opts.seasonalityFactor) : 1;
  const revPerClick = revPerClickFromOpts(opts);
  const expectedUnscaled = volume * pWin * captureRate * revPerClick;
  const expected = expectedUnscaled * seasonality;
  const expectedGp = expected * (gpPct / 100);
  const aovFlag = (revPerClick < REV_PER_CLICK_MIN || revPerClick > REV_PER_CLICK_MAX)
    ? { unverified: true, reason: `revenue per click £${revPerClick.toFixed(2)} outside sane bounds £${REV_PER_CLICK_MIN}–£${REV_PER_CLICK_MAX}` }
    : { unverified: false };
  const convFlag = (opts.trialFunnel)
    ? buildTrialFunnelConvFlag(opts.trialFunnel)
    : (conversionRateMeasured ? { assumed: false } : { assumed: true, reason: 'Booking conversion rate is an assumed default — not measured. Provide a measured rate for this tier to remove this flag.' });
  const { rows: stack } = buildAssumptionStackRows(opts, { volume, pWin, captureRate, revPerClick, gpPct, aovFlag, convFlag });
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
    conv_flag: convFlag,
    assumption_stack: stack,
    model: opts.trialFunnel ? 'two_step_trial_funnel' : 'single_step_booking'
  };
}

// Trial-funnel conv flag — set assumed=true if ANY of the three
// inputs (signup rate, paid rate, price blend) is unverified.
function buildTrialFunnelConvFlag(tf) {
  const unmeasured = [];
  if (!tf.signupRateMeasured) unmeasured.push('trial signup rate');
  if (!tf.paidRateMeasured) unmeasured.push('trial-to-paid rate');
  if (!tf.priceBlendMeasured) unmeasured.push('£79/£59 price blend');
  if (!unmeasured.length) return { assumed: false };
  return {
    assumed: true,
    reason: `Two-step trial-funnel inputs ASSUMED \u2014 not measured: ${unmeasured.join(', ')}. Provide measured rates per tier to remove this flag.`
  };
}

// On-page lift model (2026-05-26 phase K-3) \u2014 unified revenue model
// for CTR / rank cards. Same TRUE_AOV \u00d7 conversionRate \u00d7 GP% pipeline
// and same assumption-stack shape as `liftRange` (the AIO model) so
// the dashboard renders ONE auditable stack regardless of card type.
//
// Replaces the legacy `AOV_PER_CLICK` constant in
// revenue-funnel-smart-priorities.js, which baked a silent 1% booking
// conversion into a single per-click round number (\u00a32/click for
// courses, \u00a30.8/click for academy). The legacy model:
//   - happened to be roughly right for courses (\u00a3200 \u00d7 1% = \u00a32),
//   - was wrong by ~10x for academy (real two-step funnel = \u00a30.084),
//   - hid the conversion-rate step entirely so the figure was not
//     auditable.
//
// The differences vs `liftRange`:
//   - pWin = 1 and captureRate = 1 \u2014 a rank/CTR move directly captures
//     the clicks, no AIO-citation probability multiplier.
//   - the stack's volume row is labelled "Incremental clicks from
//     on-page move" instead of "AIO query volume (incremental)".
//   - the "AIO-click \u2194 organic-click conversion join" row is omitted
//     \u2014 these ARE organic clicks, no join.
export function liftRangeForOnPageMove(opts) {
  const incrementalClicks = Math.max(0, Number(opts.incrementalClicks) || 0);
  const gpPct = Number(opts.gpPct) || 0;
  const conversionRateMeasured = opts.conversionRateMeasured === true;
  const seasonality = (opts.seasonalityFactor != null) ? Number(opts.seasonalityFactor) : 1;
  const revPerClick = revPerClickFromOpts(opts);
  const expectedUnscaled = incrementalClicks * revPerClick;
  const expected = expectedUnscaled * seasonality;
  const expectedGp = expected * (gpPct / 100);
  const aovFlag = (revPerClick < REV_PER_CLICK_MIN || revPerClick > REV_PER_CLICK_MAX)
    ? { unverified: true, reason: `revenue per click \u00a3${revPerClick.toFixed(2)} outside sane bounds \u00a3${REV_PER_CLICK_MIN}\u2013\u00a3${REV_PER_CLICK_MAX}` }
    : { unverified: false };
  const convFlag = (opts.trialFunnel)
    ? buildTrialFunnelConvFlag(opts.trialFunnel)
    : (conversionRateMeasured ? { assumed: false } : { assumed: true, reason: 'Booking conversion rate is an assumed default \u2014 not measured. Provide a measured rate for this tier to remove this flag.' });
  const stack = buildOnPageStackRows(opts, { incrementalClicks, revPerClick, gpPct, aovFlag, convFlag });
  if (seasonality !== 1) stack.push({ label: 'Seasonality factor', value: seasonality, unit: 'mult' });
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
    conv_flag: convFlag,
    assumption_stack: stack,
    model: opts.trialFunnel ? 'two_step_trial_funnel' : 'single_step_booking',
    card_kind: opts.cardKind || 'on_page_move'
  };
}

function buildOnPageStackRows(opts, derived) {
  const { incrementalClicks, revPerClick, gpPct, aovFlag, convFlag } = derived;
  const volumeLabel = opts.volumeLabel || 'Incremental clicks from on-page move';
  const volumeSub = opts.volumeSub || 'extra organic clicks/mo from the CTR or rank improvement';
  if (opts.trialFunnel) {
    const tf = opts.trialFunnel;
    return [
      { label: volumeLabel,                value: incrementalClicks, unit: '/mo', sub: volumeSub },
      { label: 'Trial signup rate',        value: tf.signupRate,     unit: 'frac', assumed: !tf.signupRateMeasured, sub: 'free page \u2192 trial start (16/588, 28d). Over-attributes \u2014 not all trials originate from organic clicks; true organic rate likely 1.5\u20132.5%.' },
      { label: 'Trial-to-paid rate',       value: tf.paidRate,       unit: 'frac', assumed: !tf.paidRateMeasured, sub: 'free trial \u2192 paid annual (9/208 all-time). The 14-day trial means a 28d window structurally misses conversions \u2014 all-time is the only undistorted figure.' },
      { label: `Effective AOV (blend ${priceBlendLabel(tf.priceBlend)})`, value: tf.effectiveAov, unit: 'gbp', assumed: !tf.priceBlendMeasured, derived: true, sub: 'Discount not tracked in Stripe \u2014 split user-supplied.' },
      { label: 'Revenue per click',        value: revPerClick,       unit: 'gbp', derived: true, sub: 'signup \u00d7 paid \u00d7 AOV' },
      { label: 'Tier GP%',                 value: gpPct,             unit: 'pct', sub: 'self-serve digital subscription \u2014 no real delivery cost' }
    ];
  }
  return [
    { label: volumeLabel,                value: incrementalClicks, unit: '/mo', sub: volumeSub },
    { label: 'Tier AOV (avg booking)',   value: opts.aov || 0,     unit: 'gbp', flagged: aovFlag.unverified },
    { label: 'Booking conversion rate',  value: opts.conversionRate != null ? Number(opts.conversionRate) : 1, unit: 'frac', assumed: convFlag.assumed, sub: '1% tier default (PHASE-K-FOLLOWUP-3) \u2014 measured rate would replace this.' },
    { label: 'Revenue per click',        value: revPerClick,       unit: 'gbp', derived: true, sub: 'AOV \u00d7 conversion rate' },
    { label: 'Tier GP%',                 value: gpPct,             unit: 'pct' }
  ];
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

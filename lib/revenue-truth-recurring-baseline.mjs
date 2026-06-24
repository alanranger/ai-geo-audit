/**
 * Recurring baseline = countable net minus lumpy tiers and event-bound products.
 * "Countable" always drops redemptions; JLR is dropped unless includeJlr is true,
 * so the baseline follows the headline "Include JLR" toggle.
 */

import { tierFromBookingCategory } from './revenue-tier-mapping.js';

export const RECURRING_LUMPY_TIER_KEYS = new Set([
  'workshops_residential',
  'pick_n_mix_inc',
  'gift_vouchers_inc'
]);

function round2(n) { return Number((Number(n) || 0).toFixed(2)); }

export function isCountableTxn(t, includeJlr = false) {
  if (t.is_redemption === true) return false;
  if (includeJlr !== true && t.is_jlr === true) return false;
  return true;
}

export function isCountableNonJlrTxn(t) {
  return isCountableTxn(t, false);
}

export function isLumpyTxn(t, seasonalityByProduct, includeJlr = false) {
  if (!isCountableTxn(t, includeJlr)) return false;
  const tier = tierFromBookingCategory(t.category_label);
  if (RECURRING_LUMPY_TIER_KEYS.has(tier)) return true;
  const prod = String(t.canonical_product || '').trim();
  if (prod && seasonalityByProduct?.get(prod) === 'event_bound') return true;
  return false;
}

export function txnMonthOf(t) {
  return t.month ?? Number(String(t.txn_date || '').slice(5, 7));
}

export function txnDayOf(t) {
  return Number(String(t.txn_date || '').slice(8, 10));
}

export function sumRecurringForMonth(txns, seasonalityByProduct, year, month, maxDay = null, includeJlr = false) {
  let net = 0;
  let lumpy = 0;
  for (const t of txns) {
    if (!isCountableTxn(t, includeJlr)) continue;
    if (Number(t.year) !== year) continue;
    if (txnMonthOf(t) !== month) continue;
    if (maxDay != null && txnDayOf(t) > maxDay) continue;
    const amt = Number(t.amount) || 0;
    net += amt;
    if (isLumpyTxn(t, seasonalityByProduct, includeJlr)) lumpy += amt;
  }
  return {
    nonJlrNet: round2(net),
    lumpyExcluded: round2(lumpy),
    recurringBaseline: round2(net - lumpy)
  };
}

export function buildSeasonalityByProduct(canonicalProducts) {
  const map = new Map();
  for (const p of canonicalProducts || []) {
    if (p.product_title && p.seasonality_type) map.set(p.product_title, p.seasonality_type);
  }
  return map;
}

export function attachRecurringToMonthly(monthly, txns, seasonalityByProduct, cfg, classifyBand) {
  const nowDay = new Date(cfg.now.iso).getUTCDate();
  const includeJlr = cfg.includeJlr === true;
  return monthly.map((m) => {
    const dim = new Date(Date.UTC(m.year, m.month, 0)).getUTCDate();
    const maxDay = m.isPartial ? Math.min(nowDay, dim) : null;
    const rb = sumRecurringForMonth(txns, seasonalityByProduct, m.year, m.month, maxDay, includeJlr);
    return {
      ...m,
      recurringBaseline: rb.recurringBaseline,
      recurringNonJlrNet: rb.nonJlrNet,
      recurringLumpyExcluded: rb.lumpyExcluded,
      recurringBand: classifyBand(rb.recurringBaseline)
    };
  });
}

export function buildRecurringHeadlineStats(monthly, cfg) {
  const closed = monthly.filter((m) => m.isClosed);
  const latest = closed[closed.length - 1] || null;
  const trailing3 = closed.slice(-3);
  const trailing3RecurringAvg = trailing3.length
    ? round2(trailing3.reduce((s, m) => s + (m.recurringBaseline || 0), 0) / trailing3.length)
    : 0;
  const year = cfg.now.year;
  const survival = cfg?.tierBands?.survival || 3000;
  const inYear = monthly.filter((m) => m.year === year);
  const ytdRecurring = round2(inYear.reduce((s, m) => s + (m.recurringBaseline || 0), 0));
  const janApr = inYear.filter((m) => m.month >= 1 && m.month <= 4 && m.isClosed);
  const janAprRecurringAvg = janApr.length
    ? round2(janApr.reduce((s, m) => s + (m.recurringBaseline || 0), 0) / janApr.length)
    : null;
  // Rolling YTD view (all closed months this year) so the insight banner stops
  // being frozen to the Jan–Apr / May narrative as the year progresses.
  const closedInYear = inYear.filter((m) => m.isClosed);
  const closedYtdCount = closedInYear.length;
  const closedYtdRecurringAvg = closedYtdCount
    ? round2(closedInYear.reduce((s, m) => s + (m.recurringBaseline || 0), 0) / closedYtdCount)
    : null;
  const ytdMonthsBelowSurvival = closedInYear.filter((m) => (m.recurringBaseline || 0) < survival).length;
  return {
    latestClosedRecurring: latest ? round2(latest.recurringBaseline) : null,
    latestClosedRecurringBand: latest?.recurringBand || null,
    trailing3RecurringAvg,
    trailing3RecurringBand: classifyBandFromFn(trailing3RecurringAvg, cfg),
    ytdRecurring,
    janAprRecurringAvg,
    closedYtdCount,
    closedYtdRecurringAvg,
    ytdMonthsBelowSurvival,
    survivalLine: survival,
    includeJlr: cfg?.includeJlr === true
  };
}

function classifyBandFromFn(amount, cfg) {
  const bands = cfg?.tierBands || { survival: 3000, comfortable: 5000, thrive: 8000 };
  if (amount >= bands.thrive) return 'thrive';
  if (amount >= bands.comfortable) return 'comfortable';
  if (amount >= bands.survival) return 'survival';
  return 'below_survival';
}

export function buildRecurringForecast(monthly, cfg) {
  const year = cfg.now.year;
  const closed = monthly.filter((m) => m.year === year && m.isClosed);
  const ytdRecurring = round2(closed.reduce((s, m) => s + (m.recurringBaseline || 0), 0));
  const trailing3 = closed.slice(-3);
  const avg = trailing3.length
    ? trailing3.reduce((s, m) => s + (m.recurringBaseline || 0), 0) / trailing3.length
    : 0;
  const monthsRemaining = Math.max(0, 12 - closed.length);
  const forecastCentral = round2(ytdRecurring + avg * monthsRemaining);
  const partial = monthly.find((m) => m.year === year && m.isPartial);
  const projectedPartial = partial?.recurringBaseline || 0;
  const monthsAfter = Math.max(0, monthsRemaining - (partial ? 1 : 0));
  const forecastInclCurrent = round2(ytdRecurring + projectedPartial + avg * monthsAfter);
  return {
    ytdRecurring,
    runRateMonthly: round2(avg),
    forecastCentral,
    forecastInclCurrent,
    monthsRemaining
  };
}

export function isSeasonalAnnualisationProduct(seasonalityType) {
  return seasonalityType === 'event_bound' || seasonalityType === 'season_bound';
}

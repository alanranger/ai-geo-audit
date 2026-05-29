// Revenue Truth tab aggregator
//
// Powers the "Revenue Truth" dashboard tab. ONE GET call returns everything
// sections 1-9 need:
//
//   1. Tier band chart        -- monthly array (revenue_amount + isPartial)
//   2. Headline strip         -- latest closed month / YTD vs pro-rata / trailing-3 avg
//   3. Market split           -- monthly array (d2c / b2b / adjustment)
//   4. Category breakdown     -- 12 cats per month: revenue, units, avg price, gp
//   5. Booking-count vs value -- units + avg price per cat per month (same data as #4)
//   6. Channel mix            -- revenue + units per booking source per month
//   7. New vs Existing        -- revenue + units per client_type per month
//   8. Funding & fees         -- revenue + estimated payment fees per funding per month
//   9. Revenue / GP toggle    -- gp_rate per (category, year) joined in for #4
//
// Headline rule (per Phase L1 user reversal): primary headline =
// revenue_amount = the full 12-category sum = Booking Sheet YTD Actual cell.
// operational_revenue (D2C + B2B) is a SECONDARY breakdown line, not the
// headline. adjustment_net is its own explicit labelled line.
//
// Category grid (booking_sheet_monthly_category) is the SINGLE reconciliation
// truth. Channel / funding / client splits are computed FROM transaction rows
// (booking_sheet_transactions), never from cached grid-summary cells -- those
// cells were proven unreliable.
//
// Method: GET
// Query:  ?propertyUrl=https://www.alanranger.com

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { buildCurrentMonthPulse } from '../../lib/revenue-truth-current-month-pulse.mjs';
import {
  attachRecurringToMonthly,
  buildRecurringHeadlineStats,
  buildRecurringForecast,
  buildSeasonalityByProduct
} from '../../lib/revenue-truth-recurring-baseline.mjs';
import {
  applyJlrToCategoryBreakdown,
  applyJlrToMonthly,
  buildJlrByCatMonth,
  buildJlrByMonth,
  buildJlrSummaryStats,
  filterTxnsForJlr
} from '../../lib/revenue-truth-jlr-filter.mjs';
import { buildHeadlineReconciliation } from '../../lib/revenue-truth-headline-reconciliation.mjs';

const DEFAULT_PROPERTY = 'https://www.alanranger.com';

// Three monthly revenue bands (config constants -- edit here, not inline in
// the UI). Compared against revenue_amount (the spreadsheet number), per the
// Phase L1 headline rule.
const TIER_BANDS = { survival: 3000, comfortable: 5000, thrive: 8000 };

// Payment fee rates verbatim from the Booking Sheet "Payment Fees" note
// (Stripe 1.8%, PayPal 2.9% + £0.30). Bank transfers + voucher redemptions
// carry no card-processing fee. These are ESTIMATES applied to the
// transaction-row gross amounts; the user's bank statements remain the
// authoritative figure for actual fees paid.
const FEE_RULES = {
  Stripe:    { pct: 0.018, flat: 0 },
  PayPal:    { pct: 0.029, flat: 0.3 },
  Bank:      { pct: 0,     flat: 0 },
  'Gift Voucher Out': { pct: 0, flat: 0 }
};

// ----------------------------------------------------------------------
// Handler
// ----------------------------------------------------------------------

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  try {
    const propertyUrl = (req.query?.propertyUrl || DEFAULT_PROPERTY).trim();
    const includeJlr = parseIncludeJlr(req.query?.includeJlr);
    const supabase = createSupabase();
    const payload = await buildPayload(supabase, propertyUrl, includeJlr);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(payload);
  } catch (err) {
    console.error('[revenue-truth-summary] failed:', err);
    res.status(500).json({ error: err.message || 'internal error' });
  }
}

function createSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing');
  return createClient(url, key, { auth: { persistSession: false } });
}

async function buildPayload(supabase, propertyUrl, includeJlr) {
  const [wide, categories, gp, transactions, marketMap, canonicalProducts] = await Promise.all([
    fetchMonthlyWide(supabase, propertyUrl),
    fetchMonthlyCategory(supabase, propertyUrl),
    fetchGp(supabase, propertyUrl),
    fetchTransactions(supabase, propertyUrl),
    fetchMarketMap(supabase, propertyUrl),
    fetchCanonicalProducts(supabase)
  ]);
  const cfg = buildConfig(includeJlr);
  const seasonalityByProduct = buildSeasonalityByProduct(canonicalProducts);
  const jlrByMonth = includeJlr ? new Map() : buildJlrByMonth(transactions);
  const jlrByCatMonth = includeJlr ? new Map() : buildJlrByCatMonth(transactions);
  const txnRows = filterTxnsForJlr(transactions, includeJlr);
  const monthlyBase = annotateMonthly(wide, cfg);
  const monthlyWithRecurring = attachRecurringToMonthly(monthlyBase, transactions, seasonalityByProduct, cfg, classifyBand);
  const monthly = includeJlr ? monthlyWithRecurring : applyJlrToMonthly(monthlyWithRecurring, jlrByMonth, classifyBand);
  const yearTotals = buildYearTotals(monthly);
  const forecast = buildForecast(monthly, cfg);
  const recurringForecast = buildRecurringForecast(monthly, cfg);
  const currentMonthPulse = buildCurrentMonthPulse(transactions, cfg, monthly, forecast, seasonalityByProduct);
  const categoryBreakdown = buildCategoryBreakdown(categories, gp, marketMap, txnRows);
  const categoryAdjusted = includeJlr ? categoryBreakdown : applyJlrToCategoryBreakdown(categoryBreakdown, jlrByCatMonth);
  const headlineReconciliation = includeJlr
    ? null
    : buildHeadlineReconciliation(wide, monthly, transactions, cfg);
  return {
    asOf: new Date().toISOString(),
    config: cfg,
    monthly,
    yearTotals,
    currentMonthPulse,
    headlineStrip: buildHeadlineStrip(monthly, cfg),
    recurringBaseline: buildRecurringHeadlineStats(monthly, cfg),
    forecast,
    recurringForecast,
    headlineReconciliation,
    jlrSummary: buildJlrSummaryStats(transactions, cfg.now.year),
    categoryBreakdown: categoryAdjusted,
    channelMix: groupByValue(txnRows, t => t.channel || (t.client_type === 'Existing' ? 'Existing' : 'Unknown')),
    newVsExisting: groupByValue(txnRows, t => t.client_type || 'Unknown'),
    fundingFees: buildFundingFees(txnRows),
    gpRates: gp.map(r => ({ year: r.year, category_order: r.category_order, category_label: r.category_label, gp_rate: Number(r.gp_rate) }))
  };
}

// ----------------------------------------------------------------------
// Supabase fetchers (each one small)
// ----------------------------------------------------------------------

async function fetchMonthlyWide(supabase, propertyUrl) {
  const { data, error } = await supabase
    .from('booking_sheet_monthly_wide')
    .select('period_start, year, month, revenue_amount, operational_revenue, adjustment_net, d2c_revenue, b2b_revenue')
    .eq('property_url', propertyUrl)
    .order('period_start', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function fetchMonthlyCategory(supabase, propertyUrl) {
  const { data, error } = await supabase
    .from('booking_sheet_monthly_category')
    .select('year, month, category_order, category_label, revenue_amount')
    .eq('property_url', propertyUrl)
    .order('year', { ascending: true }).order('month', { ascending: true }).order('category_order', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function fetchGp(supabase, propertyUrl) {
  const { data, error } = await supabase
    .from('booking_sheet_category_gp')
    .select('year, category_order, category_label, gp_rate')
    .eq('property_url', propertyUrl)
    .order('year', { ascending: true }).order('category_order', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function fetchTransactions(supabase, propertyUrl) {
  const { data, error } = await supabase
    .from('booking_sheet_transactions')
    .select('year, txn_date, category_order, category_label, funding, amount, booking_source, channel, client_type, canonical_product, is_jlr, is_redemption')
    .eq('property_url', propertyUrl)
    .order('txn_date', { ascending: true });
  if (error) throw error;
  return (data || []).map(r => ({ ...r, month: monthOfIso(r.txn_date), amount: Number(r.amount), is_jlr: r.is_jlr === true, is_redemption: r.is_redemption === true }));
}

async function fetchCanonicalProducts(supabase) {
  const { data, error } = await supabase
    .from('canonical_products')
    .select('product_title, seasonality_type');
  if (error) throw error;
  return data || [];
}

async function fetchMarketMap(supabase, _propertyUrl) {
  // category_market is a global mapping (no per-property variant) -- the
  // table has just (category_order, category_label, market, is_revenue, notes)
  const { data, error } = await supabase
    .from('booking_sheet_category_market')
    .select('category_order, market');
  if (error) throw error;
  const map = new Map();
  for (const r of (data || [])) map.set(r.category_order, r.market);
  return map;
}

// ----------------------------------------------------------------------
// Annotation + shaping helpers (each one small)
// ----------------------------------------------------------------------

function buildConfig(includeJlr) {
  const now = new Date();
  return {
    tierBands: TIER_BANDS,
    feeRules: FEE_RULES,
    includeJlr: includeJlr === true,
    now: {
      iso: now.toISOString(),
      year: now.getUTCFullYear(),
      month: now.getUTCMonth() + 1
    }
  };
}

function parseIncludeJlr(raw) {
  const v = String(raw ?? 'false').toLowerCase();
  return v === 'true' || v === '1';
}

function annotateMonthly(wideRows, cfg) {
  const out = [];
  for (const r of wideRows) {
    const yy = r.year ?? Number(String(r.period_start).slice(0, 4));
    const mm = r.month ?? Number(String(r.period_start).slice(5, 7));
    const headline = Number(r.revenue_amount) || 0;
    const partial = yy === cfg.now.year && mm === cfg.now.month;
    out.push({
      year: yy,
      month: mm,
      period_start: r.period_start,
      headlineRevenue: round2(headline),
      operationalRevenue: round2(Number(r.operational_revenue) || 0),
      adjustmentNet: round2(Number(r.adjustment_net) || 0),
      d2c: round2(Number(r.d2c_revenue) || 0),
      b2b: round2(Number(r.b2b_revenue) || 0),
      isPartial: partial,
      isClosed: !partial && isInPast(yy, mm, cfg.now),
      band: classifyBand(headline)
    });
  }
  return out;
}

function buildYearTotals(monthly) {
  const map = new Map();
  for (const r of monthly) {
    const t = map.get(r.year) || { year: r.year, headline: 0, operational: 0, adjustment: 0, monthsCounted: 0 };
    t.headline += r.headlineRevenue;
    t.operational += r.operationalRevenue;
    t.adjustment += r.adjustmentNet;
    t.monthsCounted += 1;
    map.set(r.year, t);
  }
  return [...map.values()].map(t => ({
    year: t.year,
    headline: round2(t.headline),
    operational: round2(t.operational),
    adjustment: round2(t.adjustment),
    monthsCounted: t.monthsCounted
  }));
}

function buildHeadlineStrip(monthly, cfg) {
  const closed = monthly.filter(m => m.isClosed);
  const latest = closed[closed.length - 1] || null;
  const trailing3 = closed.slice(-3);
  const trailing3Avg = trailing3.length
    ? round2(trailing3.reduce((s, m) => s + m.headlineRevenue, 0) / trailing3.length)
    : 0;
  const ytdRow = ytdContext(monthly, cfg);
  const recurring = buildRecurringHeadlineStats(monthly, cfg);
  return {
    latestClosedMonth: latest,
    trailing3MonthAverage: trailing3Avg,
    trailing3Band: classifyBand(trailing3Avg),
    ytd: ytdRow,
    recurring
  };
}

function ytdContext(monthly, cfg) {
  const year = cfg.now.year;
  const inYear = monthly.filter(m => m.year === year);
  const ytdRevenue = round2(inYear.reduce((s, m) => s + m.headlineRevenue, 0));
  const dayOfYear = dayOfYearUtc(new Date(cfg.now.iso));
  const yearTarget = TIER_BANDS.comfortable * 12;
  const proRata = round2((yearTarget * dayOfYear) / 365);
  return { year, ytdRevenue, proRataTarget: proRata, yearTarget };
}

function classifyBand(amount) {
  if (amount >= TIER_BANDS.thrive) return 'thrive';
  if (amount >= TIER_BANDS.comfortable) return 'comfortable';
  if (amount >= TIER_BANDS.survival) return 'survival';
  return 'below_survival';
}

// ----------------------------------------------------------------------
// Per-section builders
// ----------------------------------------------------------------------

function buildCategoryBreakdown(catRows, gpRows, marketMap, txnRows) {
  const gpByKey = new Map();
  for (const r of gpRows) gpByKey.set(`${r.year}|${r.category_order}`, Number(r.gp_rate));
  const unitsByKey = new Map();
  for (const t of txnRows) {
    if (!t.category_order) continue;
    const k = `${t.year}|${t.month}|${t.category_order}`;
    unitsByKey.set(k, (unitsByKey.get(k) || 0) + 1);
  }
  return catRows.map(c => mergeCategoryCell(c, gpByKey, marketMap, unitsByKey));
}

function mergeCategoryCell(c, gpByKey, marketMap, unitsByKey) {
  const gp = gpByKey.get(`${c.year}|${c.category_order}`) ?? null;
  const units = unitsByKey.get(`${c.year}|${c.month}|${c.category_order}`) || 0;
  const revenue = Number(c.revenue_amount) || 0;
  return {
    year: c.year,
    month: c.month,
    category_order: c.category_order,
    category_label: c.category_label,
    market: marketMap.get(c.category_order) || 'UNKNOWN',
    revenue: round2(revenue),
    units,
    avgPrice: units > 0 ? round2(revenue / units) : null,
    gpRate: gp,
    gpAmount: gp == null ? null : round2(revenue * gp)
  };
}

// Case-insensitive groupBy: keys by lower(trim(value)) so casing variants
// collapse; display label is the FIRST-SEEN trimmed variant for that lower
// key (so the table stays stable for the user).
function groupByValue(txnRows, valueFn) {
  const canonical = canonicaliseMap(txnRows, valueFn);
  const map = new Map();
  for (const t of txnRows) {
    const lower = normaliseLower(valueFn(t));
    if (!lower) continue;
    const label = canonical.get(lower);
    const k = `${t.year}|${t.month}|${lower}`;
    const cur = map.get(k) || { year: t.year, month: t.month, label, revenue: 0, units: 0 };
    cur.revenue += t.amount;
    cur.units += 1;
    map.set(k, cur);
  }
  return [...map.values()].map(r => ({ ...r, revenue: round2(r.revenue) }));
}

function canonicaliseMap(rows, valueFn) {
  const out = new Map();
  for (const r of rows) {
    const lower = normaliseLower(valueFn(r));
    if (!lower) continue;
    const trimmed = String(valueFn(r)).trim();
    if (!out.has(lower)) out.set(lower, trimmed);
  }
  return out;
}

function normaliseLower(v) {
  if (v == null) return null;
  const trimmed = String(v).trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase();
}

function buildFundingFees(txnRows) {
  const canonical = canonicaliseMap(txnRows, t => t.funding || 'Unknown');
  const map = new Map();
  for (const t of txnRows) {
    const lower = normaliseLower(t.funding || 'Unknown');
    if (!lower) continue;
    const funding = canonical.get(lower);
    const k = `${t.year}|${t.month}|${lower}`;
    const cur = map.get(k) || { year: t.year, month: t.month, funding, revenue: 0, units: 0, feesEstimated: 0 };
    cur.revenue += t.amount;
    cur.units += 1;
    cur.feesEstimated += estimateFee(funding, t.amount);
    map.set(k, cur);
  }
  return [...map.values()].map(r => ({
    ...r,
    revenue: round2(r.revenue),
    feesEstimated: round2(r.feesEstimated),
    netRevenue: round2(r.revenue - r.feesEstimated)
  }));
}

function estimateFee(funding, amount) {
  const rule = FEE_RULES[funding];
  if (!rule || amount <= 0) return 0;       // refunds / voucher redemptions: no fee
  return amount * rule.pct + rule.flat;
}

// ----------------------------------------------------------------------
// Forecast section (the ONE projection on this otherwise-measured tab --
// quarantined into its own block, with the formula returned verbatim so the
// UI can show it visibly).
//
// Formula (locked by Alan 2026-05-27):
//   forecast = YTD actual + (trailing-3-closed-month average × months remaining)
//
// Range bounds use min/max of the same trailing-3-closed-month set, so the
// user can see how sensitive the forecast is to a single big or small month.
//
// Run rate uses CLOSED MONTHS ONLY -- the current partial month is never
// blended into the rate (otherwise May-on-day-26 would always drag the
// estimate down by a third of a month).
// ----------------------------------------------------------------------

function buildForecast(monthly, cfg) {
  const year = cfg.now.year;
  const closedThisYear = monthly.filter(m => m.year === year && m.isClosed);
  const ytdActual = round2(sumHeadline(closedThisYear));
  const trailing3 = closedThisYear.slice(-3);
  const { avg, min, max } = trailingStats(trailing3);
  const monthsRemaining = Math.max(0, 12 - closedThisYear.length);
  const annualTarget = TIER_BANDS.comfortable * 12;
  const forecastCentral = round2(ytdActual + avg * monthsRemaining);
  const forecastLow = round2(ytdActual + min * monthsRemaining);
  const forecastHigh = round2(ytdActual + max * monthsRemaining);
  const partial = monthly.find(m => m.year === year && m.isPartial);
  const partialHeadline = partial ? partial.headlineRevenue : 0;
  const daysInMo = partial ? new Date(Date.UTC(year, partial.month, 0)).getUTCDate() : 0;
  const dayEl = cfg.now ? Math.min(daysInMo, new Date(cfg.now.iso).getUTCDate()) : 0;
  const projectedPartial = dayEl > 0 ? round2((partialHeadline / dayEl) * daysInMo) : partialHeadline;
  const monthsAfterCurrent = Math.max(0, monthsRemaining - (partial ? 1 : 0));
  const forecastInclCurrent = round2(ytdActual + projectedPartial + avg * monthsAfterCurrent);
  return {
    year,
    ytdActual,
    closedMonths: closedThisYear.length,
    closedMonthLabels: closedThisYear.map(m => m.month),
    monthsRemaining,
    runRateMonthly: round2(avg),
    runRateBasis: 'trailing-3-closed-month average',
    forecastCentral,
    forecastLow,
    forecastHigh,
    forecastInclCurrent,
    forecastInclCurrentLabel: 'Incl. current-month linear projection',
    forecastCentralLabel: 'Closed-months-only (trailing-3 × remaining)',
    forecastInclCurrentDelta: round2(forecastInclCurrent - forecastCentral),
    partialMonthProjected: projectedPartial,
    annualTarget,
    monthlyTarget: TIER_BANDS.comfortable,
    varianceToAnnualTarget: round2(forecastCentral - annualTarget),
    varianceToMonthlyTarget: round2(avg - TIER_BANDS.comfortable),
    formula: 'forecast = YTD actual + (trailing-3-closed-month average × months remaining)',
    caveat: 'Simple run-rate projection — does not model seasonality; revenue is seasonal (see the tier band chart).'
  };
}

function sumHeadline(rows) {
  let s = 0;
  for (const r of rows) s += Number(r.headlineRevenue) || 0;
  return s;
}

function trailingStats(rows) {
  if (!rows.length) return { avg: 0, min: 0, max: 0 };
  const vals = rows.map(r => Number(r.headlineRevenue) || 0);
  const sum = vals.reduce((s, v) => s + v, 0);
  return { avg: sum / vals.length, min: Math.min(...vals), max: Math.max(...vals) };
}

// ----------------------------------------------------------------------
// Small utilities
// ----------------------------------------------------------------------

function round2(n) { return Number((Number(n) || 0).toFixed(2)); }

function monthOfIso(iso) { return Number(String(iso || '').slice(5, 7)); }

function isInPast(year, month, now) {
  if (year > now.year) return false;
  if (year < now.year) return true;
  return month < now.month;
}

function dayOfYearUtc(d) {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return Math.floor((d.getTime() - start) / 86400000);
}

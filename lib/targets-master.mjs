/**
 * The one target set (Targets panel on Strategy & Actions) and the one GP method (per-category Booking Sheet
 * rates). Revenue, Pipeline & Funnel, Strategy & Actions and the Monday brief read targets from here only.
 *
 * Money: survival / stretch GP a month (business_targets). Seasonal monthly = annual × the Booking Sheet's monthly
 * weighting; the Booking Sheet's own £ figures are not used. Per tier: each category's share of the GP target is
 * its Booking Sheet revenue mix × its GP rate; the revenue equivalent divides by that same rate.
 */
import { DEFAULT_PROPERTY, loadBusinessTargets } from './business-targets.mjs';
import { ROADMAP_MILESTONES } from './strategy-action-seed.mjs';

/** Categories that earn GP; Pick n Mix and Gift Voucher in/out lines are adjustments, not tiers. */
export const GP_CATEGORY_ORDERS = [1, 2, 3, 6, 7, 10, 11, 12];

/** Funnel KPI targets until Alan sets his own in the panel (were hard-coded in revenue-funnel-summary). */
export const DEFAULT_FUNNEL_TARGETS = {
  ctr_28d_pct: 1.5,
  money_page_click_share_pct: 3,
  click_to_sale_pct: 0.5,
  enquiry_to_sale_pct: 2,
  revenue_per_1k_impressions: 1
};

const round = (n) => Math.round(Number(n) || 0);

export function seasonalMonthly(annual, weighting) {
  const w = Array.isArray(weighting) && weighting.length === 12 ? weighting : Array(12).fill(1 / 12);
  return w.map((x) => round(Number(annual) * Number(x)));
}

/** Each GP category's share of the GP target: Booking Sheet revenue mix × GP rate, normalised. */
export function tierShares(categoryTargets, gpRates) {
  const gp = GP_CATEGORY_ORDERS.map((o) => [o, Math.max(0, Number(categoryTargets?.[o]) || 0) * (gpRates[o] || 0)]);
  const total = gp.reduce((a, [, v]) => a + v, 0);
  return Object.fromEntries(gp.map(([o, v]) => [o, total > 0 ? v / total : 0]));
}

export function tierTargets(survivalSeasonal, shares, gpRates, labels) {
  return GP_CATEGORY_ORDERS.map((o) => {
    const gpMonthly = survivalSeasonal.map((m) => round(m * (shares[o] || 0)));
    const rate = gpRates[o] || null;
    return {
      category_order: o,
      label: labels?.[o] || String(o),
      gp_rate: rate,
      share: shares[o] || 0,
      gp_monthly: gpMonthly,
      revenue_monthly: rate ? gpMonthly.map((g) => round(g / rate)) : null
    };
  });
}

function dayFraction(asOf) {
  const dim = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() + 1, 0)).getUTCDate();
  return asOf.getUTCDate() / dim;
}

/** Year to date: the seasonal months before this one, plus this month pro-rata by day. */
export function ytdTarget(seasonal, asOf = new Date()) {
  const m = asOf.getUTCMonth();
  const closed = seasonal.slice(0, m).reduce((a, v) => a + v, 0);
  return round(closed + seasonal[m] * dayFraction(asOf));
}

/** The one GP method: revenue × its category's GP rate. rows = [{ category_order, revenue }]. */
export function gpFromCategoryRevenue(rows, gpRates) {
  return (rows || []).reduce((a, r) => a + (Number(r.revenue) || 0) * (gpRates[r.category_order] || 0), 0);
}

function ratesByOrder(rows) {
  return Object.fromEntries((rows || []).map((r) => [Number(r.category_order), Number(r.gp_rate) || 0]));
}

async function latestYearRow(supabase, table, cols, propertyUrl, year) {
  const { data, error } = await supabase.from(table).select(cols).eq('property_url', propertyUrl)
    .lte('year', year).order('year', { ascending: false }).limit(1);
  if (error) throw new Error(`${table}: ${error.message}`);
  return data?.[0] || null;
}

async function loadGpRates(supabase, propertyUrl, year) {
  const latest = await latestYearRow(supabase, 'booking_sheet_category_gp', 'year', propertyUrl, year);
  if (!latest) return { year: null, rates: {} };
  const { data, error } = await supabase.from('booking_sheet_category_gp').select('category_order, gp_rate')
    .eq('property_url', propertyUrl).eq('year', latest.year);
  if (error) throw new Error(`booking_sheet_category_gp: ${error.message}`);
  return { year: latest.year, rates: ratesByOrder(data) };
}

function moneyFrom(t) {
  const monthly = (k) => Number(t[`${k}_gp_monthly`]) || 0;
  const annual = (k) => Number(t[`${k}_gp_annual`]) || monthly(k) * 12;
  return {
    survival_monthly: monthly('survival'), stretch1_monthly: monthly('stretch1'), stretch2_monthly: monthly('stretch2'),
    survival_annual: annual('survival'), stretch1_annual: annual('stretch1'), stretch2_annual: annual('stretch2'),
    bills_line: monthly('survival'),
    effective_from: t.effective_from || null
  };
}

function seasonalSet(money, weighting) {
  return {
    survival: seasonalMonthly(money.survival_annual, weighting),
    stretch1: seasonalMonthly(money.stretch1_annual, weighting),
    stretch2: seasonalMonthly(money.stretch2_annual, weighting)
  };
}

function pickYear(set, fn) {
  return { survival: fn(set.survival), stretch1: fn(set.stretch1), stretch2: fn(set.stretch2) };
}

const salesFor = (gp, margin) => (margin ? Math.round(gp / margin) : null);

/**
 * This month's GP tiers (seasonal) and the sales each needs at the target-mix margin — the Revenue tab, DEFCON and
 * the Monday brief read this. `targets` stays the business_targets row (its flat monthly survival = bills line).
 */
export async function resolveGpTargetsBundle(supabase, propertyUrl = DEFAULT_PROPERTY, asOf = new Date()) {
  const [targets, master] = await Promise.all([
    loadBusinessTargets(supabase, propertyUrl),
    loadTargetsMaster(supabase, propertyUrl, asOf)
  ]);
  const mix = master.revenue_equivalent.target_mix_margin;
  const pct = mix == null ? null : Math.round(mix * 1000) / 10;
  const tm = master.this_month;
  const derived = {
    survival_sales: round(master.revenue_equivalent.survival_monthly[tm.month - 1]),
    stretch1_sales: salesFor(tm.stretch1, mix),
    stretch2_sales: salesFor(tm.stretch2, mix),
    margin_pct: pct,
    margin_label: pct == null ? 'n/a' : `${pct}%`,
    sales_needed_label: `sales needed this month at the ${pct ?? 'n/a'}% target-mix margin`
  };
  return {
    targets,
    master,
    this_month: { month: tm.month, survival: tm.survival, stretch1: tm.stretch1, stretch2: tm.stretch2 },
    bills_line: master.money.bills_line,
    margin: { margin_pct: pct, basis: 'target_mix', sql_note: 'Booking Sheet category mix × booking_sheet_category_gp rates (Targets panel)' },
    derived,
    tierBands: { survival: derived.survival_sales, comfortable: derived.stretch1_sales, thrive: derived.stretch2_sales },
    annualTargets: { survival: master.money.survival_annual, comfortable: master.money.stretch1_annual, thrive: master.money.stretch2_annual },
    survival_threshold_label: `Survival £${round(tm.survival).toLocaleString('en-GB')} GP this month (seasonal) · bills line £${round(master.money.bills_line).toLocaleString('en-GB')}/mo`,
    defcon_live_approved: Boolean(targets.defcon_edges_live)
  };
}

/** Everything the Targets panel shows and every tab reads, for the year of `asOf`. */
export async function loadTargetsMaster(supabase, propertyUrl = DEFAULT_PROPERTY, asOf = new Date()) {
  const year = asOf.getUTCFullYear();
  const [biz, sales, gp] = await Promise.all([
    loadBusinessTargets(supabase, propertyUrl),
    latestYearRow(supabase, 'booking_sheet_sales_targets', 'year, weighting, category_targets, category_labels, imported_at', propertyUrl, year),
    loadGpRates(supabase, propertyUrl, year)
  ]);
  const money = moneyFrom(biz);
  const seasonal = seasonalSet(money, sales?.weighting);
  const m = asOf.getUTCMonth();
  const perTier = tierTargets(seasonal.survival, tierShares(sales?.category_targets, gp.rates), gp.rates, sales?.category_labels);
  return {
    year,
    as_of: asOf.toISOString().slice(0, 10),
    gp_method: 'per_category_rates',
    gp_rates: gp.rates,
    money,
    seasonal: { ...seasonal, weighting: sales?.weighting || null },
    this_month: { month: m + 1, ...pickYear(seasonal, (s) => s[m]), day_fraction: dayFraction(asOf) },
    ytd: pickYear(seasonal, (s) => ytdTarget(s, asOf)),
    per_tier: perTier,
    revenue_equivalent: revenueEquivalent(perTier, seasonal.survival.length, money),
    ...panelLists(biz),
    sources: sourcesOf(biz, money, sales, gp)
  };
}

function revenueEquivalent(perTier, months, money) {
  const monthly = Array.from({ length: months }, (_, i) => perTier.reduce((a, t) => a + (t.revenue_monthly?.[i] || 0), 0));
  const annual = monthly.reduce((a, v) => a + v, 0);
  return { survival_monthly: monthly, survival_annual: annual, target_mix_margin: annual > 0 ? money.survival_annual / annual : null };
}

function panelLists(biz) {
  return {
    funnel_targets: { ...DEFAULT_FUNNEL_TARGETS, ...(biz.funnel_targets || {}) },
    roadmap_targets: Array.isArray(biz.roadmap_targets) && biz.roadmap_targets.length ? biz.roadmap_targets : ROADMAP_MILESTONES
  };
}

function sourcesOf(biz, money, sales, gp) {
  return {
    money: biz.source === 'business_targets' ? `business_targets (effective ${money.effective_from})` : biz.source,
    pattern: sales ? `booking_sheet_sales_targets ${sales.year} weighting + category mix (imported ${sales.imported_at || '—'}); its £ figures are not used` : 'no Booking Sheet pattern: flat 1/12 a month',
    gp_rates: gp.year ? `booking_sheet_category_gp ${gp.year}` : 'no GP rates'
  };
}

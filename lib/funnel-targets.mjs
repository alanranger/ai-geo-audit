/**
 * Pipeline & Funnel's view of the one target set (lib/targets-master.mjs): this month's per-tier targets, the
 * revenue each month needs for survival GP, the funnel KPI targets and the Profit Pyramid band. Money-page tiers are
 * Booking Sheet categories; their GP % is the category GP rate (one GP method).
 */
const round = (n) => Math.round(Number(n) || 0);

function tierFigures(perTier, orders, monthIdx) {
  const rows = perTier.filter((t) => orders.includes(t.category_order));
  const revenue = rows.reduce((a, t) => a + (t.revenue_monthly?.[monthIdx] || 0), 0);
  const gp = rows.reduce((a, t) => a + (t.gp_monthly?.[monthIdx] || 0), 0);
  return { monthly_target: round(revenue), gross_profit_pct: revenue > 0 ? round((gp / revenue) * 100) : null };
}

/** Monthly band = this month's seasonal survival → stretch 2; yearly band = the full-year figures; flat panel value = bills line. */
function pyramidBand(master, monthIdx, revenueFor) {
  const tm = master.this_month;
  const money = master.money;
  return {
    gp_low_monthly: round(tm.survival),
    gp_high_monthly: round(tm.stretch2),
    revenue_low_monthly: round(master.revenue_equivalent.survival_monthly[monthIdx]),
    revenue_high_monthly: revenueFor(tm.stretch2),
    gp_low_annual: round(money.survival_annual),
    gp_high_annual: round(money.stretch2_annual),
    revenue_low_annual: round(master.revenue_equivalent.survival_annual),
    revenue_high_annual: revenueFor(money.stretch2_annual),
    bills_line_gp_monthly: round(money.bills_line),
    bills_line_revenue_monthly: revenueFor(money.bills_line)
  };
}

/** @param {object} master loadTargetsMaster() result; @param {{id:string, categories:number[]}[]} tiers */
export function funnelTargetsFrom(master, tiers) {
  const monthIdx = master.this_month.month - 1;
  const money = master.money;
  const revenueAnnual = master.revenue_equivalent.survival_annual;
  const margin = revenueAnnual > 0 ? money.survival_annual / revenueAnnual : null;
  const revenueFor = (gpMonthly) => (margin ? round(gpMonthly / margin) : null);
  return {
    tiers: Object.fromEntries(tiers.map((t) => [t.id, tierFigures(master.per_tier, t.categories || [], monthIdx)])),
    seasonal_revenue: master.revenue_equivalent.survival_monthly,
    annual_revenue: revenueAnnual,
    target_mix_margin: margin,
    gp_ytd: round(master.ytd.survival),
    gp_annual: round(money.survival_annual),
    kpi: master.funnel_targets,
    pyramid: pyramidBand(master, monthIdx, revenueFor),
    source: `Targets panel (${master.sources.money}; pattern ${master.sources.pattern}; GP ${master.sources.gp_rates})`
  };
}

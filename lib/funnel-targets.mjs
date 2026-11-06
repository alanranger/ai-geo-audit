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
    gp_ytd: round(master.ytd.survival),
    gp_annual: round(money.survival_annual),
    kpi: master.funnel_targets,
    pyramid: {
      gp_low_monthly: money.survival_monthly,
      gp_high_monthly: money.stretch2_monthly,
      revenue_low_monthly: revenueFor(money.survival_monthly),
      revenue_high_monthly: revenueFor(money.stretch2_monthly)
    },
    source: `Targets panel (${master.sources.money}; pattern ${master.sources.pattern}; GP ${master.sources.gp_rates})`
  };
}

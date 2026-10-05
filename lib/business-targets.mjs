/**
 * Single source for Alan's GP survival / stretch tiers.
 * Sales lines are ALWAYS derived: GP ÷ rolling 3-closed-month GP margin.
 * DEFCON GP edges stay in defcon_edges_proposed until Alan approves live.
 */

export const DEFAULT_PROPERTY = 'https://www.alanranger.com';

/** Approved 5 Oct 2026 — also seeded in business_targets. */
export const APPROVED_GP_TIERS = {
  survival_gp_monthly: 3700,
  stretch1_gp_monthly: 4000,
  stretch2_gp_monthly: 4700,
  survival_gp_annual: 44400,
  stretch1_gp_annual: 48000,
  stretch2_gp_annual: 56400,
  effective_from: '2026-10-05'
};

export const DEFAULT_SECTION_G_CONFIG = {
  min_clients_residential: 4,
  existing_referral_monthly: 10,
  commercial_clicks_monthly: 333,
  bookings_per_1k_engaged: 2.6,
  brand_clicks_monthly: 156,
  high_margin_share_pct: 60,
  academy_paid_monthly: 2,
  lever_task_map: { 'MC-64': 'lever1', 'MC-33': 'lever1' }
};

export function formatGpSurvivalLabel(gp = APPROVED_GP_TIERS.survival_gp_monthly) {
  const n = Math.round(Number(gp) || 0);
  return `Survival £${n.toLocaleString('en-GB')}/mo GP — set 5 Oct 2026`;
}

export function salesNeeded(gpTier, marginPct) {
  const m = Number(marginPct);
  if (!Number.isFinite(m) || m <= 0) return null;
  return Math.round(Number(gpTier) / (m / 100));
}

/** Rolling 3 closed calendar months ending before `asOf` (UTC Y-M). */
export function closedMonthWindow(asOf = new Date()) {
  const y = asOf.getUTCFullYear();
  const m = asOf.getUTCMonth() + 1; // 1-12 current
  const out = [];
  let yy = y;
  let mm = m - 1;
  for (let i = 0; i < 3; i++) {
    if (mm < 1) { mm = 12; yy -= 1; }
    out.push({ year: yy, month: mm });
    mm -= 1;
  }
  return out.reverse();
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} propertyUrl
 */
export async function loadBusinessTargets(supabase, propertyUrl = DEFAULT_PROPERTY) {
  const { data, error } = await supabase
    .from('business_targets')
    .select('*')
    .eq('property_url', propertyUrl)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) {
    return {
      ...APPROVED_GP_TIERS,
      property_url: propertyUrl,
      section_g_config: DEFAULT_SECTION_G_CONFIG,
      defcon_edges_proposed: {
        basis: 'monthly_gp',
        survival: 3700,
        stretch1: 4000,
        stretch2: 4700,
        note: 'Proposed — awaiting Alan approval before live DEFCON'
      },
      defcon_edges_live: null,
      source: error ? `fallback:${error.message}` : 'fallback:approved_constants'
    };
  }
  return { ...data, source: 'business_targets' };
}

/**
 * Margin = sum(rev*gp_rate)/sum(rev) over last 3 closed months.
 * @returns {{ margin_pct: number|null, revenue: number, gp: number, months: object[], sql_note: string }}
 */
export async function loadRolling3ClosedMargin(supabase, propertyUrl = DEFAULT_PROPERTY, asOf = new Date()) {
  const months = closedMonthWindow(asOf);
  const { data: cats, error: cErr } = await supabase
    .from('booking_sheet_monthly_category')
    .select('year, month, category_label, revenue_amount')
    .eq('property_url', propertyUrl)
    .in('year', [...new Set(months.map((x) => x.year))]);
  if (cErr) throw cErr;
  const { data: gps, error: gErr } = await supabase
    .from('booking_sheet_category_gp')
    .select('year, category_label, gp_rate')
    .eq('property_url', propertyUrl)
    .in('year', [...new Set(months.map((x) => x.year))]);
  if (gErr) throw gErr;
  const rate = new Map((gps || []).map((g) => [`${g.year}|${g.category_label}`, Number(g.gp_rate) || 0]));
  const want = new Set(months.map((x) => `${x.year}-${x.month}`));
  let revenue = 0;
  let gp = 0;
  const byMonth = {};
  for (const r of cats || []) {
    const key = `${r.year}-${r.month}`;
    if (!want.has(key)) continue;
    const rev = Number(r.revenue_amount) || 0;
    const g = rev * (rate.get(`${r.year}|${r.category_label}`) || 0);
    revenue += rev;
    gp += g;
    if (!byMonth[key]) byMonth[key] = { revenue: 0, gp: 0 };
    byMonth[key].revenue += rev;
    byMonth[key].gp += g;
  }
  const margin_pct = revenue > 0 ? Math.round((gp / revenue) * 1000) / 10 : null;
  return {
    margin_pct,
    revenue: Math.round(revenue * 100) / 100,
    gp: Math.round(gp * 100) / 100,
    months: months.map((m) => ({
      ...m,
      ...(byMonth[`${m.year}-${m.month}`] || { revenue: 0, gp: 0 })
    })),
    sql_note:
      'SUM(revenue_amount * gp_rate) / SUM(revenue_amount) from booking_sheet_monthly_category ⋈ booking_sheet_category_gp for the last 3 closed calendar months'
  };
}

export async function resolveGpTargetsBundle(supabase, propertyUrl = DEFAULT_PROPERTY, asOf = new Date()) {
  const [targets, margin] = await Promise.all([
    loadBusinessTargets(supabase, propertyUrl),
    loadRolling3ClosedMargin(supabase, propertyUrl, asOf)
  ]);
  const m = margin.margin_pct;
  const derived = {
    survival_sales: salesNeeded(targets.survival_gp_monthly, m),
    stretch1_sales: salesNeeded(targets.stretch1_gp_monthly, m),
    stretch2_sales: salesNeeded(targets.stretch2_gp_monthly, m),
    margin_pct: m,
    margin_label: m == null ? 'n/a' : `${m}%`,
    sales_needed_label: m == null
      ? 'sales needed at current margin (n/a)'
      : `sales needed at current margin (${m}%)`
  };
  // Monthly sales bands for charts: derived from GP tiers until DEFCON GP edges go live.
  const tierBands = {
    survival: derived.survival_sales ?? Number(targets.survival_gp_monthly),
    comfortable: derived.stretch1_sales ?? Number(targets.stretch1_gp_monthly),
    thrive: derived.stretch2_sales ?? Number(targets.stretch2_gp_monthly)
  };
  const annualTargets = {
    survival: Number(targets.survival_gp_annual),
    comfortable: Number(targets.stretch1_gp_annual),
    thrive: Number(targets.stretch2_gp_annual)
  };
  return {
    targets,
    margin,
    derived,
    tierBands,
    annualTargets,
    survival_threshold_label: formatGpSurvivalLabel(targets.survival_gp_monthly),
    defcon_live_approved: Boolean(targets.defcon_edges_live)
  };
}

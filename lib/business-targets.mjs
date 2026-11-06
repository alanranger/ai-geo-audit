/**
 * business_targets row (survival / stretch GP a month, as set in the Targets panel) and its helpers.
 * Seasonal monthly targets, the GP method and sales lines live in targets-master.mjs (resolveGpTargetsBundle).
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

/** Cost rise INTO that calendar year (fraction). Used to step survival/stretch before the base year. */
export const DEFAULT_COST_RISE_BY_YEAR = {
  2021: 0.15, 2022: 0.15, 2023: 0.15, 2024: 0.15, 2025: 0.2, 2026: 0.2
};
export const GP_TARGET_BASE_YEAR = 2026;

/** Resolve cost-rise map from a business_targets row (or defaults). */
export function resolveCostRiseByYear(targets) {
  const raw = targets?.cost_rise_by_year;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const out = { ...DEFAULT_COST_RISE_BY_YEAR };
    for (const [k, v] of Object.entries(raw)) {
      const y = Number(k);
      const n = Number(v);
      if (Number.isFinite(y) && Number.isFinite(n) && n >= 0) out[y] = n;
    }
    return out;
  }
  return { ...DEFAULT_COST_RISE_BY_YEAR };
}

/** Back-calculate a GP tier for `year` from the base-year target using cost rises. */
export function gpTierForYear(baseGp, year, costRiseByYear = DEFAULT_COST_RISE_BY_YEAR, baseYear = GP_TARGET_BASE_YEAR) {
  let v = Number(baseGp) || 0;
  const y = Number(year);
  if (!Number.isFinite(y) || y >= baseYear) return Math.round(v);
  for (let yy = baseYear; yy > y; yy -= 1) {
    const rise = Number(costRiseByYear?.[yy] ?? DEFAULT_COST_RISE_BY_YEAR[yy] ?? 0.15);
    v /= 1 + rise;
  }
  return Math.round(v);
}

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

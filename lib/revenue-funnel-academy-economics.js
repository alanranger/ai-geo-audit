// Academy fixed cost + minimum signups; tier health for picker suppression.

export const ACADEMY_MONTHLY_COST_GBP = 100;
export const ACADEMY_MIN_PAID_SIGNUPS = 10;
export const ACADEMY_ANNUAL_FEE_GBP = 79;

export async function fetchTierCosts(supabase, propertyUrl) {
  const { data, error } = await supabase
    .from('revenue_funnel_tier_costs')
    .select('tier_id, monthly_fixed_cost_gbp, min_monthly_units, unit_label')
    .eq('property_url', propertyUrl);
  if (error) {
    if (error.code === '42P01') return { academy: { monthly_fixed_cost_gbp: ACADEMY_MONTHLY_COST_GBP, min_monthly_units: ACADEMY_MIN_PAID_SIGNUPS } };
    throw error;
  }
  const out = {};
  for (const r of (data || [])) out[r.tier_id] = r;
  if (!out.academy) {
    out.academy = {
      monthly_fixed_cost_gbp: ACADEMY_MONTHLY_COST_GBP,
      min_monthly_units: ACADEMY_MIN_PAID_SIGNUPS,
      unit_label: 'paid signups'
    };
  }
  return out;
}

export async function academyTierHealth(supabase, propertyUrl) {
  const costs = await fetchTierCosts(supabase, propertyUrl);
  const ac = costs.academy || {};
  const fixed = Number(ac.monthly_fixed_cost_gbp) || ACADEMY_MONTHLY_COST_GBP;
  const minUnits = Number(ac.min_monthly_units) || ACADEMY_MIN_PAID_SIGNUPS;
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - 3);
  // 2026-05-26 SINGLE-SOURCE-OF-TRUTH FIX: read from
  // `booking_sheet_monthly_wide` instead of `revenue_snapshots`. The latter
  // was double-counting Academy revenue (the SQ API row and the
  // stripe_supplemental Acuity row could overlap). The Booking Sheet's
  // "12. Academy" line is the authoritative figure for academy_monthly.
  const { data, error } = await supabase
    .from('booking_sheet_monthly_wide')
    .select('period_start, tier_revenue')
    .eq('property_url', propertyUrl)
    .gte('period_start', since.toISOString().slice(0, 10))
    .order('period_start', { ascending: false })
    .limit(6);
  if (error) throw error;
  const months = (data || []).map(row => {
    const rev = Number((row.tier_revenue || {}).academy) || 0;
    const gp = Math.round(rev * 0.99);
    const net = gp - fixed;
    const signups = rev > 0 ? Math.round(rev / ACADEMY_ANNUAL_FEE_GBP) : 0;
    return { period_start: row.period_start, revenue_gbp: rev, net_gp_gbp: net, signups_est: signups };
  });
  const last2 = months.slice(0, 2);
  const underMin = last2.length >= 2 && last2.every(m => m.signups_est < minUnits);
  const netNegative = last2.length >= 2 && last2.every(m => m.net_gp_gbp < 0);
  return {
    monthly_fixed_cost_gbp: fixed,
    min_paid_signups_per_month: minUnits,
    months,
    under_minimum_signups: underMin,
    suppress_academy_picker: netNegative,
    badge: underMin ? 'UNDER MINIMUM' : (netNegative ? 'REVIEW TIER' : null)
  };
}

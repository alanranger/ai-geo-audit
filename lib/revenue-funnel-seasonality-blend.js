// Observed seasonality from revenue_snapshots, blended with stated calendar.

const STATED = {
  courses:              [1.30, 1.30, 1.40, 1.30, 1.10, 0.60, 0.40, 0.40, 1.40, 1.40, 1.40, 0.50],
  workshops_nonres:     [0.30, 0.30, 0.70, 1.60, 1.60, 1.10, 0.60, 0.50, 1.50, 1.60, 1.40, 0.30],
  workshops_residential:[0.30, 0.40, 0.70, 1.60, 1.60, 1.10, 0.60, 0.60, 1.50, 1.60, 1.40, 0.30],
  services:             [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  hire:                 [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  academy:              [1.15, 1.15, 1.05, 0.95, 0.90, 0.85, 0.85, 0.90, 1.00, 1.05, 1.15, 1.20]
};

const BLEND_OBSERVED = 0.7;
const BLEND_STATED = 0.3;
const MIN_MONTHS_FOR_OBSERVED = 6;

function monthIdxFromPeriodStart(periodStart) {
  const d = new Date(periodStart);
  return Number.isFinite(d.getTime()) ? d.getUTCMonth() : null;
}

function buildObservedFactors(rows) {
  const byTierMonth = new Map();
  const tierTotals = new Map();
  for (const row of rows) {
    const m = monthIdxFromPeriodStart(row.period_start);
    if (m == null) continue;
    const tr = row.tier_revenue || {};
    for (const [tier, amt] of Object.entries(tr)) {
      const v = Number(amt) || 0;
      if (v <= 0) continue;
      const key = tier + ':' + m;
      byTierMonth.set(key, (byTierMonth.get(key) || 0) + v);
      tierTotals.set(tier, (tierTotals.get(tier) || 0) + v);
    }
  }
  const out = {};
  for (const tier of Object.keys(STATED)) {
    const months = [];
    let count = 0;
    for (let m = 0; m < 12; m += 1) {
      const v = byTierMonth.get(tier + ':' + m) || 0;
      if (v > 0) count += 1;
      months.push(v);
    }
    if (count < MIN_MONTHS_FOR_OBSERVED) continue;
    const avg = months.reduce((a, b) => a + b, 0) / 12 || 1;
    out[tier] = months.map(v => (v > 0 ? v / avg : 1));
  }
  return out;
}

function blendTier(stated, observed) {
  if (!observed) return stated.slice();
  return stated.map((s, i) => {
    const o = observed[i] != null ? observed[i] : 1;
    return Math.round((BLEND_OBSERVED * o + BLEND_STATED * s) * 100) / 100;
  });
}

export async function loadBlendedSeasonality(supabase, propertyUrl) {
  const since = new Date();
  since.setUTCFullYear(since.getUTCFullYear() - 3);
  const { data, error } = await supabase
    .from('revenue_snapshots')
    .select('period_start, tier_revenue')
    .eq('property_url', propertyUrl)
    .gte('period_start', since.toISOString().slice(0, 10))
    .order('period_start', { ascending: true });
  if (error) throw error;
  const observed = buildObservedFactors(data || []);
  const byTier = {};
  let observedTierCount = 0;
  for (const tier of Object.keys(STATED)) {
    if (observed[tier]) observedTierCount += 1;
    byTier[tier] = blendTier(STATED[tier], observed[tier]);
  }
  const monthSpan = (data || []).length;
  return {
    byTier,
    calibration_note: monthSpan > 0
      ? `Seasonality: ${monthSpan} months of booking data, blended ${Math.round(BLEND_OBSERVED * 100)}% observed + ${Math.round(BLEND_STATED * 100)}% stated (${observedTierCount} tiers with enough history).`
      : 'Seasonality: stated activity calendar only (no booking history yet).'
  };
}

export function factorFromBlend(byTier, tierId, monthIdx) {
  const arr = byTier && byTier[tierId];
  if (!Array.isArray(arr)) return 1;
  const i = Math.max(0, Math.min(11, Number(monthIdx) || 0));
  return arr[i];
}

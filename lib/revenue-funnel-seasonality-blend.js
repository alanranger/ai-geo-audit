// Observed seasonality from the Booking Sheet (single source of truth),
// blended with the stated activity calendar.
//
// 2026-05-26 SINGLE-SOURCE-OF-TRUTH FIX (Phase L): previously read from
// `revenue_snapshots` which summed squarespace_api + stripe_supplemental +
// booking_sheet sources -- those sources overlap (a SQ order paid by Bank
// Transfer is in BOTH the SQ Orders API and the Booking Sheet's Bank
// receipts), so the observed seasonality was computed on a double-counted
// basis. Now reads from `booking_sheet_monthly_wide`, which holds exactly
// one authoritative row per month sourced from the Booking Sheet row-18
// Totals. See Docs/REVENUE-TRUTH-FROM-BOOKING-SHEET.md.
//
// 2026-05-26 Phase L1 correction: previously read Phase L's invented
// 5-tier rollup (`tier_revenue` jsonb with keys courses /
// workshops_nonres / workshops_residential / services / academy). The
// `services` rollup in particular merged 8 unrelated D2C, B2B and
// ADJUSTMENT categories and corresponded to nothing real.
//
// Now reads `category_revenue` (12 verbatim Booking Sheet categories)
// from the wide view, and builds observed seasonality on the four
// 1-to-1 mappings that have always been real:
//
//     courses               <- "1. Courses/masterclasses"
//     workshops_nonres      <- "2. Workshops Non Residential"
//     workshops_residential <- "3. Workshops Residential"
//     academy               <- "12. Academy"
//
// And also reads `market_revenue` (D2C / B2B / ADJUSTMENT) to build per-
// market observed seasonality as a new dimension. Callers can use either.
//
// `services` and `hire` are GONE from STATED -- they were fabrications
// that lumped unrelated revenue lines together. Callers that still pass
// `services` or `hire` as a tierId to `factorFromBlend` will get the
// neutral factor 1.0 (no seasonal adjustment), which is what they were
// effectively getting before since STATED.services was all 1s.

// Stated activity calendar (kept verbatim from prior versions for the four
// real tiers; this is the user-stated "when do I expect each line of
// business to be busy" overlay, not observed data).
const STATED = {
  courses:              [1.30, 1.30, 1.40, 1.30, 1.10, 0.60, 0.40, 0.40, 1.40, 1.40, 1.40, 0.50],
  workshops_nonres:     [0.30, 0.30, 0.70, 1.60, 1.60, 1.10, 0.60, 0.50, 1.50, 1.60, 1.40, 0.30],
  workshops_residential:[0.30, 0.40, 0.70, 1.60, 1.60, 1.10, 0.60, 0.60, 1.50, 1.60, 1.40, 0.30],
  academy:              [1.15, 1.15, 1.05, 0.95, 0.90, 0.85, 0.85, 0.90, 1.00, 1.05, 1.15, 1.20]
};

// Verbatim Booking Sheet category label per legacy tier ID. The 4 real
// 1-to-1 mappings -- the only ones that survived the Phase L1 correction.
const TIER_TO_CATEGORY = {
  courses:               '1. Courses/masterclasses',
  workshops_nonres:      '2. Workshops Non Residential',
  workshops_residential: '3. Workshops Residential',
  academy:               '12. Academy'
};

// Stated market calendar. D2C inherits the workshop/courses curve weighted
// by historic mix; B2B is roughly flat (prints/commissions land sporadically
// not seasonally). ADJUSTMENT has no meaningful seasonality (voucher
// timing is driven by gift-giving, not the business cycle).
const STATED_MARKET = {
  D2C: [0.85, 0.85, 1.05, 1.35, 1.30, 0.95, 0.55, 0.55, 1.40, 1.45, 1.35, 0.35],
  B2B: [1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00]
};

const BLEND_OBSERVED = 0.7;
const BLEND_STATED = 0.3;
const MIN_MONTHS_FOR_OBSERVED = 6;

function monthIdxFromPeriodStart(periodStart) {
  const d = new Date(periodStart);
  return Number.isFinite(d.getTime()) ? d.getUTCMonth() : null;
}

function buildObservedFromAccumulator(byKeyMonth, keys) {
  const out = {};
  for (const key of keys) {
    const months = [];
    let count = 0;
    for (let m = 0; m < 12; m += 1) {
      const v = byKeyMonth.get(key + ':' + m) || 0;
      if (v > 0) count += 1;
      months.push(v);
    }
    if (count < MIN_MONTHS_FOR_OBSERVED) continue;
    const avg = months.reduce((a, b) => a + b, 0) / 12 || 1;
    out[key] = months.map(v => (v > 0 ? v / avg : 1));
  }
  return out;
}

function buildObservedByTier(rows) {
  const byKeyMonth = new Map();
  for (const row of rows) {
    const m = monthIdxFromPeriodStart(row.period_start);
    if (m == null) continue;
    const cats = row.category_revenue || {};
    for (const [tier, label] of Object.entries(TIER_TO_CATEGORY)) {
      const v = Number(cats[label]) || 0;
      if (v <= 0) continue;
      const key = tier + ':' + m;
      byKeyMonth.set(key, (byKeyMonth.get(key) || 0) + v);
    }
  }
  return buildObservedFromAccumulator(byKeyMonth, Object.keys(STATED));
}

function buildObservedByMarket(rows) {
  const byKeyMonth = new Map();
  for (const row of rows) {
    const m = monthIdxFromPeriodStart(row.period_start);
    if (m == null) continue;
    const mr = row.market_revenue || {};
    for (const market of Object.keys(STATED_MARKET)) {
      const v = Number(mr[market]) || 0;
      if (v <= 0) continue;
      const key = market + ':' + m;
      byKeyMonth.set(key, (byKeyMonth.get(key) || 0) + v);
    }
  }
  return buildObservedFromAccumulator(byKeyMonth, Object.keys(STATED_MARKET));
}

function blendCurve(stated, observed) {
  if (!observed) return stated.slice();
  return stated.map((s, i) => {
    const o = observed[i] != null ? observed[i] : 1;
    return Math.round((BLEND_OBSERVED * o + BLEND_STATED * s) * 100) / 100;
  });
}

function blendAllByKey(stated, observed) {
  const out = {};
  let observedCount = 0;
  for (const key of Object.keys(stated)) {
    if (observed[key]) observedCount += 1;
    out[key] = blendCurve(stated[key], observed[key]);
  }
  return { out, observedCount };
}

export async function loadBlendedSeasonality(supabase, propertyUrl) {
  const since = new Date();
  since.setUTCFullYear(since.getUTCFullYear() - 3);
  const { data, error } = await supabase
    .from('booking_sheet_monthly_wide')
    .select('period_start, category_revenue, market_revenue')
    .eq('property_url', propertyUrl)
    .gte('period_start', since.toISOString().slice(0, 10))
    .order('period_start', { ascending: true });
  if (error) throw error;
  const rows = data || [];

  const obsTier = buildObservedByTier(rows);
  const tierBlend = blendAllByKey(STATED, obsTier);

  const obsMarket = buildObservedByMarket(rows);
  const marketBlend = blendAllByKey(STATED_MARKET, obsMarket);

  const monthSpan = rows.length;
  return {
    byTier: tierBlend.out,         // back-compat keys: 4 real tiers only
    byMarket: marketBlend.out,     // new dimension: D2C, B2B
    calibration_note: monthSpan > 0
      ? `Seasonality: ${monthSpan} months of Booking Sheet data, blended ${Math.round(BLEND_OBSERVED * 100)}% observed + ${Math.round(BLEND_STATED * 100)}% stated (tiers: ${tierBlend.observedCount}/${Object.keys(STATED).length} with enough history; markets: ${marketBlend.observedCount}/${Object.keys(STATED_MARKET).length}).`
      : 'Seasonality: stated activity calendar only (no Booking Sheet history yet).'
  };
}

// Callers that still pass legacy tier IDs not in STATED (e.g. 'services',
// 'hire') get the neutral factor 1.0 -- no seasonal adjustment. This is
// what they were effectively getting before, since the old STATED.services
// and STATED.hire were both flat arrays of 1s.
export function factorFromBlend(byTier, tierId, monthIdx) {
  const arr = byTier && byTier[tierId];
  if (!Array.isArray(arr)) return 1;
  const i = Math.max(0, Math.min(11, Number(monthIdx) || 0));
  return arr[i];
}

// New: per-market factor lookup. Pass 'D2C' or 'B2B'. ADJUSTMENT is not a
// revenue line and has no meaningful seasonality; callers should never
// request it.
export function factorFromBlendByMarket(byMarket, marketId, monthIdx) {
  const arr = byMarket && byMarket[marketId];
  if (!Array.isArray(arr)) return 1;
  const i = Math.max(0, Math.min(11, Number(monthIdx) || 0));
  return arr[i];
}

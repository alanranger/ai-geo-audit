/** Scenario picker bias when GA4 enquiry → sale is weak. */

const ENQUIRY_SALE_TARGET_PCT = 2;
const ENQUIRY_SALE_WARN_PCT = 1;

export function conversionHealthFromMetrics(ga4Snap, revenueSnap) {
  const moneyEnquiry = ga4Snap ? Number(ga4Snap.money_page_enquiry_events_28d) : null;
  const siteEnquiry = ga4Snap ? Number(ga4Snap.enquiry_events_28d) : null;
  const txns = revenueSnap ? Number(revenueSnap.transactions) || 0 : 0;
  const denom = moneyEnquiry != null && moneyEnquiry > 0 ? moneyEnquiry : null;
  const enquiryToSalePct = denom ? (txns / denom) * 100 : null;
  const weak = enquiryToSalePct != null && enquiryToSalePct < ENQUIRY_SALE_WARN_PCT;
  const strong = enquiryToSalePct != null && enquiryToSalePct >= ENQUIRY_SALE_TARGET_PCT;
  return {
    money_page_enquiry_events_28d: moneyEnquiry,
    site_enquiry_events_28d: siteEnquiry,
    transactions_28d: txns,
    enquiry_to_sale_pct: enquiryToSalePct,
    weak,
    strong,
    target_pct: ENQUIRY_SALE_TARGET_PCT,
    warn_pct: ENQUIRY_SALE_WARN_PCT
  };
}

export function applyFunnelConversionBias(weights, health) {
  if (!weights || !health?.weak) return weights;
  const lever = new Map(weights.lever || []);
  const ctr = Number(lever.get('ctr') ?? 1);
  const conv = Number(lever.get('conversion') ?? 1);
  lever.set('ctr', ctr * 0.65);
  lever.set('conversion', conv * 2);
  return { ...weights, lever, funnel_conversion_bias: true };
}

export function buildConversionGapCandidate(health, propertyUrl) {
  if (!health?.weak || !health.money_page_enquiry_events_28d) return null;
  const pct = health.enquiry_to_sale_pct != null ? health.enquiry_to_sale_pct.toFixed(1) : '?';
  return {
    tier_id: 'services',
    tier_label: '1-2-1 & Services',
    lever_id: 'conversion',
    signature: 'funnel-enquiry-to-sale-gap',
    title: 'Raise enquiry → sale on money pages',
    description: `Only ${pct}% of ${health.money_page_enquiry_events_28d} money-page enquiry events (${health.transactions_28d} transactions in the same window). Fix forms, offers, and checkout on tier hubs before more SEO/title work.`,
    pages_affected: ['https://www.alanranger.com/photography-tuition-services'],
    primary_kpi: 'enquiry_to_sale_pct',
    kpi_baseline_value: pct,
    kpi_target_value: String(health.target_pct),
    kpi_target_direction: 'up',
    estimated_lift: `+${(health.target_pct - Number(pct)).toFixed(1)}pp enquiry→sale`,
    estimated_lift_gbp_profit: 180,
    weighted_score: 420,
    property_url: propertyUrl,
    status: 'not_started'
  };
}

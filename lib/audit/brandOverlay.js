/**
 * Brand demand overlay — SIGNED 2026-07-16 (GBP-weighted).
 * 40% GBP interactions + 20% GBP action rate + 20% branded clicks
 * + 15% branded CTR + 5% brand query share.
 * Reviews / entity removed (Authority + Local diagnostic own those).
 */

const BRAND_TERMS = ['alan ranger', 'alanranger', 'alan ranger photography'];

/** Normalisation ceilings from stored Aug 2025–Jun 2026 ranges */
const ANCHORS = {
  gbpInteractionsCeil: 140,   // peak month 141
  gbpActionRateCeil: 0.10,    // 10% interactions/impressions = 100
  brandClicksCeil: 160,       // Apr peak 156
  brandCtrCeil: 0.40,         // Feb 40.6%
  brandShareCeil: 0.0003,     // ~0.03% query-dim share = 100 (stored max ~0.026%)
};

const isBrandQuery = (query) => {
  if (!query || typeof query !== 'string') return false;
  const q = query.toLowerCase();
  return BRAND_TERMS.some((term) => q.includes(term));
};

const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));
const score01 = (value, ceil) => Math.round(clamp01((Number(value) || 0) / ceil) * 100);

const calculateBrandMetrics = (queries) => {
  if (!queries || !Array.isArray(queries) || queries.length === 0) {
    return { brandQueryShare: 0, brandCtr: 0, brandAvgPosition: null, brandClicks: 0, brandImpressions: 0 };
  }
  const ranking = queries.filter((q) => (q.position || 0) > 0 && (q.position || 0) <= 20 && (q.impressions || 0) > 0);
  if (!ranking.length) {
    return { brandQueryShare: 0, brandCtr: 0, brandAvgPosition: null, brandClicks: 0, brandImpressions: 0 };
  }
  const brandQueries = ranking.filter((q) => isBrandQuery(q.query || ''));
  const totalImpressions = ranking.reduce((s, q) => s + (q.impressions || 0), 0);
  const brandImpressions = brandQueries.reduce((s, q) => s + (q.impressions || 0), 0);
  const brandClicks = brandQueries.reduce((s, q) => s + (q.clicks || 0), 0);
  const brandQueryShare = totalImpressions > 0 ? brandImpressions / totalImpressions : 0;
  const brandCtr = brandImpressions > 0 ? brandClicks / brandImpressions : 0;
  const brandAvgPosition = brandImpressions > 0
    ? brandQueries.reduce((s, q) => s + (q.position || 0) * (q.impressions || 0), 0) / brandImpressions
    : null;
  return { brandQueryShare, brandCtr, brandAvgPosition, brandClicks, brandImpressions };
};

/**
 * @param {object} args raw monthly inputs (latest full month)
 */
const computeBrandOverlay = (args) => {
  const gbpInteractions = Number(args?.gbpInteractions) || 0;
  const gbpProfileImpressions = Number(args?.gbpProfileImpressions) || 0;
  const gbpActionRate = gbpProfileImpressions > 0
    ? gbpInteractions / gbpProfileImpressions
    : (Number(args?.gbpActionRate) || 0);
  const brandClicks = Number(args?.brandClicks) || 0;
  const brandCtr = Number(args?.brandCtr) || 0;
  const brandQueryShare = Number(args?.brandQueryShare) || 0;

  const interactionsScore = score01(gbpInteractions, ANCHORS.gbpInteractionsCeil);
  const actionRateScore = score01(gbpActionRate, ANCHORS.gbpActionRateCeil);
  const clicksScore = score01(brandClicks, ANCHORS.brandClicksCeil);
  const ctrScore = score01(brandCtr, ANCHORS.brandCtrCeil);
  const shareScore = score01(brandQueryShare, ANCHORS.brandShareCeil);

  const combined =
    0.40 * interactionsScore +
    0.20 * actionRateScore +
    0.20 * clicksScore +
    0.15 * ctrScore +
    0.05 * shareScore;

  let label = 'Strong';
  if (combined < 40) label = 'Weak';
  else if (combined < 70) label = 'Developing';

  const notes = [];
  if (gbpInteractions < 90) notes.push('GBP interactions below ~90/mo target band.');
  if (gbpActionRate < 0.085) notes.push('GBP action rate below ~8.5%.');
  if (brandClicks < 80) notes.push('Branded search clicks soft vs recent peaks.');
  if (brandCtr < 0.25) notes.push('Branded CTR below 25%.');

  return {
    score: Math.round(combined),
    label,
    formula: 'gbp_weighted_2026_07_16',
    weights: { gbpInteractions: 0.4, gbpActionRate: 0.2, brandClicks: 0.2, brandCtr: 0.15, brandQueryShare: 0.05 },
    anchors: { ...ANCHORS },
    components: {
      gbpInteractions: interactionsScore,
      gbpActionRate: actionRateScore,
      brandClicks: clicksScore,
      brandCtr: ctrScore,
      brandQueryShare: shareScore,
    },
    gbpInteractions,
    gbpProfileImpressions,
    gbpActionRate,
    brandClicks,
    brandCtr,
    brandQueryShare,
    // Legacy keys kept null so UI does not show reviews/entity in Brand demand
    brandAvgPosition: null,
    reviewScore: null,
    entityScore: null,
    notes,
  };
};

/** Score one month from joined GBP + GSC brand rows. */
const computeBrandDemandForMonth = (gbpRow, gscRow) => {
  const impressions =
    (Number(gbpRow?.impressions_search_mobile) || 0) +
    (Number(gbpRow?.impressions_search_desktop) || 0) +
    (Number(gbpRow?.impressions_maps_mobile) || 0) +
    (Number(gbpRow?.impressions_maps_desktop) || 0);
  const interactions = Number(gbpRow?.interactions) != null && gbpRow?.interactions !== undefined
    ? Number(gbpRow.interactions)
    : (Number(gbpRow?.website_clicks) || 0) +
      (Number(gbpRow?.call_clicks) || 0) +
      (Number(gbpRow?.direction_requests) || 0) +
      (Number(gbpRow?.conversations) || 0) +
      (Number(gbpRow?.bookings) || 0);

  return computeBrandOverlay({
    gbpInteractions: interactions,
    gbpProfileImpressions: impressions,
    brandClicks: Number(gscRow?.brand_clicks) || 0,
    brandCtr: Number(gscRow?.brand_ctr) || 0,
    brandQueryShare: Number(gscRow?.brand_share) || 0,
  });
};

export {
  ANCHORS,
  BRAND_TERMS,
  calculateBrandMetrics,
  computeBrandDemandForMonth,
  computeBrandOverlay,
  isBrandQuery,
};

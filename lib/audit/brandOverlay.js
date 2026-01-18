const BRAND_TERMS = ['alan ranger', 'alanranger', 'alan ranger photography'];

const isBrandQuery = (query) => {
  if (!query || typeof query !== 'string') return false;
  const q = query.toLowerCase();
  return BRAND_TERMS.some((term) => q.includes(term));
};

const calculateBrandMetrics = (queries) => {
  if (!queries || !Array.isArray(queries) || queries.length === 0) {
    return {
      brandQueryShare: 0,
      brandCtr: 0,
      brandAvgPosition: null
    };
  }

  const ranking = queries.filter((q) => {
    const pos = q.position || 0;
    const impr = q.impressions || 0;
    return pos > 0 && pos <= 20 && impr > 0;
  });

  if (ranking.length === 0) {
    return {
      brandQueryShare: 0,
      brandCtr: 0,
      brandAvgPosition: null
    };
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

  return {
    brandQueryShare,
    brandCtr,
    brandAvgPosition
  };
};

const normalisePositionForBrand = (pos, minPos = 1, maxPos = 10) => {
  if (pos == null) return 0;
  const clamped = Math.max(minPos, Math.min(maxPos, pos));
  const t = (clamped - minPos) / (maxPos - minPos);
  return 100 - t * 100;
};

const computeBrandOverlay = (args) => {
  const {
    brandQueryShare = 0,
    brandCtr = 0,
    brandAvgPosition = null,
    reviewScore = 0,
    entityScore = 0
  } = args || {};

  const shareScore = Math.min(brandQueryShare / 0.3, 1) * 100;
  const ctrScore = Math.min(brandCtr / 0.4, 1) * 100;
  const posScore = normalisePositionForBrand(brandAvgPosition, 1, 10);

  const brandSearchScore =
    0.4 * shareScore +
    0.3 * ctrScore +
    0.3 * posScore;

  const combined =
    0.4 * brandSearchScore +
    0.3 * reviewScore +
    0.3 * entityScore;

  let label = 'Strong';
  if (combined < 40) label = 'Weak';
  else if (combined < 70) label = 'Developing';

  const notes = [];
  if (brandQueryShare < 0.1) notes.push('Low share of branded searches in GSC.');
  if (brandCtr < 0.25) notes.push('Branded CTR is below 25%.');
  if (brandAvgPosition == null || brandAvgPosition > 5) {
    notes.push('Branded queries do not consistently rank in top-5.');
  }
  if (reviewScore < 70) notes.push('Review rating / volume is still maturing.');
  if (entityScore < 70) notes.push('Knowledge-panel / entity coverage could be stronger.');

  return {
    score: Math.round(combined),
    label,
    brandQueryShare,
    brandCtr,
    brandAvgPosition,
    reviewScore,
    entityScore,
    notes
  };
};

export {
  calculateBrandMetrics,
  computeBrandOverlay,
  isBrandQuery
};

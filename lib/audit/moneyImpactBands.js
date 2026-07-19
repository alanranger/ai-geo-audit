import bandsConfig from '../../config/money-impact-bands.json' with { type: 'json' };

const IMPACT_THRESHOLDS = Object.freeze({
  HIGH: Number(bandsConfig.thresholds?.HIGH) || 15,
  MEDIUM: Number(bandsConfig.thresholds?.MEDIUM) || 5
});

const ALLOWED_HTTP_CHIPS = new Set(
  (bandsConfig.allowedHttpStatusChips || [200, 301, 404]).map(Number)
);

const expectedCtrForPosition = (pos) => {
  if (!isFinite(pos) || pos <= 0) return 0.10;
  if (pos <= 3) return 0.10;
  if (pos <= 6) return 0.07;
  if (pos <= 10) return 0.05;
  if (pos <= 20) return 0.03;
  return 0.02;
};

const lostClicksForPage = (page) => {
  const expectedCtr = expectedCtrForPosition(page.avgPosition);
  const gap = Math.max(0, expectedCtr - (page.ctr || 0));
  return (page.impressions || 0) * gap;
};

const impactLevelFromLostClicks = (lost, thresholds = IMPACT_THRESHOLDS) => {
  if (lost >= thresholds.HIGH) return 'HIGH';
  if (lost >= thresholds.MEDIUM) return 'MEDIUM';
  return 'LOW';
};

const computeImpactLevels = (pages, thresholds = IMPACT_THRESHOLDS) => {
  if (!pages?.length) return;
  for (const p of pages) {
    const lost = lostClicksForPage(p);
    p._lostClicks = lost;
    p.impactLevel = impactLevelFromLostClicks(lost, thresholds);
  }
};

/** Hide unknown/auth errors; show only crawl-confirmed statuses. */
const formatHttpStatusChip = (statusCode) => {
  const code = Number(statusCode);
  if (!Number.isFinite(code) || !ALLOWED_HTTP_CHIPS.has(code)) return null;
  return `HTTP ${code}`;
};

export {
  IMPACT_THRESHOLDS,
  ALLOWED_HTTP_CHIPS,
  expectedCtrForPosition,
  lostClicksForPage,
  impactLevelFromLostClicks,
  computeImpactLevels,
  formatHttpStatusChip,
  bandsConfig
};

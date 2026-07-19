/**
 * Browser bridge: single Money Pages scoring engine (Matrix, Opportunity, Top 10).
 */
import {
  buildMoneyPageMetrics,
  classifyMoneyPageOpportunity,
  computeImpactLevels,
  expectedCtrForPosition,
  derivePriorityLevel,
  lostClicksForPage,
  impactLevelFromLostClicks,
  IMPACT_THRESHOLDS
} from './moneyPages.js';
import { formatHttpStatusChip } from './moneyImpactBands.js';

const scoring = {
  buildMoneyPageMetrics,
  classifyMoneyPageOpportunity,
  computeImpactLevels,
  expectedCtrForPosition,
  derivePriorityLevel,
  lostClicksForPage,
  impactLevelFromLostClicks,
  formatHttpStatusChip,
  IMPACT_THRESHOLDS,
  engine: 'moneyPages.js+pinned-bands-v1'
};

window.MoneyPagesScoring = scoring;

if (typeof window.buildMoneyPageMetrics === 'function') {
  window.buildMoneyPageMetrics = buildMoneyPageMetrics;
}
if (typeof window.classifyMoneyPageOpportunity === 'function') {
  window.classifyMoneyPageOpportunity = classifyMoneyPageOpportunity;
}
window.formatMoneyPageHttpStatusChip = formatHttpStatusChip;
window.MoneyPagesScoringBridgeReady = true;

export { scoring };

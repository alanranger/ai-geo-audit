/**
 * Previews / test sends of a past week: start from that week's stored metrics and rebuild the blocks whose
 * logic changed since, as at the snapshot's generated_at. Read-only (no snapshot, refresh, audit or DFS call).
 */
import { buildSectionG } from './sectionG.js';
import { attachRedesign } from './redesign-data.js';
import { weekOnWeekBlocks } from './metrics.js';
import { buildAcademyWeeklyMetrics } from './academy.js';
import { buildStrategyBrief } from './strategyScorecard.js';

export async function rebuildForPreview(sb, metrics, { week, propertyUrl }) {
  const asOf = metrics.generated_at;
  metrics.section_g = await buildSectionG(sb, { propertyUrl, asOf });
  const blocks = await weekOnWeekBlocks(sb, week);
  metrics.backlinks = blocks.backlinks;
  metrics.seo_health = blocks.seo_health;
  metrics.academy = await buildAcademyWeeklyMetrics();
  metrics.strategy = await buildStrategyBrief(sb, propertyUrl);
  await attachRedesign(sb, metrics, { propertyUrl, weekStart: week, asOf });
  return metrics;
}

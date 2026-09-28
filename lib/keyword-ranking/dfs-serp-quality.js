/**
 * Detect DataForSEO Live Advanced crawls that accepted depth>10 but only
 * returned a page-1 / degraded SERP (status 20000, often cost ≈ $0.002).
 * Those must not be persisted as confident "unranked".
 */

/** @param {{ depth?: number, organicCount?: number, itemsCount?: number, seResultsCount?: number|null, cost?: number|null, error?: string|null }} p */
export function isIncompleteSerpCrawl(p = {}) {
  const depth = Number(p.depth) || 0;
  const organicCount = Number(p.organicCount) || 0;
  const itemsCount = Number(p.itemsCount) || 0;
  const seResultsCount = p.seResultsCount == null ? null : Number(p.seResultsCount);
  const cost = p.cost == null ? null : Number(p.cost);
  const err = p.error ? String(p.error) : '';

  if (itemsCount <= 0) return true;
  if (err && /empty SERP|Unexpected server|request failed/i.test(err) && organicCount <= 0) {
    return true;
  }

  // Relative to requested depth: page-1-only deliveries look like ~6–12 organics
  // when we asked for 50. Full crawls typically return 40+.
  const minOrganic = depth >= 50 ? 15 : depth >= 30 ? 12 : depth >= 20 ? 8 : 0;
  if (minOrganic > 0 && organicCount < minOrganic) return true;

  // Live base price is $0.002 for page 1; depth 50 should bill multi-page (~$0.008+).
  if (depth >= 40 && cost != null && Number.isFinite(cost) && cost > 0 && cost <= 0.0025) {
    return true;
  }

  // DFS sometimes reports se_results_count ≈ organic count on thin crawls (6–8)
  // while a healthy UK SERP reports hundreds+.
  if (
    depth >= 40
    && seResultsCount != null
    && Number.isFinite(seResultsCount)
    && seResultsCount > 0
    && seResultsCount < 20
    && organicCount < 15
  ) {
    return true;
  }

  return false;
}

export const SERP_CRAWL_INCOMPLETE_ERROR = 'DFS incomplete crawl (thin SERP vs requested depth)';

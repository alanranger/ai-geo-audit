/**
 * Page segment tier for a DFS backlink target URL (`url_to`).
 * Mirrors `traditionalSeoPathTierGuessForParity` path rules in audit-dashboard.html
 * (browser may call `classifyDashboardSubsegment` first; Node uses paths only).
 */
export function dfsBacklinkPageTierFromTargetUrl(raw) {
  const rawStr = String(raw || '').trim();
  if (!rawStr) return 'unmapped';
  let path = '';
  try {
    const href = /^https?:\/\//i.test(rawStr) ? rawStr : `https://${rawStr.replace(/^\/+/, '')}`;
    path = String(new URL(href).pathname || '/').toLowerCase();
  } catch {
    path = rawStr.toLowerCase();
  }
  if (!path) return 'unmapped';
  // Event: match money-page segmentation + paths where "workshops" is hyphenated (not /workshops/)
  if (
    path.includes('/beginners-photography-lessons') ||
    path.includes('/photographic-workshops-near-me') ||
    path.includes('/workshops') ||
    path.includes('/event') ||
    path.includes('/webinar')
  ) {
    return 'event';
  }
  if (path.includes('/academy') || path.includes('/free-online-photography-course')) return 'academy';
  if (path.includes('/blog') || path.includes('/article') || path.includes('/guides')) return 'blog';
  if (
    path.includes('/photo-workshops-uk') ||
    path.includes('/photography-services-near-me') ||
    path === '/photography-services' ||
    path.startsWith('/photography-services/') ||
    path.includes('/product') ||
    path.includes('/courses') ||
    path.includes('/mentoring') ||
    path.includes('/subscription')
  ) {
    return 'product';
  }
  if (path.split('/').filter(Boolean).length <= 1) return 'landing';
  return 'unmapped';
}

/** A→F order for stable table sort (matches dashboard tier labels). */
const PAGE_TIER_SORT_INDEX = {
  landing: 0,
  product: 1,
  event: 2,
  blog: 3,
  academy: 4,
  unmapped: 5
};

export function dfsBacklinkPageTierSortIndex(tier) {
  const t = String(tier || 'unmapped').toLowerCase();
  return Object.prototype.hasOwnProperty.call(PAGE_TIER_SORT_INDEX, t)
    ? PAGE_TIER_SORT_INDEX[t]
    : 99;
}

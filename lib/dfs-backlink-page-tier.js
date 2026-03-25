/**
 * Sort order for page tier columns (A→F). Tier resolution for backlinks uses
 * `getTierForUrlFromLookup` + segmentation CSV in `api/aigeo/tier-segmentation.js`.
 */

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

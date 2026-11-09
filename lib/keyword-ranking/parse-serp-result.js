/**
 * One DataForSEO organic live/advanced `result[0]` → our ranking fields. Shared by serp-rank-test (live
 * captures) and the stored-response recompute (task_get), so both use the same "is this us?" matching.
 * Ownership is decided only after every Google redirect is resolved (serp-redirect-owner.js).
 */

import { extractCitationsFromDfsResult } from '../ai-citation-extract.js';
import { resolveSerpItems } from './serp-redirect-owner.js';
import { applyRedirectLookups } from './redirect-lookups.js';
import { extractSerpSurfaces, isOurDomain } from './serp-surface-extract.js';
import { buildSerpSurfaceStack } from './serp-surface-stack.js';

/** Best (lowest rank_group) organic result on our domain. */
export function bestOurOrganic(items, targetRoot) {
  let best = null;
  for (const item of items || []) {
    if (item?.type !== 'organic' || !isOurDomain(item.domain || item.url, targetRoot)) continue;
    if (!best || item.rank_group < best.rank_group) best = item;
  }
  return {
    best_rank_group: best ? best.rank_group : null,
    best_rank_absolute: best ? best.rank_absolute : null,
    best_url: best ? best.url : null,
    best_title: best ? best.title : null,
  };
}

/**
 * @param {object} result DFS tasks[0].result[0]
 * @param {string} targetRoot e.g. "alanranger.com"
 * @param {{ titles?: Map, cids?: Map }} [lookups] from loadRedirectLookups()
 */
export function parseSerpResult(result, targetRoot, lookups = {}) {
  const items = applyRedirectLookups(resolveSerpItems(result?.items ?? [], targetRoot), targetRoot, lookups);
  return {
    items,
    ...bestOurOrganic(items, targetRoot),
    surfaces: extractSerpSurfaces(items, targetRoot),
    ai_overview_citations: extractCitationsFromDfsResult({ ...result, items }, targetRoot),
    serp_surface_stack: buildSerpSurfaceStack(items, targetRoot),
  };
}

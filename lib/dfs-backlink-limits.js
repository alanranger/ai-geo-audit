const toNum = (v, fb) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
};

/** Max backlink rows stored per page URL for DFS page list (fetch + modal). Default 100; clamp 1–500. */
export function dfsPageBacklinksMax() {
  const n = toNum(process.env.DFS_PAGE_BACKLINKS_MAX, 100);
  return Math.max(1, Math.min(500, n || 100));
}

export function dfsClientLimits() {
  return { dfsPageBacklinksMax: dfsPageBacklinksMax() };
}

/**
 * Rank scale for DataForSEO `backlinks/backlinks/live` tasks.
 * Use `one_hundred` to match `backlinks/summary/live` when that call sets rank_scale the same way.
 * Override with env `DFS_BACKLINK_RANK_SCALE=one_thousand` if needed.
 */
export function dfsBacklinksLiveRankScale() {
  const raw = String(process.env.DFS_BACKLINK_RANK_SCALE || 'one_hundred').trim().toLowerCase();
  if (raw === 'one_thousand' || raw === '1000' || raw === 'thousand') return 'one_thousand';
  return 'one_hundred';
}

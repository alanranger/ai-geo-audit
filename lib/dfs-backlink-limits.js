const toNum = (v, fb) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
};

/** DataForSEO `backlinks/live` returns at most this many items per task. */
const DFS_BACKLINKS_LIVE_HARD_CAP = 1000;

/**
 * Max backlink rows kept per page for UI + domain-index merge (from Supabase).
 * Default 50_000 so homepages are not stuck at 100. Clamped 1–250_000.
 * Env: `DFS_PAGE_BACKLINKS_MAX`.
 */
export function dfsPageBacklinksMax() {
  const n = toNum(process.env.DFS_PAGE_BACKLINKS_MAX, 50000);
  return Math.max(1, Math.min(250000, n || 50000));
}

/**
 * Limit for a single `backlinks/live` HTTP task (API max 1000 per request).
 * Page refresh cannot return more until we add pagination (`search_after_token`).
 */
export function dfsPageBacklinksLiveTaskLimit() {
  return Math.min(dfsPageBacklinksMax(), DFS_BACKLINKS_LIVE_HARD_CAP);
}

export function dfsClientLimits() {
  return {
    dfsPageBacklinksMax: dfsPageBacklinksMax(),
    dfsPageBacklinksLiveTaskLimit: dfsPageBacklinksLiveTaskLimit()
  };
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

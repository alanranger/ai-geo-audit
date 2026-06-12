/**
 * Shared Authority ranking-pool rules (Behaviour top-10 band + Ranking score).
 * Keep in sync with audit-dashboard.html scoring helpers.
 */

export const RANKING_CRITERIA = {
  /** Positions at or below this count as "top 10" (softened from strict 10). */
  TOP10_POSITION_MAX: 10.5,
  /** Max share of pool impressions any single query+page row may contribute. */
  MAX_ROW_IMPRESSION_SHARE: 0.25,
  /** Ranking = positionBlend * posScore + top10Blend * top10Score */
  POSITION_BLEND: 0.7,
  TOP10_BLEND: 0.3,
  POOL_MAX_POSITION: 20,
};

export function isTop10Position(position) {
  const p = Number(position);
  return Number.isFinite(p) && p > 0 && p <= RANKING_CRITERIA.TOP10_POSITION_MAX;
}

export function filterRankingPoolQueries(queries) {
  if (!queries || !Array.isArray(queries)) return [];
  return queries.filter(
    (q) =>
      q.position > 0 &&
      q.position <= RANKING_CRITERIA.POOL_MAX_POSITION &&
      q.impressions > 0
  );
}

/** Cap each row's impressions so no row exceeds MAX_ROW_IMPRESSION_SHARE of the pool total. */
export function capRankingPoolImpressions(rows) {
  if (!rows || !Array.isArray(rows) || rows.length === 0) return [];
  let pool = rows.map((q) => ({ ...q, impressions: Number(q.impressions) || 0 }));
  for (let pass = 0; pass < 8; pass += 1) {
    const totalImpr = pool.reduce((s, q) => s + q.impressions, 0);
    if (totalImpr <= 0) return pool;
    const maxImpr = totalImpr * RANKING_CRITERIA.MAX_ROW_IMPRESSION_SHARE;
    let changed = false;
    pool = pool.map((q) => {
      if (q.impressions > maxImpr) {
        changed = true;
        return { ...q, impressions: maxImpr };
      }
      return q;
    });
    if (!changed) break;
  }
  return pool;
}

export function prepareRankingPool(queries) {
  return capRankingPoolImpressions(filterRankingPoolQueries(queries));
}

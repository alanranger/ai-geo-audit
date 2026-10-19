/**
 * Commercial-pool rank-band demand (same rules as Ranking tiles / ToP v4).
 * Pool = money keywords above class floors (national ≥50 · local/regional ≥10).
 * Brand/education excluded from the demand pool.
 */
import { meetsTopOfPageDemandPool } from '../audit/topOfPage.js';
import { isFailedSerpCapture } from './dfs-serp-quality.js';

function demandVol(row) {
  const v = Number(row?.search_volume);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * @param {Array} rows LOCKED-tracked keyword rows
 * @param {(row: object) => boolean} bandPredicate
 */
export function computeRankBandDemandMetrics(rows, bandPredicate) {
  const measurable = (Array.isArray(rows) ? rows : []).filter(
    (r) => r && !isFailedSerpCapture(r)
  );
  const pool = [];
  let excludedLowVol = 0;
  let excludedClass = 0;
  for (const r of measurable) {
    const cls = r.keyword_class || 'national-money';
    if (cls === 'brand' || cls === 'education') {
      excludedClass += 1;
      continue;
    }
    if (!meetsTopOfPageDemandPool(r, cls)) {
      excludedLowVol += 1;
      continue;
    }
    pool.push(r);
  }

  let demandAll = 0;
  let demandBand = 0;
  let count = 0;
  for (const r of pool) {
    const vol = demandVol(r);
    demandAll += vol;
    if (typeof bandPredicate === 'function' && bandPredicate(r)) {
      demandBand += vol;
      count += 1;
    }
  }
  const demandPct = demandAll > 0 ? Math.round((demandBand / demandAll) * 100) : 0;
  return {
    count,
    poolSize: pool.length,
    measurable: measurable.length,
    demandPct,
    demandBand,
    demandAll,
    excludedLowVol,
    excludedClass,
    schema_version: 4,
  };
}

export function computeCommercialPoolDemandBands(rows) {
  const rank1 = computeRankBandDemandMetrics(
    rows,
    (r) => Number(r.best_rank_group) === 1
  );
  const top10 = computeRankBandDemandMetrics(
    rows,
    (r) => r.best_rank_group != null && Number(r.best_rank_group) <= 10
  );
  const strike = computeRankBandDemandMetrics(rows, (r) => {
    const g = Number(r.best_rank_group);
    return Number.isFinite(g) && g >= 11 && g <= 20;
  });
  return { rank1, top10, strike };
}

/**
 * Monday cron Ranking guards — keep serverless ticks safe vs dashboard’s
 * long-lived browser loop (same APIs, different runtime).
 */

export const RANKING_WALL_MS = 90 * 60 * 1000; // ~dashboard Full Refresh ceiling
export const MAX_RANKING_MULTI_TICKS = 10;
export const CRON_SERP_BATCH_SIZE = 5;
export const CRON_AI_BATCH_SIZE = 5;
export const CRON_TICK_BUDGET_MS = 180000;

export function isHaltRequested(state, progress, { forceRestart = false, cancelQuery = false } = {}) {
  if (forceRestart) return false;
  if (cancelQuery) return true;
  if (progress?.cancelled === true) return true;
  const st = String(state?.state || '');
  if (st === 'cancelled' || st === 'halted') return true;
  if (progress?.email_sent && st === 'done') return true;
  return false;
}

export function rankingWallExceeded(progress, nowMs = Date.now()) {
  const started = progress?.ranking_started_at;
  if (!started) return false;
  const t0 = Date.parse(started);
  if (!Number.isFinite(t0)) return false;
  return nowMs - t0 >= RANKING_WALL_MS;
}

export function rankingTicksExceeded(progress) {
  return Number(progress?.multi_ticks || 0) >= MAX_RANKING_MULTI_TICKS;
}

/** Compact ranking blob so mid-tick saves stay under timeout. */
export function slimRankingForPersist(ranking) {
  if (!ranking || typeof ranking !== 'object') return null;
  return {
    phase: ranking.phase || 'init',
    auditDate: ranking.auditDate || null,
    keywords: Array.isArray(ranking.keywords) ? ranking.keywords : [],
    serpBatchIndex: Number(ranking.serpBatchIndex) || 0,
    aiBatchIndex: Number(ranking.aiBatchIndex) || 0,
    spendState: ranking.spendState || null,
    baselines: ranking.baselines && typeof ranking.baselines === 'object' ? ranking.baselines : {},
    serpRows: slimRows(ranking.serpRows),
    aiRows: slimRows(ranking.aiRows)
  };
}

function slimRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => {
    if (!r || typeof r !== 'object') return r;
    return {
      keyword: r.keyword || r.query || null,
      query: r.query || r.keyword || null,
      best_rank_group: r.best_rank_group ?? null,
      best_rank_absolute: r.best_rank_absolute ?? null,
      best_url: r.best_url ?? null,
      best_title: r.best_title ?? null,
      has_ai_overview: r.has_ai_overview ?? false,
      total_citations: r.total_citations ?? r.ai_total_citations ?? 0,
      alanranger_citations_count: r.alanranger_citations_count ?? r.ai_alan_citations_count ?? 0,
      alanranger_citations: Array.isArray(r.alanranger_citations) ? r.alanranger_citations.slice(0, 5) : [],
      search_volume: r.search_volume ?? null,
      error: r.error || null,
      serp_features: r.serp_features || null,
      location_name: r.location_name || null
    };
  });
}

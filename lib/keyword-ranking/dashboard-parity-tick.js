/**
 * Ranking & AI tick that mirrors dashboard loadRankingAiData(true):
 * - keywords from GET /api/keywords/get
 * - begin-keyword-audit-day replace semantics
 * - Local preflight via serp-rank-test { preflight_only: true }
 * - SERP batches of 20, sequential, body { keywords, depth: 50 } (no client locations map)
 * - AI Mode batches of 10, sequential, body { queries }
 * - Incremental save after each SERP batch; final merge + audit_results upsert
 *
 * Designed for ceo-weekly-full-refresh: small batches + onProgress checkpoint
 * after each paid batch so a Vercel kill cannot re-buy the same SERP work.
 */

import {
  fetchJson,
  buildCombinedRows,
  buildSummary,
  buildKeywordRows,
  saveKeywordBatch
} from './refresh-core.js';
import { upsertRankingDialScores } from './ranking-dial-scores.js';
import { fetchRankBaselines } from './load-rank-baselines.js';
import { GEO_METHOD_GBP_PIN } from './dfs-serp-quality.js';

export const SERP_BATCH_SIZE = 20;
export const AI_BATCH_SIZE = 10;
export const SERP_DEPTH = 50;
export const TICK_BUDGET_MS = 240000;

function emptyState() {
  return {
    phase: 'init',
    auditDate: null,
    keywords: [],
    serpBatchIndex: 0,
    aiBatchIndex: 0,
    serpRows: [],
    aiRows: [],
    spendState: null,
  };
}

async function postJson(url, body, headers = {}) {
  return fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
}

async function upsertRankingAiAudit(propertyUrl, summary, combinedRows) {
  // Dial scores always prefer keyword_rankings (full serp_surface_stack), not slimmed cron memory.
  await upsertRankingDialScores({
    propertyUrl,
    auditDate: new Date().toISOString().slice(0, 10),
    summary,
    combinedRows
  });
}

async function saveSerpBatch(baseUrl, propertyUrl, auditDate, serpBatchRows) {
  const combined = buildCombinedRows(serpBatchRows, []);
  const keywordRows = buildKeywordRows(combined, auditDate, propertyUrl, { stampRefreshedAt: true });
  if (!keywordRows.length) return { saved: 0 };
  await saveKeywordBatch(baseUrl, { propertyUrl, auditDate, keywordRows });
  return { saved: keywordRows.length };
}

/**
 * @returns {{ done: boolean, ok: boolean, error?: string, state: object, detail?: object }}
 */
export async function runDashboardParityRankingTick({
  baseUrl,
  propertyUrl,
  state: rawState = null,
  headers = {},
  budgetMs = TICK_BUDGET_MS,
  serpBatchSize = SERP_BATCH_SIZE,
  aiBatchSize = AI_BATCH_SIZE,
  onProgress = null
} = {}) {
  const t0 = Date.now();
  const state = rawState && typeof rawState === 'object' ? { ...emptyState(), ...rawState } : emptyState();
  const serpSize = Math.max(1, Math.min(20, Number(serpBatchSize) || SERP_BATCH_SIZE));
  const aiSize = Math.max(1, Math.min(10, Number(aiBatchSize) || AI_BATCH_SIZE));
  const deadline = () => Date.now() - t0 >= budgetMs;
  const checkpoint = async (detail) => {
    if (typeof onProgress !== 'function') return;
    await onProgress({ ...state }, detail || null);
  };

  try {
    if (state.phase === 'init' || state.phase === 'done') {
      const keywordsResp = await fetchJson(`${baseUrl}/api/keywords/get`, {
        headers: { ...headers, cache: 'no-store' }
      });
      const keywords = (keywordsResp?.keywords || keywordsResp?.data || [])
        .map((k) => String(k || '').trim())
        .filter(Boolean);
      if (!keywords.length) {
        return { done: true, ok: false, error: 'no_keywords', state: emptyState() };
      }

      const auditDate = new Date().toISOString().slice(0, 10);
      await postJson(`${baseUrl}/api/supabase/begin-keyword-audit-day`, { auditDate, propertyUrl }, headers);

      const pf = await postJson(
        `${baseUrl}/api/aigeo/serp-rank-test`,
        { keywords, preflight_only: true },
        headers
      );
      if (pf?.preflight?.ok === false) {
        const missing = (pf?.preflight?.missingKeywords || []).slice(0, 8).join(', ');
        return {
          done: true,
          ok: false,
          error: `Local capture preflight failed: ${missing || 'see preflight'}`,
          state: emptyState()
        };
      }

      state.phase = 'serp';
      state.auditDate = auditDate;
      state.keywords = keywords;
      state.serpBatchIndex = 0;
      state.aiBatchIndex = 0;
      state.serpRows = [];
      state.aiRows = [];
      state.spendState = null;
      // Comparable pin-series baselines for bounded confirmation (read-only).
      try {
        state.baselines = await fetchRankBaselines({
          propertyUrl,
          keywords,
          beforeDate: auditDate,
          preferGeoMethod: GEO_METHOD_GBP_PIN,
        });
      } catch (_e) {
        state.baselines = {};
      }
    }

    if (state.phase === 'serp') {
      const batches = [];
      for (let i = 0; i < state.keywords.length; i += serpSize) {
        batches.push(state.keywords.slice(i, i + serpSize));
      }
      while (state.serpBatchIndex < batches.length && !deadline()) {
        const batchIdx = state.serpBatchIndex;
        const batch = batches[batchIdx];
        const batchBaselines = {};
        for (const kw of batch) {
          const key = String(kw || '').trim().toLowerCase().replace(/\s+/g, ' ');
          if (state.baselines?.[kw]) batchBaselines[kw] = state.baselines[kw];
          else if (state.baselines?.[key]) batchBaselines[kw] = state.baselines[key];
        }
        let serpJson;
        try {
          serpJson = await postJson(
            `${baseUrl}/api/aigeo/serp-rank-test`,
            {
              keywords: batch,
              depth: SERP_DEPTH,
              baselines: Object.keys(batchBaselines).length ? batchBaselines : undefined,
              spend_state: state.spendState || undefined,
            },
            headers
          );
          if (serpJson?.spend_limits) state.spendState = serpJson.spend_limits;
        } catch (err) {
          if (batchIdx === 0) {
            return {
              done: true,
              ok: false,
              error: `SERP first batch failed: ${err.message}`,
              state: emptyState()
            };
          }
          batch.forEach((kw) => {
            state.serpRows.push({
              keyword: kw,
              best_rank_group: null,
              best_rank_absolute: null,
              best_url: null,
              error: String(err.message || err)
            });
          });
          state.serpBatchIndex += 1;
          await checkpoint({ phase: 'serp', batch: state.serpBatchIndex, total: batches.length });
          continue;
        }
        const per = Array.isArray(serpJson?.per_keyword) ? serpJson.per_keyword : [];
        state.serpRows.push(...per);
        await saveSerpBatch(baseUrl, propertyUrl, state.auditDate, per);
        state.serpBatchIndex += 1;
        // Persist after each paid batch (dashboard keeps this in browser memory).
        await checkpoint({ phase: 'serp', batch: state.serpBatchIndex, total: batches.length });
      }
      if (state.serpBatchIndex >= batches.length) {
        state.phase = 'ai';
        await checkpoint({ phase: 'ai', batch: 0 });
      } else {
        return {
          done: false,
          ok: true,
          state,
          detail: { phase: 'serp', batch: state.serpBatchIndex, total: batches.length }
        };
      }
    }

    if (state.phase === 'ai') {
      const batches = [];
      for (let i = 0; i < state.keywords.length; i += aiSize) {
        batches.push(state.keywords.slice(i, i + aiSize));
      }
      while (state.aiBatchIndex < batches.length && !deadline()) {
        const batch = batches[state.aiBatchIndex];
        try {
          const aiJson = await postJson(
            `${baseUrl}/api/aigeo/ai-mode-serp-batch-test`,
            { queries: batch },
            headers
          );
          const per = Array.isArray(aiJson?.per_query) ? aiJson.per_query : [];
          state.aiRows.push(...per);
        } catch (err) {
          batch.forEach((keyword) => {
            state.aiRows.push({
              query: keyword,
              has_ai_overview: false,
              total_citations: 0,
              alanranger_citations_count: 0,
              alanranger_citations: [],
              error: String(err.message || err)
            });
          });
        }
        state.aiBatchIndex += 1;
        await checkpoint({ phase: 'ai', batch: state.aiBatchIndex, total: batches.length });
        if (state.aiBatchIndex < batches.length) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      if (state.aiBatchIndex >= batches.length) {
        state.phase = 'finalize';
      } else {
        return {
          done: false,
          ok: true,
          state,
          detail: { phase: 'ai', batch: state.aiBatchIndex, total: batches.length }
        };
      }
    }

    if (state.phase === 'finalize') {
      const combinedRows = buildCombinedRows(state.serpRows, state.aiRows);
      if (!combinedRows.length) {
        return { done: true, ok: false, error: 'No SERP rows returned for keywords', state: emptyState() };
      }
      const summary = buildSummary(combinedRows);
      const keywordRows = buildKeywordRows(combinedRows, state.auditDate, propertyUrl, { stampRefreshedAt: true });
      await saveKeywordBatch(baseUrl, { propertyUrl, auditDate: state.auditDate, keywordRows });
      await upsertRankingAiAudit(propertyUrl, summary, combinedRows);
      return {
        done: true,
        ok: true,
        state: { ...emptyState(), phase: 'done' },
        detail: { keywords: state.keywords.length, summary }
      };
    }

    return { done: false, ok: true, state };
  } catch (err) {
    return {
      done: true,
      ok: false,
      error: err?.message || String(err),
      state: emptyState()
    };
  }
}

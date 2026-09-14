/**
 * Ranking & AI tick that mirrors dashboard loadRankingAiData(true):
 * - keywords from GET /api/keywords/get
 * - begin-keyword-audit-day replace semantics
 * - Local preflight via serp-rank-test { preflight_only: true }
 * - SERP batches of 20, sequential, body { keywords, depth: 50 } (no client locations map)
 * - AI Mode batches of 10, sequential, body { queries }
 * - Incremental save after each SERP batch; final merge + audit_results upsert
 *
 * Designed for ceo-weekly-full-refresh: one tick returns continue|done so the
 * parent stepper never awaits a single 300s monolith.
 */

import {
  fetchJson,
  buildCombinedRows,
  buildSummary,
  buildKeywordRows,
  saveKeywordBatch
} from './refresh-core.js';

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
    aiRows: []
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
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return;
  const nowIso = new Date().toISOString();
  const auditDate = nowIso.slice(0, 10);
  const response = await fetch(`${supabaseUrl}/rest/v1/audit_results?on_conflict=property_url,audit_date`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Prefer: 'resolution=merge-duplicates'
    },
    body: JSON.stringify({
      property_url: propertyUrl,
      audit_date: auditDate,
      ranking_ai_data: { summary, combinedRows, lastRunTimestamp: nowIso },
      updated_at: nowIso
    })
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`audit_results upsert failed: HTTP ${response.status} ${text.slice(0, 200)}`);
  }
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
  budgetMs = TICK_BUDGET_MS
} = {}) {
  const t0 = Date.now();
  const state = rawState && typeof rawState === 'object' ? { ...emptyState(), ...rawState } : emptyState();
  const deadline = () => Date.now() - t0 >= budgetMs;

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
    }

    if (state.phase === 'serp') {
      const batches = [];
      for (let i = 0; i < state.keywords.length; i += SERP_BATCH_SIZE) {
        batches.push(state.keywords.slice(i, i + SERP_BATCH_SIZE));
      }
      while (state.serpBatchIndex < batches.length && !deadline()) {
        const batchIdx = state.serpBatchIndex;
        const batch = batches[batchIdx];
        let serpJson;
        try {
          serpJson = await postJson(
            `${baseUrl}/api/aigeo/serp-rank-test`,
            { keywords: batch, depth: SERP_DEPTH },
            headers
          );
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
          continue;
        }
        const per = Array.isArray(serpJson?.per_keyword) ? serpJson.per_keyword : [];
        state.serpRows.push(...per);
        await saveSerpBatch(baseUrl, propertyUrl, state.auditDate, per);
        state.serpBatchIndex += 1;
      }
      if (state.serpBatchIndex >= batches.length) {
        state.phase = 'ai';
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
      for (let i = 0; i < state.keywords.length; i += AI_BATCH_SIZE) {
        batches.push(state.keywords.slice(i, i + AI_BATCH_SIZE));
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

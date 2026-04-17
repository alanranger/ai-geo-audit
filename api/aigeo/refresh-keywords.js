/**
 * Ad-hoc keyword refresh endpoint (1..N keywords).
 *
 * POST body:
 *   {
 *     keywords:    string[]   // 1..MAX_BATCH keywords to refetch
 *     propertyUrl: string     // e.g. "https://www.alanranger.com"
 *     auditDate:   string     // "YYYY-MM-DD" — which audit snapshot to patch into
 *     depth?:      number     // optional DFS SERP depth (10..100, default 100)
 *   }
 *
 * Response:
 *   {
 *     status: "ok",
 *     refreshed_at: ISO string,
 *     rows: combinedRow[]     // same shape the dashboard already consumes
 *   }
 *
 * Design notes (see conversation 2026-04-17):
 *   - We WRITE only `keyword_rankings` (the per-keyword row). We do NOT mutate
 *     the `audit_results` snapshot — the sparkline + previous-audit delta both
 *     read from that table and must stay a clean record of full audits.
 *   - We stamp `last_refreshed_at` on every row we touch so the UI can show a
 *     freshness badge and distinguish "live pull" from "last full audit".
 *   - Upstream fetches + row shaping live in lib/keyword-ranking/refresh-core.js
 *     and are shared with the scheduled cron, so the two flows can't drift.
 */

import {
  fetchSerpRows,
  fetchAiRows,
  buildCombinedRows,
  buildKeywordRows,
  saveKeywordBatch,
  resolveBaseUrl,
  DEFAULT_REFRESH_DEPTH
} from '../../lib/keyword-ranking/refresh-core.js';

export const config = { runtime: 'nodejs', maxDuration: 60 };

const MAX_BATCH = 15; // upper bound per call — tiered refresh UI caps at 10

const sendJson = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).json(body);
};

const parseRequestBody = (body) => {
  if (!body || typeof body !== 'object') return { error: 'Request body must be a JSON object' };
  const { keywords, propertyUrl, auditDate, depth } = body;
  if (!Array.isArray(keywords) || keywords.length === 0) {
    return { error: 'keywords must be a non-empty array' };
  }
  if (keywords.length > MAX_BATCH) {
    return { error: `Too many keywords (${keywords.length}). Max ${MAX_BATCH} per refresh.` };
  }
  if (typeof propertyUrl !== 'string' || !propertyUrl.trim()) {
    return { error: 'propertyUrl is required' };
  }
  if (typeof auditDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(auditDate)) {
    return { error: 'auditDate must be in YYYY-MM-DD format' };
  }
  // Normalize + dedupe while preserving order
  const seen = new Set();
  const cleanKeywords = [];
  for (const raw of keywords) {
    const kw = String(raw || '').trim();
    if (!kw) continue;
    const dedupeKey = kw.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    cleanKeywords.push(kw);
  }
  if (cleanKeywords.length === 0) {
    return { error: 'keywords array contained only empty strings' };
  }
  return {
    keywords: cleanKeywords,
    propertyUrl: propertyUrl.trim(),
    auditDate,
    depth: Number.isFinite(Number(depth)) ? Math.round(Number(depth)) : DEFAULT_REFRESH_DEPTH
  };
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { status: 'ok' });
  if (req.method !== 'POST') {
    return sendJson(res, 405, { status: 'error', message: 'Method not allowed. Use POST.' });
  }

  const parsed = parseRequestBody(req.body);
  if (parsed.error) {
    return sendJson(res, 400, { status: 'error', message: parsed.error });
  }

  const { keywords, propertyUrl, auditDate, depth } = parsed;
  const startedAt = Date.now();

  try {
    const baseUrl = resolveBaseUrl(req);

    // Fetch SERP + AI Mode in parallel. For 1..N keywords with N<=MAX_BATCH
    // a single batch is always enough, so concurrency=1 / batchSize=MAX_BATCH
    // keeps the call profile predictable.
    const [serpRows, aiRows] = await Promise.all([
      fetchSerpRows(baseUrl, keywords, { batchSize: MAX_BATCH, concurrency: 1, depth }),
      fetchAiRows(baseUrl, keywords, { batchSize: MAX_BATCH, concurrency: 1 })
    ]);

    if (!serpRows.length) {
      return sendJson(res, 502, {
        status: 'error',
        message: 'Upstream DFS returned no SERP rows for these keywords',
        meta: { durationMs: Date.now() - startedAt }
      });
    }

    const combinedRows = buildCombinedRows(serpRows, aiRows);
    const keywordRows = buildKeywordRows(combinedRows, auditDate, propertyUrl, { stampRefreshedAt: true });

    // Stamp the same ISO on the response rows the frontend uses so the UI can
    // render the "just refreshed" badge without waiting for a round-trip read.
    const refreshedAt = keywordRows[0]?.last_refreshed_at || new Date().toISOString();
    const responseRows = combinedRows.map((row) => ({ ...row, last_refreshed_at: refreshedAt }));

    await saveKeywordBatch(baseUrl, { propertyUrl, auditDate, keywordRows });

    return sendJson(res, 200, {
      status: 'ok',
      refreshed_at: refreshedAt,
      rows: responseRows,
      meta: {
        durationMs: Date.now() - startedAt,
        keyword_count: keywordRows.length,
        depth
      }
    });
  } catch (err) {
    console.error('[refresh-keywords] Error:', err);
    return sendJson(res, 500, {
      status: 'error',
      message: err?.message || 'Unexpected server error',
      meta: { durationMs: Date.now() - startedAt }
    });
  }
}

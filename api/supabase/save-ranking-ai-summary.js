/**
 * Lightweight final save for Ranking & AI scans.
 *
 * keyword_rankings rows are already persisted incrementally during the scan.
 * This endpoint writes summary + pillar scores + Surface/Top headline scores
 * to audit_results — no full combinedRows blob, no keyword re-sync.
 *
 * POST /api/supabase/save-ranking-ai-summary
 * Body: { propertyUrl, auditDate, summary, rankingAiPillarScores,
 *         surfaceVisibilityScore?, topOfPageScore? }
 */

import { computeSurfaceVisibilityRollup } from '../../lib/audit/surfaceScores.js';
import { computeTopOfPageRollup } from '../../lib/audit/topOfPage.js';

export const config = { runtime: 'nodejs', maxDuration: 60 };

const DEFAULT_PROPERTY = 'https://www.alanranger.com';

function resolvePropertyUrl(raw) {
  const v = String(raw || process.env.GSC_PROPERTY_URL || process.env.NEXT_PUBLIC_SITE_DOMAIN || process.env.SITE_DOMAIN || DEFAULT_PROPERTY).trim();
  if (!v) return DEFAULT_PROPERTY;
  if (/^https?:\/\//i.test(v)) return v.replace(/\/+$/, '');
  return `https://${v.replace(/^www\./, '')}`.replace(/\/+$/, '');
}

async function fetchRankingRows(supabaseUrl, supabaseKey, propertyUrl, auditDate) {
  const rows = [];
  let offset = 0;
  const pageSize = 1000;
  for (;;) {
    const qs = `property_url=eq.${encodeURIComponent(propertyUrl)}` +
      `&audit_date=eq.${encodeURIComponent(auditDate)}` +
      `&select=*&order=keyword.asc&limit=${pageSize}&offset=${offset}`;
    const resp = await fetch(`${supabaseUrl}/rest/v1/keyword_rankings?${qs}`, {
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    });
    if (!resp.ok) break;
    const batch = await resp.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    rows.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

function resolveSurfaceTopFromBodyOrRows(body, rows) {
  let surface = body?.surfaceVisibilityScore != null && Number.isFinite(Number(body.surfaceVisibilityScore))
    ? Math.round(Number(body.surfaceVisibilityScore))
    : null;
  let top = body?.topOfPageScore != null && Number.isFinite(Number(body.topOfPageScore))
    ? Math.round(Number(body.topOfPageScore))
    : null;
  const pillar = body?.rankingAiPillarScores;
  if (surface == null && pillar?.surfaceVisibility?.overall != null) {
    surface = Math.round(Number(pillar.surfaceVisibility.overall));
  }
  if (top == null && pillar?.topOfPage?.overall != null) {
    top = Math.round(Number(pillar.topOfPage.overall));
  }
  if ((surface == null || top == null) && Array.isArray(rows) && rows.length) {
    const hasStack = rows.some((r) => Array.isArray(r.serp_surface_stack) && r.serp_surface_stack.length > 0);
    if (hasStack) {
      if (surface == null) surface = Math.round(Number(computeSurfaceVisibilityRollup(rows).overall) || 0);
      if (top == null) top = Math.round(Number(computeTopOfPageRollup(rows).overall) || 0);
    }
  }
  return { surface, top };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({
      status: 'error',
      message: 'Method not allowed. Use POST.',
      meta: { generatedAt: new Date().toISOString() }
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({
      status: 'error',
      message: 'Supabase not configured.',
      meta: { generatedAt: new Date().toISOString() }
    });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const propertyUrl = resolvePropertyUrl(body?.propertyUrl);
    const auditDate = String(body?.auditDate || '').trim();
    const summary = body?.summary || null;
    const rankingAiPillarScores = body?.rankingAiPillarScores ?? null;

    if (!propertyUrl || !auditDate) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required fields: propertyUrl, auditDate',
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    const rankingRows = await fetchRankingRows(supabaseUrl, supabaseKey, propertyUrl, auditDate);
    const { surface, top } = resolveSurfaceTopFromBodyOrRows(body, rankingRows);

    const rankingAiData = {
      combinedRows: [],
      summary,
      timestamp: new Date().toISOString(),
      source: 'keyword_rankings_table'
    };

    const patchPayload = {
      ranking_ai_data: rankingAiData,
      updated_at: new Date().toISOString()
    };
    if (rankingAiPillarScores !== null && rankingAiPillarScores !== undefined) {
      patchPayload.ranking_ai_pillar_scores = rankingAiPillarScores;
    }
    if (surface != null) patchPayload.surface_visibility_score = surface;
    if (top != null) patchPayload.top_of_page_score = top;

    const upsertPayload = {
      property_url: propertyUrl,
      audit_date: auditDate,
      ...patchPayload,
      is_partial: true,
      partial_reason: 'ranking_ai_only',
    };

    const upsertResp = await fetch(`${supabaseUrl}/rest/v1/audit_results?on_conflict=property_url,audit_date`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(upsertPayload),
    });

    if (!upsertResp.ok) {
      const detail = await upsertResp.text().catch(() => '');
      return res.status(upsertResp.status).json({
        status: 'error',
        message: 'Failed to save ranking summary',
        details: detail.slice(0, 500),
        meta: { generatedAt: new Date().toISOString() },
      });
    }

    const upserted = await upsertResp.json().catch(() => []);
    return res.status(200).json({
      status: 'ok',
      message: 'Ranking summary saved',
      data: upserted,
      meta: {
        generatedAt: new Date().toISOString(),
        action: 'upsert',
        surface_visibility_score: surface,
        top_of_page_score: top,
      },
    });
  } catch (err) {
    console.error('[save-ranking-ai-summary]', err);
    return res.status(500).json({
      status: 'error',
      message: err.message || 'Internal server error',
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}

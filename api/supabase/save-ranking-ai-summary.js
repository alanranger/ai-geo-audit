/**
 * Lightweight final save for Ranking & AI scans.
 *
 * keyword_rankings rows are already persisted incrementally during the scan.
 * This endpoint only writes summary + pillar scores to audit_results — no
 * full combinedRows blob, no keyword re-sync, no score recomputation.
 *
 * POST /api/supabase/save-ranking-ai-summary
 * Body: { propertyUrl, auditDate, summary, rankingAiPillarScores }
 */

export const config = { runtime: 'nodejs', maxDuration: 60 };

const DEFAULT_PROPERTY = 'https://www.alanranger.com';

function resolvePropertyUrl(raw) {
  const v = String(raw || process.env.GSC_PROPERTY_URL || process.env.NEXT_PUBLIC_SITE_DOMAIN || process.env.SITE_DOMAIN || DEFAULT_PROPERTY).trim();
  if (!v) return DEFAULT_PROPERTY;
  if (/^https?:\/\//i.test(v)) return v.replace(/\/+$/, '');
  return `https://${v.replace(/^www\./, '')}`.replace(/\/+$/, '');
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
      meta: { generatedAt: new Date().toISOString(), action: 'upsert' },
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

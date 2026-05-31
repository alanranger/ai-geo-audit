/**
 * Get current keyword list from latest keyword_rankings snapshot
 *
 * GET /api/keywords/get
 */

const DEFAULT_PROPERTY = 'https://www.alanranger.com';

function resolvePropertyUrl() {
  const raw = process.env.GSC_PROPERTY_URL
    || process.env.NEXT_PUBLIC_SITE_DOMAIN
    || process.env.SITE_DOMAIN
    || DEFAULT_PROPERTY;
  const v = String(raw || '').trim();
  if (!v) return DEFAULT_PROPERTY;
  if (/^https?:\/\//i.test(v)) return v.replace(/\/+$/, '');
  return `https://${v.replace(/^www\./, '')}`.replace(/\/+$/, '');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({
      status: 'error',
      message: 'Method not allowed. Use GET.',
      meta: { generatedAt: new Date().toISOString() },
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({
      status: 'error',
      message: 'Supabase not configured.',
      meta: { generatedAt: new Date().toISOString() },
    });
  }

  try {
    const propertyUrl = resolvePropertyUrl();

    // Prefer the most recent keyword_rankings snapshot (includes ranking-only
    // runs on partial audit dates — e.g. 98 keywords on 2026-05-31).
    const latestKrUrl = `${supabaseUrl}/rest/v1/keyword_rankings?property_url=eq.${encodeURIComponent(propertyUrl)}&select=audit_date&order=audit_date.desc&limit=1`;
    const latestKrResp = await fetch(latestKrUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    });

    let auditDate = null;
    if (latestKrResp.ok) {
      const latestKr = await latestKrResp.json();
      auditDate = latestKr[0]?.audit_date || null;
    }

    // Fallback: latest audit_results row (include partial ranking-only stubs)
    if (!auditDate) {
      const auditUrl = `${supabaseUrl}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(propertyUrl)}&order=audit_date.desc&limit=1&select=audit_date`;
      const auditResp = await fetch(auditUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      });
      if (auditResp.ok) {
        const auditRows = await auditResp.json();
        auditDate = auditRows[0]?.audit_date || null;
      }
    }

    if (!auditDate) {
      return res.status(200).json({
        status: 'ok',
        keywords: [],
        meta: { generatedAt: new Date().toISOString(), reason: 'no_audit_rows' },
      });
    }

    const keywordsUrl = `${supabaseUrl}/rest/v1/keyword_rankings?property_url=eq.${encodeURIComponent(propertyUrl)}&audit_date=eq.${auditDate}&select=keyword&order=keyword.asc`;
    const keywordsResp = await fetch(keywordsUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    });

    let keywords = [];
    if (keywordsResp.ok) {
      const keywordRows = await keywordsResp.json();
      if (Array.isArray(keywordRows)) {
        keywords = keywordRows
          .map(row => row?.keyword)
          .filter(kw => kw && typeof kw === 'string' && kw.trim().length > 0)
          .map(kw => kw.trim());
        keywords = [...new Set(keywords)].sort();
      }
    }

    return res.status(200).json({
      status: 'ok',
      keywords,
      auditDate,
      propertyUrl,
      meta: {
        generatedAt: new Date().toISOString(),
        debug: `Found ${keywords.length} keywords from keyword_rankings (audit_date: ${auditDate})`,
      },
    });
  } catch (e) {
    console.error('[Get Keywords] Error:', e);
    return res.status(500).json({
      status: 'error',
      message: e.message || 'Internal server error',
      meta: { generatedAt: new Date().toISOString() },
    });
  }
}

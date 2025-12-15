/**
 * Get current keyword list from latest audit_results
 * 
 * GET /api/keywords/get
 */

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
    const propertyUrl = process.env.NEXT_PUBLIC_SITE_DOMAIN || process.env.SITE_DOMAIN || 'alanranger.com';
    
    // Get latest audit_results
    const auditUrl = `${supabaseUrl}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(propertyUrl)}&order=audit_date.desc&limit=1&select=ranking_ai_data`;
    const auditResp = await fetch(auditUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    });

    if (!auditResp.ok) {
      return res.status(auditResp.status).json({
        status: 'error',
        message: 'Failed to fetch audit results',
        meta: { generatedAt: new Date().toISOString() },
      });
    }

    const auditRows = await auditResp.json();
    if (!Array.isArray(auditRows) || auditRows.length === 0) {
      return res.status(200).json({
        status: 'ok',
        keywords: [],
        meta: { generatedAt: new Date().toISOString() },
      });
    }

    const rankingAiData = auditRows[0]?.ranking_ai_data;
    if (!rankingAiData || !rankingAiData.combinedRows) {
      return res.status(200).json({
        status: 'ok',
        keywords: [],
        meta: { generatedAt: new Date().toISOString() },
      });
    }

    // Extract unique keywords from combinedRows
    const keywords = [...new Set(rankingAiData.combinedRows.map(row => row.keyword).filter(Boolean))].sort();

    return res.status(200).json({
      status: 'ok',
      keywords,
      meta: { generatedAt: new Date().toISOString() },
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


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
    
    // Get latest audit date first
    const auditUrl = `${supabaseUrl}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(propertyUrl)}&order=audit_date.desc&limit=1&select=audit_date`;
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
        meta: { generatedAt: new Date().toISOString(), reason: 'no_audit_rows', debug: 'No audit rows found in database' },
      });
    }

    const auditDate = auditRows[0]?.audit_date;
    
    // Fetch keywords from keyword_rankings table (more reliable than JSON blob)
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
        keywords = [...new Set(keywords)].sort(); // Remove duplicates and sort
      }
    }

    // Fallback: If no keywords in keyword_rankings, try ranking_ai_data JSON
    if (keywords.length === 0) {
      const auditDataUrl = `${supabaseUrl}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(propertyUrl)}&order=audit_date.desc&limit=1&select=ranking_ai_data`;
      const auditDataResp = await fetch(auditDataUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      });

      if (auditDataResp.ok) {
        const auditDataRows = await auditDataResp.json();
        const rankingAiData = auditDataRows[0]?.ranking_ai_data;
        
        if (rankingAiData?.combinedRows && Array.isArray(rankingAiData.combinedRows)) {
          const allKeywords = rankingAiData.combinedRows
            .map(row => row?.keyword)
            .filter(kw => kw && typeof kw === 'string' && kw.trim().length > 0)
            .map(kw => kw.trim());
          keywords = [...new Set(allKeywords)].sort();
        }
      }
    }
    
    return res.status(200).json({
      status: 'ok',
      keywords,
      meta: { 
        generatedAt: new Date().toISOString(),
        debug: `Found ${keywords.length} keywords from keyword_rankings table (audit_date: ${auditDate})`
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


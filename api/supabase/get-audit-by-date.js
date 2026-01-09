/**
 * Get Audit Results by Date from Supabase
 * 
 * Fetches audit data for a specific audit date.
 * Used for delta calculations (rolling 28-day comparisons).
 * Returns essential fields only to avoid FUNCTION_INVOCATION_FAILED errors.
 */

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({
      status: 'error',
      message: 'Method not allowed. Use GET.',
      meta: { generatedAt: new Date().toISOString() }
    });
  }

  try {
    const { propertyUrl, auditDate } = req.query;

    if (!propertyUrl || !auditDate) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required parameters: propertyUrl and auditDate',
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    // Get Supabase credentials from environment
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({
        status: 'error',
        message: 'Supabase not configured. Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.',
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    // Fetch audit record for specific date
    // Select essential fields only to avoid FUNCTION_INVOCATION_FAILED
    const selectFields = [
      'audit_date',
      'updated_at',
      'visibility_score',
      'authority_score',
      'content_schema_score',
      'local_entity_score',
      'service_area_score',
      'ai_summary_score',
      'gsc_clicks',
      'gsc_impressions',
      'gsc_avg_position',
      'gsc_ctr',
      'money_pages_metrics',
      'money_pages_summary',
      'ranking_ai_data',
      'ai_summary_components',
      'domain_strength',
      'eeat_score',
      'eeat_confidence',
      'eeat_subscores',
      'optimisation_potential_clicks'
    ].join(',');

    const queryUrl = `${supabaseUrl}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(propertyUrl)}&audit_date=eq.${encodeURIComponent(auditDate)}&select=${encodeURIComponent(selectFields)}&limit=1`;

    const response = await fetch(queryUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[get-audit-by-date] Supabase error:', errorText);
      return res.status(response.status).json({
        status: 'error',
        message: 'Failed to fetch audit from Supabase',
        details: errorText,
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    const results = await response.json();

    if (!results || results.length === 0) {
      return res.status(200).json({
        status: 'ok',
        data: null,
        message: `No audit found for ${auditDate}`,
        meta: { generatedAt: new Date().toISOString(), auditDate }
      });
    }

    const record = results[0];

    // Parse JSON fields if they're strings
    const parseJsonField = (field, defaultValue = null) => {
      if (!field) return defaultValue;
      if (typeof field === 'string') {
        try {
          return JSON.parse(field);
        } catch (e) {
          return defaultValue;
        }
      }
      return field;
    };

    // Reconstruct audit data structure matching what computeDashboardSnapshotFromAuditData expects
    const auditData = {
      auditDate: record.audit_date,
      scores: {
        visibility: record.visibility_score ?? null,
        authority: record.authority_score ?? null,
        contentSchema: record.content_schema_score ?? null,
        localEntity: record.local_entity_score ?? null,
        serviceArea: record.service_area_score ?? null,
        aiSummaryScore: record.ai_summary_score ?? null
      },
      searchData: {
        overview: {
          clicks: record.gsc_clicks || 0,
          impressions: record.gsc_impressions || 0,
          position: record.gsc_avg_position || null,
          ctr: record.gsc_ctr || 0
        }
      },
      moneyPagesMetrics: parseJsonField(record.money_pages_metrics) || (record.money_pages_summary ? {
        overview: parseJsonField(record.money_pages_summary)
      } : null),
      rankingAiData: {
        combinedRows: parseJsonField(record.ranking_ai_data)?.combinedRows || []
      },
      aiSummaryComponents: parseJsonField(record.ai_summary_components),
      domainStrength: parseJsonField(record.domain_strength),
      eeatScore: record.eeat_score ?? null,
      eeatConfidence: record.eeat_confidence ?? null,
      eeatSubscores: parseJsonField(record.eeat_subscores),
      optimisationPotentialClicks: record.optimisation_potential_clicks ?? null
    };

    return res.status(200).json({
      status: 'ok',
      data: auditData,
      meta: { generatedAt: new Date().toISOString(), auditDate: record.audit_date }
    });

  } catch (error) {
    console.error('[get-audit-by-date] Error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      details: error.message,
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}

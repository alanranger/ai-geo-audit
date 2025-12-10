/**
 * Get Latest Audit Results from Supabase
 * 
 * Fetches the most recent audit for a property URL with all stored data.
 * Used to restore dashboard state after page refresh when localStorage is cleared.
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
    const { propertyUrl } = req.query;

    if (!propertyUrl) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required parameter: propertyUrl',
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

    // Fetch the most recent audit (order by audit_date desc, limit 1)
    // Include all fields needed to reconstruct the audit object
    // Using select=* to get all columns including money_pages_metrics, money_pages_summary, money_pages_behaviour_score, money_segment_metrics
    const queryUrl = `${supabaseUrl}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(propertyUrl)}&order=audit_date.desc&limit=1&select=*`;
    
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
      console.error('Supabase error:', errorText);
      return res.status(response.status).json({
        status: 'error',
        message: 'Failed to fetch latest audit from Supabase',
        details: errorText,
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    const results = await response.json();

    if (!results || results.length === 0) {
      return res.status(200).json({
        status: 'ok',
        data: null,
        message: 'No audit found for this property URL',
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    const record = results[0];

    // Reconstruct the full audit object from Supabase data
    const auditData = {
      scores: {
        visibility: record.visibility_score || null,
        contentSchema: record.content_schema_score || null,
        authority: record.authority_by_segment ? {
          score: record.authority_score || null,
          bySegment: record.authority_by_segment || null
        } : (record.authority_score || null),
        localEntity: record.local_entity_score || null,
        serviceArea: record.service_area_score || null,
        brandOverlay: record.brand_overlay || null,
        moneyPagesMetrics: record.money_pages_metrics || null,
        authorityComponents: {
          behaviour: record.authority_behaviour_score || null,
          ranking: record.authority_ranking_score || null,
          backlinks: record.authority_backlink_score || null,
          reviews: record.authority_review_score || null
        }
      },
      searchData: {
        totalClicks: record.gsc_clicks || 0,
        totalImpressions: record.gsc_impressions || 0,
        averagePosition: record.gsc_avg_position || null,
        ctr: record.gsc_ctr || 0,
        overview: {
          clicks: record.gsc_clicks || 0,
          impressions: record.gsc_impressions || 0,
          ctr: record.gsc_ctr || 0,
          position: record.gsc_avg_position || null,
          // Add siteTotalImpressions and siteTotalClicks for buildMoneyPagesSummary
          siteTotalImpressions: record.gsc_impressions || 0,
          siteTotalClicks: record.gsc_clicks || 0,
          totalImpressions: record.gsc_impressions || 0,
          totalClicks: record.gsc_clicks || 0
        }
      },
      snippetReadiness: record.snippet_readiness || 0,
      schemaAudit: record.content_schema_score !== null ? {
        status: 'ok',
        data: {
          coverage: record.schema_coverage || record.content_schema_score,
          totalPages: record.schema_total_pages || 0,
          pagesWithSchema: record.schema_pages_with_schema || 0,
          schemaTypes: record.schema_types || [],
          foundation: record.schema_foundation || {},
          richEligible: record.schema_rich_eligible || {},
          missingTypes: record.schema_types ? [] : ['Organization', 'Person', 'WebSite', 'BreadcrumbList'],
          missingSchemaPages: record.schema_missing_pages || []
        }
      } : null,
      localSignals: (record.local_entity_score !== null || record.service_area_score !== null) ? {
        data: {
          localEntityScore: record.local_entity_score,
          serviceAreaScore: record.service_area_score,
          napConsistencyScore: record.nap_consistency_score,
          knowledgePanelDetected: record.knowledge_panel_detected,
          serviceAreas: record.service_areas || [],
          localBusinessSchemaPages: record.local_business_schema_pages || 0
        }
      } : null,
      dateRange: 30, // Default - this isn't stored in Supabase
      timestamp: new Date(record.audit_date + 'T00:00:00').getTime(),
      auditDate: record.audit_date,
      // Money Pages Priority Matrix data - restore from Supabase if available
      moneyPagePriorityData: record.money_page_priority_data || null, // Restore from Supabase, or rebuild if missing
      moneySegmentMetrics: record.money_segment_metrics || null,
      rankingAiData: record.ranking_ai_data || null // Ranking & AI data (SERP rankings + AI Overview citations)
    };

    return res.status(200).json({
      status: 'ok',
      data: auditData,
      meta: { 
        generatedAt: new Date().toISOString(),
        auditDate: record.audit_date
      }
    });

  } catch (error) {
    console.error('Error fetching latest audit:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      details: error.message,
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}


/**
 * Save Audit Results to Supabase
 * 
 * Stores schema audit results and pillar scores for historical tracking.
 * This enables Content/Schema pillar to show real trends over time.
 */

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({
      status: 'error',
      message: 'Method not allowed. Use POST.',
      meta: { generatedAt: new Date().toISOString() }
    });
  }

  try {
    const {
      propertyUrl,
      auditDate,
      schemaAudit,
      scores,
      searchData,
      snippetReadiness,
      localSignals
    } = req.body;

    if (!propertyUrl || !auditDate) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required fields: propertyUrl, auditDate',
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

    // Extract schema audit data
    const schemaData = schemaAudit?.data || {};
    const schemaTypes = schemaData.schemaTypes || [];
    
    // Extract foundation schemas
    const foundationTypes = ['Organization', 'Person', 'WebSite', 'BreadcrumbList'];
    const foundationSchemas = {};
    foundationTypes.forEach(type => {
      foundationSchemas[type] = !schemaData.missingTypes?.includes(type);
    });

    // Prepare data for Supabase
    const auditRecord = {
      property_url: propertyUrl,
      audit_date: auditDate, // Format: YYYY-MM-DD
      
      // Schema Audit Data
      schema_total_pages: schemaData.totalPages || 0,
      schema_pages_with_schema: schemaData.pagesWithSchema || 0,
      schema_coverage: schemaData.coverage || 0,
      schema_types: schemaTypes.map(st => typeof st === 'string' ? st : st.type).filter(Boolean),
      schema_foundation: foundationSchemas,
      schema_rich_eligible: schemaData.richEligible || {},
      schema_missing_pages: (schemaData.missingSchemaPages || []).map(p => p.url),
      
      // Pillar Scores
      visibility_score: scores?.visibility || null,
      authority_score: scores?.authority || null,
      local_entity_score: scores?.localEntity || null,
      service_area_score: scores?.serviceArea || null,
      content_schema_score: scores?.contentSchema || null,
      snippet_readiness: snippetReadiness || null,
      
      // Authority Component Scores (for historical tracking and debugging)
      authority_behaviour_score: scores?.authorityComponents?.behaviour || null,
      authority_ranking_score: scores?.authorityComponents?.ranking || null,
      authority_backlink_score: scores?.authorityComponents?.backlinks || null,
      authority_review_score: scores?.authorityComponents?.reviews || null,
      
      // GSC Data (for reference)
      gsc_clicks: searchData?.totalClicks || null,
      gsc_impressions: searchData?.totalImpressions || null,
      gsc_avg_position: searchData?.averagePosition || null,
      gsc_ctr: searchData?.ctr || null,
      
      // Business Profile Data (for historical tracking)
      local_business_schema_pages: localSignals?.data?.localBusinessSchemaPages || null,
      nap_consistency_score: localSignals?.data?.napConsistencyScore || null,
      knowledge_panel_detected: localSignals?.data?.knowledgePanelDetected || null,
      service_areas: localSignals?.data?.serviceAreas || null, // Array of service area objects
      
      updated_at: new Date().toISOString()
    };

    // Insert or update (upsert) using Supabase REST API
    // Try POST first with upsert header, if 409 conflict then PATCH
    let response = await fetch(`${supabaseUrl}/rest/v1/audit_results`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'resolution=merge-duplicates,return=representation'
      },
      body: JSON.stringify(auditRecord)
    });
    
    // If 409 conflict (unique constraint violation), use PATCH to update existing record
    if (response.status === 409) {
      console.log('[Supabase Save] Record exists, updating with PATCH...');
      response = await fetch(`${supabaseUrl}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(propertyUrl)}&audit_date=eq.${auditDate}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(auditRecord)
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Supabase Save] Error response:', response.status, errorText);
      console.error('[Supabase Save] Request data:', JSON.stringify(auditRecord, null, 2).substring(0, 500));
      return res.status(response.status).json({
        status: 'error',
        message: 'Failed to save audit results to Supabase',
        details: errorText,
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    const result = await response.json();
    console.log('[Supabase Save] ✓ Successfully saved audit results');

    return res.status(200).json({
      status: 'ok',
      message: 'Audit results saved successfully',
      data: result,
      meta: { generatedAt: new Date().toISOString() }
    });

  } catch (error) {
    console.error('[Supabase Save] Exception:', error.message);
    console.error('[Supabase Save] Stack:', error.stack);
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      details: error.message,
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}


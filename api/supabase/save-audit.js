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
      // Authority score: extract numeric score from object structure if needed
      authority_score: (typeof scores?.authority === 'object' && scores?.authority !== null) 
        ? scores.authority.score 
        : (scores?.authority || null),
      local_entity_score: scores?.localEntity || null,
      service_area_score: scores?.serviceArea || null,
      content_schema_score: scores?.contentSchema || null,
      snippet_readiness: snippetReadiness || null,
      
      // Phase 1: Brand Overlay and AI Summary (stored as JSON)
      brand_overlay: scores?.brandOverlay || null, // JSON object with score, label, metrics, notes
      brand_score: scores?.brandOverlay?.score || null, // For trend charting
      
      // Calculate AI Summary Likelihood (Phase 1)
      // Uses snippetReadiness, visibility, and brand score
      ai_summary: (() => {
        if (!snippetReadiness || !scores) return null;
        const snippetReadinessScore = snippetReadiness.overallScore || 0;
        const visibilityScore = scores.visibility || 0;
        const brandScore = scores.brandOverlay?.score || 0;
        
        if (snippetReadinessScore === 0 && brandScore === 0) return null;
        
        const composite = 0.5 * snippetReadinessScore + 0.3 * visibilityScore + 0.2 * brandScore;
        let label;
        if (composite < 60) label = 'Low';
        else if (composite < 80) label = 'Medium';
        else label = 'High';
        
        const reasons = [];
        if (snippetReadinessScore < 70)
          reasons.push('Improve FAQ/HowTo/Article blocks and schema to raise snippet readiness.');
        if (visibilityScore < 70)
          reasons.push('Improve average position and top-10 impression share.');
        if (brandScore < 70)
          reasons.push('Strengthen branded search and entity signals.');
        
        return {
          score: Math.round(composite),
          label,
          reasons
        };
      })(),
      ai_summary_score: (() => {
        if (!snippetReadiness || !scores) return null;
        const snippetReadinessScore = snippetReadiness.overallScore || 0;
        const visibilityScore = scores.visibility || 0;
        const brandScore = scores.brandOverlay?.score || 0;
        if (snippetReadinessScore === 0 && brandScore === 0) return null;
        return Math.round(0.5 * snippetReadinessScore + 0.3 * visibilityScore + 0.2 * brandScore);
      })()
      
      // Authority Component Scores (for historical tracking and debugging)
      authority_behaviour_score: scores?.authorityComponents?.behaviour || null,
      authority_ranking_score: scores?.authorityComponents?.ranking || null,
      authority_backlink_score: scores?.authorityComponents?.backlinks || null,
      authority_review_score: scores?.authorityComponents?.reviews || null,
      
      // Segmented Authority Scores (for building historical segmented data)
      authority_by_segment: scores?.authority?.bySegment || null, // JSON object with {all, nonEducation, money}
      
      // Debug: Log authority_by_segment structure for verification
      // (This will be stored as JSON in Supabase)
      
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

    // Debug: Log authority_by_segment structure for verification
    if (auditRecord.authority_by_segment) {
      const segKeys = Object.keys(auditRecord.authority_by_segment);
      console.log('[Supabase Save] ✓ authority_by_segment contains segments:', segKeys);
      if (auditRecord.authority_by_segment.all) {
        const allKeys = Object.keys(auditRecord.authority_by_segment.all);
        console.log('[Supabase Save] ✓ "all" segment contains:', allKeys);
      }
      if (auditRecord.authority_by_segment.nonEducation) {
        const nonEduKeys = Object.keys(auditRecord.authority_by_segment.nonEducation);
        console.log('[Supabase Save] ✓ "nonEducation" segment contains:', nonEduKeys);
      }
      if (auditRecord.authority_by_segment.money) {
        const moneyKeys = Object.keys(auditRecord.authority_by_segment.money);
        console.log('[Supabase Save] ✓ "money" segment contains:', moneyKeys);
      }
    } else {
      console.log('[Supabase Save] ⚠ authority_by_segment is null or missing');
    }

    // Insert or update (upsert) using Supabase REST API
    // Strategy: Try to UPDATE first (PATCH), if no rows affected, then INSERT
    // This ensures only ONE record per (property_url, audit_date) combination
    // The UNIQUE constraint on (property_url, audit_date) prevents duplicates
    
    // First, try to update existing record
    const updateResponse = await fetch(`${supabaseUrl}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(propertyUrl)}&audit_date=eq.${auditDate}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(auditRecord)
    });
    
    let response = updateResponse;
    let isUpdate = false;
    
    if (updateResponse.ok) {
      const updateResult = await updateResponse.json();
      // Check if any rows were actually updated
      if (Array.isArray(updateResult) && updateResult.length > 0) {
        console.log('[Supabase Save] ✓ Updated existing audit record for', auditDate);
        isUpdate = true;
      } else {
        // No existing record found, need to INSERT
        console.log('[Supabase Save] No existing record found, inserting new record...');
        response = await fetch(`${supabaseUrl}/rest/v1/audit_results`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Prefer': 'return=representation'
          },
          body: JSON.stringify(auditRecord)
        });
      }
    } else if (updateResponse.status === 404 || updateResponse.status === 400) {
      // Record doesn't exist, insert new one
      console.log('[Supabase Save] Record not found, inserting new record...');
      response = await fetch(`${supabaseUrl}/rest/v1/audit_results`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(auditRecord)
      });
    } else {
      // Some other error from PATCH, use it as the response
      response = updateResponse;
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
    if (isUpdate) {
      console.log('[Supabase Save] ✓ Successfully updated audit results (overwrote existing record)');
    } else {
      console.log('[Supabase Save] ✓ Successfully inserted new audit results');
    }

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


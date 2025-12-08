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

    // Validate and prepare data for Supabase
    // Ensure numeric fields are numbers, not strings
    const ensureNumber = (val) => {
      if (val === null || val === undefined) return null;
      const num = typeof val === 'number' ? val : parseFloat(val);
      return isNaN(num) ? null : num;
    };
    
    // Ensure JSON fields are objects or null (not undefined)
    const ensureJson = (val) => {
      if (val === null || val === undefined) return null;
      if (typeof val === 'object') return val;
      try {
        return typeof val === 'string' ? JSON.parse(val) : null;
      } catch {
        return null;
      }
    };
    
    // Prepare data for Supabase
    const auditRecord = {
      property_url: String(propertyUrl).trim(),
      audit_date: String(auditDate).trim(), // Format: YYYY-MM-DD
      
      // Schema Audit Data
      schema_total_pages: ensureNumber(schemaData.totalPages) ?? 0,
      schema_pages_with_schema: ensureNumber(schemaData.pagesWithSchema) ?? 0,
      schema_coverage: ensureNumber(schemaData.coverage) ?? 0,
      schema_types: Array.isArray(schemaTypes) 
        ? schemaTypes.map(st => typeof st === 'string' ? st : st.type).filter(Boolean)
        : [],
      schema_foundation: ensureJson(foundationSchemas) ?? {},
      schema_rich_eligible: ensureJson(schemaData.richEligible) ?? {},
      schema_missing_pages: Array.isArray(schemaData.missingSchemaPages)
        ? schemaData.missingSchemaPages.map(p => (typeof p === 'string' ? p : p.url)).filter(Boolean)
        : [],
      
      // Pillar Scores
      visibility_score: ensureNumber(scores?.visibility),
      // Authority score: extract numeric score from object structure if needed
      authority_score: ensureNumber(
        (typeof scores?.authority === 'object' && scores?.authority !== null) 
          ? scores.authority.score 
          : scores?.authority
      ),
      local_entity_score: ensureNumber(scores?.localEntity),
      service_area_score: ensureNumber(scores?.serviceArea),
      content_schema_score: ensureNumber(scores?.contentSchema),
      snippet_readiness: ensureNumber(
        typeof snippetReadiness === 'number' 
          ? snippetReadiness 
          : (snippetReadiness?.overallScore || null)
      ),
      
      // Phase 1: Brand Overlay and AI Summary (stored as JSON)
      brand_overlay: ensureJson(scores?.brandOverlay), // JSON object with score, label, metrics, notes
      brand_score: ensureNumber(scores?.brandOverlay?.score), // For trend charting
      
      // Money Pages Performance (Phase 1 - stored as JSON)
      money_pages_metrics: ensureJson(scores?.moneyPagesMetrics), // JSON object: {overview: {...}, rows: [...]}
      
      // Calculate AI Summary Likelihood (Phase 1)
      // Uses snippetReadiness, visibility, and brand score
      ai_summary: (() => {
        if (!snippetReadiness || !scores) return null;
        // Handle both number and object formats for snippetReadiness
        const snippetReadinessScore = typeof snippetReadiness === 'number' 
          ? snippetReadiness 
          : (snippetReadiness.overallScore || 0);
        const visibilityScore = scores.visibility || 0;
        const brandScore = scores.brandOverlay?.score || 0;
        
        if (snippetReadinessScore === 0 && brandScore === 0) return null;
        
        const composite = 0.5 * snippetReadinessScore + 0.3 * visibilityScore + 0.2 * brandScore;
        let label;
        // Use same RAG bands as AI GEO: <50 red, 50-69 amber, >=70 green
        if (composite < 50) label = 'Low';
        else if (composite < 70) label = 'Medium';
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
        // Handle both number and object formats for snippetReadiness
        const snippetReadinessScore = typeof snippetReadiness === 'number' 
          ? snippetReadiness 
          : (snippetReadiness.overallScore || 0);
        const visibilityScore = scores.visibility || 0;
        const brandScore = scores.brandOverlay?.score || 0;
        if (snippetReadinessScore === 0 && brandScore === 0) return null;
        return Math.round(0.5 * snippetReadinessScore + 0.3 * visibilityScore + 0.2 * brandScore);
      })(),
      
      // Authority Component Scores (for historical tracking and debugging)
      authority_behaviour_score: ensureNumber(scores?.authorityComponents?.behaviour),
      authority_ranking_score: ensureNumber(scores?.authorityComponents?.ranking),
      authority_backlink_score: ensureNumber(scores?.authorityComponents?.backlinks),
      authority_review_score: ensureNumber(scores?.authorityComponents?.reviews),
      
      // Segmented Authority Scores (for building historical segmented data)
      authority_by_segment: ensureJson(scores?.authority?.bySegment), // JSON object with {all, nonEducation, money}
      
      // Debug: Log authority_by_segment structure for verification
      // (This will be stored as JSON in Supabase)
      
      // GSC Data (for reference)
      gsc_clicks: ensureNumber(searchData?.totalClicks),
      gsc_impressions: ensureNumber(searchData?.totalImpressions),
      gsc_avg_position: ensureNumber(searchData?.averagePosition),
      gsc_ctr: ensureNumber(searchData?.ctr),
      
      // Business Profile Data (for historical tracking)
      local_business_schema_pages: ensureNumber(localSignals?.data?.localBusinessSchemaPages),
      nap_consistency_score: ensureNumber(localSignals?.data?.napConsistencyScore),
      knowledge_panel_detected: localSignals?.data?.knowledgePanelDetected === true ? true : (localSignals?.data?.knowledgePanelDetected === false ? false : null),
      service_areas: Array.isArray(localSignals?.data?.serviceAreas) ? localSignals.data.serviceAreas : null, // Array of service area objects
      
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
      console.error('[Supabase Save] Error response status:', response.status);
      console.error('[Supabase Save] Error response text:', errorText);
      console.error('[Supabase Save] Request data (first 1000 chars):', JSON.stringify(auditRecord, null, 2).substring(0, 1000));
      
      // Try to parse error for better details
      let errorDetails = errorText;
      try {
        const errorJson = JSON.parse(errorText);
        errorDetails = JSON.stringify(errorJson, null, 2);
        console.error('[Supabase Save] Parsed error:', errorDetails);
      } catch (e) {
        // Not JSON, use as-is
      }
      
      return res.status(response.status).json({
        status: 'error',
        message: 'Failed to save audit results to Supabase',
        details: errorDetails,
        statusCode: response.status,
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


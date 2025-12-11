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
    // In Vercel serverless functions, req.body should be automatically parsed for JSON
    // Access it once and immediately extract all needed data to avoid "body already read" errors
    let bodyData;
    
    try {
      // Access req.body once - Vercel should have already parsed it if Content-Type is application/json
      bodyData = req.body;
      
      // If body is undefined or null, the request might not have a body
      if (bodyData === undefined || bodyData === null) {
        return res.status(400).json({
          status: 'error',
          message: 'Request body is missing',
          meta: { generatedAt: new Date().toISOString() }
        });
      }
      
      // If body is a string, try to parse it (shouldn't happen in Vercel, but safety check)
      if (typeof bodyData === 'string') {
        try {
          bodyData = JSON.parse(bodyData);
        } catch (parseError) {
          return res.status(400).json({
            status: 'error',
            message: 'Invalid JSON in request body',
            details: parseError.message,
            meta: { generatedAt: new Date().toISOString() }
          });
        }
      }
      
      // Validate body is an object (not array, not null)
      if (typeof bodyData !== 'object' || Array.isArray(bodyData) || bodyData === null) {
        return res.status(400).json({
          status: 'error',
          message: 'Request body must be a JSON object',
          meta: { generatedAt: new Date().toISOString() }
        });
      }
    } catch (bodyError) {
      // If we can't read the body, it might have already been consumed
      console.error('[Supabase Save] Error reading request body:', bodyError.message);
      return res.status(400).json({
        status: 'error',
        message: 'Could not read request body',
        details: bodyError.message,
        meta: { generatedAt: new Date().toISOString() }
      });
    }
    
    // Extract all needed data in one go - don't access bodyData again after this
    const {
      propertyUrl,
      auditDate,
      schemaAudit,
      scores,
      searchData,
      snippetReadiness,
      localSignals,
      moneyPagesSummary, // Phase 3: Money Pages summary for trend tracking
      moneySegmentMetrics, // Phase: Money Pages Priority Matrix - segment metrics for KPI tracker
      moneyPagePriorityData, // CRITICAL: Money Pages Priority Matrix data for Priority & Actions table
      rankingAiData // Ranking & AI data (SERP rankings + AI Overview citations)
    } = bodyData;

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
    
    // Debug: Log schema data structure to understand what's available
    console.log('[Save Audit] Schema data keys:', Object.keys(schemaData));
    console.log('[Save Audit] schemaData.pages type:', Array.isArray(schemaData.pages) ? 'array' : typeof schemaData.pages);
    console.log('[Save Audit] schemaData.pagesWithSchema type:', Array.isArray(schemaData.pagesWithSchema) ? 'array' : typeof schemaData.pagesWithSchema);
    if (Array.isArray(schemaData.pages) && schemaData.pages.length > 0) {
      console.log('[Save Audit] schemaData.pages sample:', JSON.stringify(schemaData.pages[0]));
    }
    
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
      // Detailed schema pages data (for scorecard)
      // Try schemaData.pages first (detailed array), then pagesWithSchema if it's an array
      schema_pages_detail: (() => {
        // First try: schemaData.pages (detailed array from schema audit)
        if (Array.isArray(schemaData.pages) && schemaData.pages.length > 0) {
          return schemaData.pages.map(p => ({
            url: p.url || '',
            schemaTypes: Array.isArray(p.schemaTypes) ? p.schemaTypes : (p.schemaTypes ? [p.schemaTypes] : [])
          })).filter(p => p.url);
        }
        // Second try: pagesWithSchema if it's an array
        if (Array.isArray(schemaData.pagesWithSchema) && schemaData.pagesWithSchema.length > 0) {
          return schemaData.pagesWithSchema.map(p => ({
            url: typeof p === 'string' ? p : (p.url || ''),
            schemaTypes: Array.isArray(p.schemaTypes) ? p.schemaTypes : (p.schemaTypes ? [p.schemaTypes] : [])
          })).filter(p => p.url);
        }
        return null;
      })(),
      
      // GSC query+page level data (for CTR metrics in scorecard)
      query_pages: Array.isArray(searchData?.queryPages) && searchData.queryPages.length > 0
        ? searchData.queryPages.map(qp => ({
            query: qp.query || '',
            page: qp.page || qp.url || '',
            clicks: qp.clicks || 0,
            impressions: qp.impressions || 0,
            ctr: qp.ctr || 0, // Store as percentage (0-100)
            position: qp.position || qp.avg_position || null
          })).filter(qp => qp.query || qp.page)
        : null,
      
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
      
      // Phase 3: Money Pages Summary (compact summary for trend tracking)
      money_pages_summary: ensureJson(moneyPagesSummary), // JSON object: {count, impressions, clicks, ctr, avgPosition, shareOfImpressions, shareOfClicks, behaviourScore}
      money_pages_behaviour_score: ensureNumber(
        moneyPagesSummary && typeof moneyPagesSummary.behaviourScore === 'number'
          ? moneyPagesSummary.behaviourScore
          : null
      ), // For trend charting
      
      // Phase: Money Pages Priority Matrix - segment metrics for 12-month KPI tracker
      money_segment_metrics: ensureJson(moneySegmentMetrics), // JSON object: {allMoney, landingPages, eventPages, productPages} each with {clicks, impressions, ctr, avgPosition, behaviourScore}
      
      // CRITICAL: Money Pages Priority Matrix data for Priority & Actions table
      money_page_priority_data: ensureJson(moneyPagePriorityData), // JSON array: [{url, title, segmentType, clicks, impressions, ctr, avgPosition, impactLevel, difficultyLevel, priorityLevel}, ...]
      
      // Ranking & AI data (SERP rankings + AI Overview citations)
      ranking_ai_data: ensureJson(rankingAiData), // JSON object: {combinedRows: [...], summary: {...}}
      
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
      let updateResult;
      try {
        // Read response body once
        const responseText = await updateResponse.text();
        updateResult = responseText ? JSON.parse(responseText) : [];
      } catch (parseError) {
        console.error('[Supabase Save] Error parsing update response:', parseError.message);
        updateResult = [];
      }
      
      // Check if any rows were actually updated
      if (Array.isArray(updateResult) && updateResult.length > 0) {
        console.log('[Supabase Save] ✓ Updated existing audit record for', auditDate);
        isUpdate = true;
        // Use the update result as the final result
        const finalResult = updateResult;
        return res.status(200).json({
          status: 'ok',
          message: 'Audit results saved successfully',
          data: finalResult,
          meta: { generatedAt: new Date().toISOString() }
        });
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
      // Some other error from PATCH, read the error response
      let errorText = '';
      try {
        errorText = await updateResponse.text();
      } catch (e) {
        errorText = `HTTP ${updateResponse.status}: ${updateResponse.statusText}`;
      }
      
      console.error('[Supabase Save] Update failed with status:', updateResponse.status);
      console.error('[Supabase Save] Error response:', errorText);
      
      return res.status(updateResponse.status).json({
        status: 'error',
        message: 'Failed to update audit results in Supabase',
        details: errorText,
        statusCode: updateResponse.status,
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    if (!response.ok) {
      let errorText = '';
      try {
        errorText = await response.text();
      } catch (e) {
        errorText = `HTTP ${response.status}: ${response.statusText}`;
      }
      
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

    // Read response body once
    let result;
    try {
      const responseText = await response.text();
      result = responseText ? JSON.parse(responseText) : null;
    } catch (parseError) {
      console.error('[Supabase Save] Error parsing response:', parseError.message);
      return res.status(500).json({
        status: 'error',
        message: 'Failed to parse Supabase response',
        details: parseError.message,
        meta: { generatedAt: new Date().toISOString() }
      });
    }
    if (isUpdate) {
      console.log('[Supabase Save] ✓ Successfully updated audit results (overwrote existing record)');
    } else {
      console.log('[Supabase Save] ✓ Successfully inserted new audit results');
    }

    // Save individual keyword rows to keyword_rankings table if rankingAiData is provided
    if (rankingAiData && rankingAiData.combinedRows && Array.isArray(rankingAiData.combinedRows)) {
      try {
        console.log(`[Supabase Save] ✓ rankingAiData.combinedRows found: ${rankingAiData.combinedRows.length} rows`);
        console.log(`[Supabase Save] Saving ${rankingAiData.combinedRows.length} keyword rows to keyword_rankings table...`);
        
        // Prepare keyword rows for insertion
        const keywordRows = rankingAiData.combinedRows.map(row => ({
          audit_date: auditDate,
          property_url: String(propertyUrl).trim(),
          keyword: String(row.keyword || '').trim(),
          best_rank_group: row.best_rank_group !== null && row.best_rank_group !== undefined ? parseInt(row.best_rank_group) : null,
          best_rank_absolute: row.best_rank_absolute !== null && row.best_rank_absolute !== undefined ? parseInt(row.best_rank_absolute) : null,
          best_url: row.best_url ? String(row.best_url).trim() : null,
          best_title: row.best_title ? String(row.best_title).trim() : null,
          search_volume: row.search_volume !== null && row.search_volume !== undefined ? parseInt(row.search_volume) : null,
          has_ai_overview: row.has_ai_overview === true,
          ai_total_citations: row.ai_total_citations !== null && row.ai_total_citations !== undefined ? parseInt(row.ai_total_citations) : null,
          ai_alan_citations_count: row.ai_alan_citations_count !== null && row.ai_alan_citations_count !== undefined ? parseInt(row.ai_alan_citations_count) : null,
          ai_alan_citations: row.ai_alan_citations ? (Array.isArray(row.ai_alan_citations) ? row.ai_alan_citations : []) : null,
          competitor_counts: row.competitor_counts ? (typeof row.competitor_counts === 'object' ? row.competitor_counts : {}) : null,
          serp_features: row.serp_features ? (typeof row.serp_features === 'object' ? row.serp_features : {}) : null,
          // New boolean fields for SERP feature coverage
          ai_overview_present_any: row.ai_overview_present_any === true || row.has_ai_overview === true,
          local_pack_present_any: row.local_pack_present_any === true || (row.serp_features && row.serp_features.local_pack === true),
          paa_present_any: row.paa_present_any === true || (row.serp_features && row.serp_features.people_also_ask === true),
          featured_snippet_present_any: row.featured_snippet_present_any === true || (row.serp_features && row.serp_features.featured_snippet === true),
          segment: row.segment ? String(row.segment).trim() : null,
          page_type: row.pageType ? String(row.pageType).trim() : null,
          demand_share: row.demand_share !== null && row.demand_share !== undefined ? parseFloat(row.demand_share) : null,
          updated_at: new Date().toISOString()
        }));

        // Delete existing rows for this audit_date and property_url to avoid duplicates
        const deleteResponse = await fetch(`${supabaseUrl}/rest/v1/keyword_rankings?audit_date=eq.${auditDate}&property_url=eq.${encodeURIComponent(propertyUrl)}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Prefer': 'return=representation'
          }
        });

        if (deleteResponse.ok) {
          const deletedText = await deleteResponse.text();
          const deletedCount = deletedText ? JSON.parse(deletedText).length : 0;
          console.log(`[Supabase Save] Deleted ${deletedCount} existing keyword rows for ${auditDate}`);
        }

        // Insert new rows (upsert using unique constraint on audit_date, property_url, keyword)
        const insertResponse = await fetch(`${supabaseUrl}/rest/v1/keyword_rankings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Prefer': 'return=representation,resolution=merge-duplicates'
          },
          body: JSON.stringify(keywordRows)
        });

        if (insertResponse.ok) {
          const insertedText = await insertResponse.text();
          const insertedResult = insertedText ? JSON.parse(insertedText) : [];
          console.log(`[Supabase Save] ✓ Successfully saved ${insertedResult.length} keyword rows to keyword_rankings table`);
          if (insertedResult.length !== keywordRows.length) {
            console.warn(`[Supabase Save] ⚠ WARNING: Attempted to save ${keywordRows.length} rows but only ${insertedResult.length} were inserted`);
          }
        } else {
          const errorText = await insertResponse.text();
          console.error(`[Supabase Save] ⚠ Failed to save keyword rows: ${insertResponse.status} - ${errorText}`);
          console.error(`[Supabase Save] ⚠ First 3 keyword rows for debugging:`, JSON.stringify(keywordRows.slice(0, 3), null, 2));
          // Don't fail the entire request if keyword rows fail to save
        }
      } catch (keywordErr) {
        console.error('[Supabase Save] ✗ Error saving keyword rows:', keywordErr.message);
        console.error('[Supabase Save] ✗ Stack trace:', keywordErr.stack);
        // Don't fail the entire request if keyword rows fail to save
      }
    } else {
      console.log(`[Supabase Save] ⚠ No rankingAiData.combinedRows found. rankingAiData exists: ${!!rankingAiData}, combinedRows exists: ${!!(rankingAiData && rankingAiData.combinedRows)}, isArray: ${Array.isArray(rankingAiData?.combinedRows)}`);
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


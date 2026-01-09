/**
 * Save Audit Results to Supabase
 * 
 * Stores schema audit results and pillar scores for historical tracking.
 * This enables Content/Schema pillar to show real trends over time.
 */

import { enqueuePending, normalizeDomain } from '../../lib/domainStrength/domains.js';

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
    // Check request size before processing (Vercel limit is ~4.5MB)
    const contentLength = req.headers['content-length'];
    if (contentLength && parseInt(contentLength) > 4 * 1024 * 1024) {
      console.warn(`[Supabase Save] ⚠ Request too large: ${Math.round(parseInt(contentLength) / 1024)}KB (limit: 4MB)`);
      return res.status(413).json({
        status: 'error',
        message: 'Request payload too large',
        details: `Payload size: ${Math.round(parseInt(contentLength) / 1024)}KB, limit: 4MB. Consider reducing query_pages or other large data fields.`,
        meta: { generatedAt: new Date().toISOString() }
      });
    }
    
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
      // Detailed schema pages data (for scorecard) - SAVE ALL FIELDS from schema audit
      // Try schemaData.pages first (detailed array), then pagesWithSchema if it's an array
      schema_pages_detail: (() => {
        // First try: schemaData.pages (detailed array from schema audit)
        if (Array.isArray(schemaData.pages) && schemaData.pages.length > 0) {
          console.log('[Save Audit] Using schemaData.pages array:', schemaData.pages.length, 'pages');
          return schemaData.pages.map(p => ({
            url: p.url || '',
            title: p.title || null,
            metaDescription: p.metaDescription || null,
            hasSchema: p.hasSchema === true,
            hasInheritedSchema: p.hasInheritedSchema === true,
            schemaTypes: Array.isArray(p.schemaTypes) ? p.schemaTypes : (p.schemaTypes ? [p.schemaTypes] : []),
            error: p.error || null,
            errorType: p.errorType || null
          })).filter(p => p.url);
        }
        // Second try: pagesWithSchema if it's an array
        if (Array.isArray(schemaData.pagesWithSchema) && schemaData.pagesWithSchema.length > 0) {
          console.log('[Save Audit] Using schemaData.pagesWithSchema array:', schemaData.pagesWithSchema.length, 'pages');
          return schemaData.pagesWithSchema.map(p => ({
            url: typeof p === 'string' ? p : (p.url || ''),
            title: (typeof p === 'object' && p !== null) ? (p.title || null) : null,
            metaDescription: (typeof p === 'object' && p !== null) ? (p.metaDescription || null) : null,
            hasSchema: (typeof p === 'object' && p !== null) ? (p.hasSchema === true) : false,
            hasInheritedSchema: (typeof p === 'object' && p !== null) ? (p.hasInheritedSchema === true) : false,
            schemaTypes: Array.isArray(p.schemaTypes) ? p.schemaTypes : ((typeof p === 'object' && p !== null && p.schemaTypes) ? [p.schemaTypes] : []),
            error: (typeof p === 'object' && p !== null) ? (p.error || null) : null,
            errorType: (typeof p === 'object' && p !== null) ? (p.errorType || null) : null
          })).filter(p => p.url);
        }
        console.warn('[Save Audit] schema_pages_detail is missing - schema coverage will not be available in scorecard');
        return null;
      })(),
      
      // GSC query+page level data (for CTR metrics in scorecard)
      // Limit to 5000 items to prevent payload size issues (Vercel limit is ~4.5MB)
      query_pages: (() => {
        const qp = searchData?.queryPages;
        console.log('[Save Audit] queryPages check:', {
          exists: !!qp,
          isArray: Array.isArray(qp),
          length: Array.isArray(qp) ? qp.length : 'N/A',
          type: typeof qp,
          sample: Array.isArray(qp) && qp.length > 0 ? qp[0] : null
        });
        if (Array.isArray(qp) && qp.length > 0) {
          const mapped = qp.map(qpItem => ({
            query: qpItem.query || '',
            page: qpItem.page || qpItem.url || '',
            clicks: qpItem.clicks || 0,
            impressions: qpItem.impressions || 0,
            ctr: qpItem.ctr || 0, // Store as percentage (0-100)
            position: qpItem.position || qpItem.avg_position || null
          })).filter(qpItem => qpItem.query || qpItem.page);
          
          // Limit to 2000 items to prevent payload size issues (Vercel limit is ~4.5MB)
          // Each item is ~65 bytes, so 2000 items = ~130KB, leaving room for other fields
          if (mapped.length > 2000) {
            console.warn(`[Save Audit] ⚠ query_pages has ${mapped.length} items, truncating to 2000 to prevent payload size issues`);
            return mapped.slice(0, 2000);
          }
          return mapped;
        }
        console.warn('[Save Audit] queryPages is missing or empty - CTR metrics will not be available in scorecard');
        return null;
      })(),
      
      // GSC top queries (for top queries display)
      top_queries: (() => {
        const tq = searchData?.topQueries;
        if (Array.isArray(tq) && tq.length > 0) {
          console.log('[Save Audit] Saving topQueries:', tq.length, 'queries');
          return tq;
        }
        return null;
      })(),
      
      // GSC timeseries data (for trend charts) - store in audit_results for quick access
      gsc_timeseries: (() => {
        const ts = searchData?.timeseries;
        if (Array.isArray(ts) && ts.length > 0) {
          console.log('[Save Audit] Saving timeseries:', ts.length, 'data points');
          return ts;
        }
        return null;
      })(),
      
      // Date range used for this audit
      date_range: ensureNumber(searchData?.dateRange) || null,
      
      // GSC query-only totals for tracked keywords (PATCH A2)
      query_totals: (() => {
        const qt = searchData?.queryTotals;
        if (Array.isArray(qt) && qt.length > 0) {
          console.log('[Save Audit] Saving queryTotals:', qt.length, 'keywords');
          return qt;
        }
        return null;
      })(),
      
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
      
      // AI Summary Components (for AI Citations tile delta calculations)
      ai_summary_components: (() => {
        if (!snippetReadiness || !scores) return null;
        const snippetReadinessScore = typeof snippetReadiness === 'number' 
          ? snippetReadiness 
          : (snippetReadiness.overallScore || 0);
        const visibilityScore = scores.visibility || 0;
        const brandScore = scores.brandOverlay?.score || 0;
        if (snippetReadinessScore === 0 && visibilityScore === 0 && brandScore === 0) return null;
        return {
          snippetReadiness: Math.round(snippetReadinessScore),
          visibility: Math.round(visibilityScore),
          brand: Math.round(brandScore)
        };
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
      
      // EEAT Score and Components (for EEAT tile delta calculations)
      // Note: Domain strength is fetched separately and should be passed from client or stored separately
      // For now, we compute EEAT with available data (domainStrength will be null/50 default)
      eeat_score: (() => {
        try {
          // Helper function to clamp score to 0-100
          const clampScore = (v) => {
            if (typeof v !== 'number' || !isFinite(v)) return 50; // Default to 50 if missing
            return Math.max(0, Math.min(100, Math.round(v)));
          };
          
          // Helper to safely get number or default
          const toNum = (v) => (typeof v === 'number' && isFinite(v)) ? v : null;
          const safe50 = (v) => (typeof v === 'number' && isFinite(v)) ? v : 50;
          
          // Authority components
          const ac = scores?.authorityComponents || {};
          const behaviour = toNum(ac.behaviour);
          const reviews = toNum(ac.reviews);
          const backlinksRaw = toNum(ac.backlinks);
          // Assume backlinks are measured if backlinksRaw exists and > 0
          const hasBacklinks = backlinksRaw !== null && backlinksRaw > 0;
          const backlinks = hasBacklinks ? backlinksRaw : 50;
          
          // Local signals / NAP
          const localData = localSignals?.data || localSignals || null;
          const nap = toNum(localData?.napConsistencyScore);
          const hasLocalSignals = nap != null || localData?.knowledgePanelDetected === true || 
            (Array.isArray(localData?.locations) && localData.locations.length > 0);
          
          // Core pillar scores
          const localEntity = toNum(scores?.localEntity);
          const contentSchema = toNum(scores?.contentSchema);
          const snippetReadinessScore = typeof snippetReadiness === 'number' 
            ? snippetReadiness 
            : (snippetReadiness?.overallScore || 0);
          const snippet = toNum(snippetReadinessScore);
          
          // Domain Strength (default to 50 if not available - should be passed from client)
          const domainScore = 50; // Default - domainStrength should be passed from client
          const hasDomainStrength = false; // Will be true if domainStrength is passed
          
          // AI citations signal (from rankingAiData)
          let citationsTotal = 0;
          let hasAiCitations = false;
          if (rankingAiData && rankingAiData.combinedRows && Array.isArray(rankingAiData.combinedRows)) {
            citationsTotal = rankingAiData.combinedRows.reduce((sum, row) => {
              return sum + (row.ai_alan_citations_count || 0);
            }, 0);
            hasAiCitations = citationsTotal > 0;
          }
          const citationsSignal = hasAiCitations ? Math.max(0, Math.min(100, citationsTotal)) : 50;
          
          // Sub-scores (EEAT v1)
          const trustNap = (typeof nap === 'number') ? clampScore(nap) : safe50(localEntity);
          const experience = clampScore(0.5 * safe50(reviews) + 0.3 * safe50(behaviour) + 0.2 * safe50(localEntity));
          const expertise = clampScore(0.6 * safe50(contentSchema) + 0.4 * safe50(snippet));
          const authoritativeness = clampScore(0.5 * safe50(backlinks) + 0.3 * safe50(domainScore) + 0.2 * safe50(citationsSignal));
          const trustworthiness = clampScore(0.6 * trustNap + 0.4 * safe50(reviews));
          
          const eeat = clampScore(
            0.2 * experience +
            0.25 * expertise +
            0.3 * authoritativeness +
            0.25 * trustworthiness
          );
          
          return eeat;
        } catch (err) {
          console.warn('[Supabase Save] Error computing EEAT score:', err.message);
          return null;
        }
      })(),
      
      eeat_confidence: (() => {
        try {
          const ac = scores?.authorityComponents || {};
          const hasBacklinks = (ac.backlinks !== null && ac.backlinks !== undefined && ac.backlinks > 0);
          const localData = localSignals?.data || localSignals || null;
          const hasLocalSignals = localData?.napConsistencyScore != null || 
            localData?.knowledgePanelDetected === true || 
            (Array.isArray(localData?.locations) && localData.locations.length > 0);
          const hasAiCitations = rankingAiData && rankingAiData.combinedRows && 
            Array.isArray(rankingAiData.combinedRows) &&
            rankingAiData.combinedRows.some(row => (row.ai_alan_citations_count || 0) > 0);
          const hasDomainStrength = false; // Should be true if domainStrength is passed from client
          
          const signalCount = [hasBacklinks, hasDomainStrength, hasAiCitations, hasLocalSignals].filter(Boolean).length;
          if (signalCount >= 3) return 'High';
          if (signalCount >= 2) return 'Medium';
          return 'Low';
        } catch (err) {
          console.warn('[Supabase Save] Error computing EEAT confidence:', err.message);
          return null;
        }
      })(),
      
      eeat_subscores: (() => {
        try {
          const clampScore = (v) => {
            if (typeof v !== 'number' || !isFinite(v)) return 50;
            return Math.max(0, Math.min(100, Math.round(v)));
          };
          const toNum = (v) => (typeof v === 'number' && isFinite(v)) ? v : null;
          const safe50 = (v) => (typeof v === 'number' && isFinite(v)) ? v : 50;
          
          const ac = scores?.authorityComponents || {};
          const behaviour = toNum(ac.behaviour);
          const reviews = toNum(ac.reviews);
          const backlinksRaw = toNum(ac.backlinks);
          const backlinks = (backlinksRaw !== null && backlinksRaw > 0) ? backlinksRaw : 50;
          
          const localData = localSignals?.data || localSignals || null;
          const nap = toNum(localData?.napConsistencyScore);
          const localEntity = toNum(scores?.localEntity);
          const contentSchema = toNum(scores?.contentSchema);
          const snippetReadinessScore = typeof snippetReadiness === 'number' 
            ? snippetReadiness 
            : (snippetReadiness?.overallScore || 0);
          const snippet = toNum(snippetReadinessScore);
          
          const domainScore = 50; // Default
          let citationsTotal = 0;
          if (rankingAiData && rankingAiData.combinedRows && Array.isArray(rankingAiData.combinedRows)) {
            citationsTotal = rankingAiData.combinedRows.reduce((sum, row) => {
              return sum + (row.ai_alan_citations_count || 0);
            }, 0);
          }
          const citationsSignal = citationsTotal > 0 ? Math.max(0, Math.min(100, citationsTotal)) : 50;
          
          const trustNap = (typeof nap === 'number') ? clampScore(nap) : safe50(localEntity);
          const experience = clampScore(0.5 * safe50(reviews) + 0.3 * safe50(behaviour) + 0.2 * safe50(localEntity));
          const expertise = clampScore(0.6 * safe50(contentSchema) + 0.4 * safe50(snippet));
          const authoritativeness = clampScore(0.5 * safe50(backlinks) + 0.3 * safe50(domainScore) + 0.2 * safe50(citationsSignal));
          const trustworthiness = clampScore(0.6 * trustNap + 0.4 * safe50(reviews));
          
          return {
            experience: Math.round(experience),
            expertise: Math.round(expertise),
            authoritativeness: Math.round(authoritativeness),
            trustworthiness: Math.round(trustworthiness)
          };
        } catch (err) {
          console.warn('[Supabase Save] Error computing EEAT subscores:', err.message);
          return null;
        }
      })(),
      
      // Domain Strength (should be passed from client or fetched separately)
      // For now, we'll store null and it can be updated later or passed from client
      domain_strength: null, // TODO: Pass from client or fetch from domain strength API
      
      // Business Profile Data (for historical tracking)
      local_business_schema_pages: ensureNumber(localSignals?.data?.localBusinessSchemaPages),
      nap_consistency_score: ensureNumber(localSignals?.data?.napConsistencyScore),
      knowledge_panel_detected: localSignals?.data?.knowledgePanelDetected === true ? true : (localSignals?.data?.knowledgePanelDetected === false ? false : null),
      service_areas: Array.isArray(localSignals?.data?.serviceAreas) ? localSignals.data.serviceAreas : null, // Array of service area objects
      locations: Array.isArray(localSignals?.data?.locations) ? localSignals.data.locations : null, // Array of location objects
      gbp_rating: localSignals?.data?.gbpRating !== null && localSignals?.data?.gbpRating !== undefined ? parseFloat(localSignals.data.gbpRating) : null,
      gbp_review_count: localSignals?.data?.gbpReviewCount !== null && localSignals?.data?.gbpReviewCount !== undefined ? parseInt(localSignals.data.gbpReviewCount) : null,
      
      // Partial write flags (set below after validation)
      is_partial: false,
      partial_reason: null,
      
      updated_at: new Date().toISOString()
    };

    // CRITICAL: Check for partial updates BEFORE guardrail check
    // Partial updates (e.g., only queryTotals) should be allowed even without other data
    const isPartialUpdate = !scores && !schemaAudit && searchData && searchData.queryTotals;
    const hasQueryTotalsOnly = isPartialUpdate && 
      auditRecord.query_totals !== null && 
      Array.isArray(auditRecord.query_totals) && 
      auditRecord.query_totals.length > 0;

    // ---- Guardrails: prevent writing "null audits" and mark partials ----
    // We consider a write "invalid" (reject) if it contains no meaningful audit payload.
    // EXCEPTION: Allow partial updates that only contain query_totals (for updating existing audits)
    const hasAnyPillarScore = [
      auditRecord.visibility_score,
      auditRecord.authority_score,
      auditRecord.content_schema_score,
      auditRecord.local_entity_score,
      auditRecord.service_area_score
    ].some(v => v !== null && v !== undefined);

    const hasAnyHeavyPayload =
      auditRecord.schema_pages_detail !== null ||
      auditRecord.query_pages !== null ||
      auditRecord.gsc_timeseries !== null ||
      auditRecord.top_queries !== null ||
      (auditRecord.query_totals !== null && Array.isArray(auditRecord.query_totals) && auditRecord.query_totals.length > 0);

    // Allow partial updates with query_totals only (for updating existing audits)
    if (!hasAnyPillarScore && !hasAnyHeavyPayload && !hasQueryTotalsOnly) {
      console.warn('[Supabase Save] ✗ Rejecting audit write: no scores and no payload (would create null audit row)');
      return res.status(400).json({
        status: 'error',
        message: 'Rejected audit save: payload contained no scores or audit data',
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    // Mark partial if critical fields are missing (but still allow saving).
    // Full audits should include schema_pages_detail + some GSC payload + core scores.
    const partialReasons = [];
    if (auditRecord.schema_pages_detail === null) partialReasons.push('schema_pages_detail missing');
    if (auditRecord.gsc_timeseries === null) partialReasons.push('gsc_timeseries missing');
    if (auditRecord.query_pages === null) partialReasons.push('query_pages missing');
    if (!hasAnyPillarScore) partialReasons.push('pillar scores missing');

    if (partialReasons.length > 0) {
      auditRecord.is_partial = true;
      auditRecord.partial_reason = partialReasons.join('; ');
      console.warn('[Supabase Save] ⚠ Marking audit as partial:', auditRecord.partial_reason);
    }

    // Calculate and log payload size before sending
    const payloadJson = JSON.stringify(auditRecord);
    const payloadSizeKB = Math.round(payloadJson.length / 1024);
    console.log(`[Supabase Save] 📊 Payload size: ${payloadSizeKB}KB`);
    
    if (payloadSizeKB > 3500) {
      console.warn(`[Supabase Save] ⚠ Payload size (${payloadSizeKB}KB) is close to Vercel limit (4.5MB)`);
      // Log sizes of individual fields to help identify what's large
      const fieldSizes = {
        query_pages: auditRecord.query_pages ? Math.round(JSON.stringify(auditRecord.query_pages).length / 1024) : 0,
        schema_pages_detail: auditRecord.schema_pages_detail ? Math.round(JSON.stringify(auditRecord.schema_pages_detail).length / 1024) : 0,
        ranking_ai_data: auditRecord.ranking_ai_data ? Math.round(JSON.stringify(auditRecord.ranking_ai_data).length / 1024) : 0,
        money_pages_metrics: auditRecord.money_pages_metrics ? Math.round(JSON.stringify(auditRecord.money_pages_metrics).length / 1024) : 0,
        top_queries: auditRecord.top_queries ? Math.round(JSON.stringify(auditRecord.top_queries).length / 1024) : 0,
        gsc_timeseries: auditRecord.gsc_timeseries ? Math.round(JSON.stringify(auditRecord.gsc_timeseries).length / 1024) : 0
      };
      console.log(`[Supabase Save] 📊 Field sizes (KB):`, fieldSizes);
    }

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
    
    // CRITICAL: When doing a partial update (e.g., only queryTotals), only send non-null fields
    // to prevent overwriting existing data with null values
    // (isPartialUpdate was already determined above)
    let updatePayload = auditRecord;
    
    if (isPartialUpdate) {
      // Only include fields that are being updated (non-null)
      updatePayload = {
        property_url: auditRecord.property_url,
        audit_date: auditRecord.audit_date
      };
      // Only add query_totals if it's actually an array with data
      if (auditRecord.query_totals && Array.isArray(auditRecord.query_totals) && auditRecord.query_totals.length > 0) {
        updatePayload.query_totals = auditRecord.query_totals;
      }
      console.log('[Supabase Save] ⚠ Partial update detected - only updating query_totals to prevent data loss');
    }
    
    // SAFETY: Prevent partial audits from overwriting existing full audit data with nulls.
    // This can happen if you run an audit and it is missing heavy payload fields (schema_pages_detail, gsc_timeseries, query_pages),
    // which would otherwise PATCH those columns to null for the same (property_url, audit_date).
    if (!isPartialUpdate && auditRecord.is_partial === true) {
      try {
        const selectFields = [
          'is_partial',
          'partial_reason',
          // heavy payloads
          'schema_pages_detail',
          'gsc_timeseries',
          'query_pages',
          'top_queries',
          'query_totals',
          'query_pages',
          // money pages
          'money_pages_metrics',
          'money_pages_summary',
          'money_pages_behaviour_score',
          'money_segment_metrics',
          'money_page_priority_data',
          // ranking/ai
          'ranking_ai_data',
          // core scores
          'visibility_score',
          'authority_score',
          'local_entity_score',
          'service_area_score',
          'content_schema_score',
          'brand_score',
          'ai_summary_score',
          'brand_overlay',
          // schema coverage metadata
          'schema_total_pages',
          'schema_pages_with_schema',
          'schema_coverage'
        ].join(',');

        const existingRes = await fetch(
          `${supabaseUrl}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(propertyUrl)}&audit_date=eq.${auditDate}&select=${selectFields}&limit=1`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`
            }
          }
        );

        if (existingRes.ok) {
          const existingRows = await existingRes.json().catch(() => []);
          const existing = Array.isArray(existingRows) && existingRows.length > 0 ? existingRows[0] : null;
          if (existing) {
            // Merge: keep existing values when incoming is null/undefined.
            const merged = { ...auditRecord };
            for (const [k, v] of Object.entries(existing)) {
              if (merged[k] === null || merged[k] === undefined) merged[k] = v;
            }

            // If an existing full audit exists, keep it marked as full.
            if (existing.is_partial === false) {
              merged.is_partial = false;
              merged.partial_reason = existing.partial_reason ?? null;
            }

            updatePayload = merged;
            console.warn('[Supabase Save] ⚠ Partial audit merge: preserved existing non-null fields to prevent data loss');
          }
        }
      } catch (e) {
        console.warn('[Supabase Save] ⚠ Partial audit merge failed (continuing with original payload):', e?.message || String(e));
      }
    }
    
    // First, try to update existing record
    const updateResponse = await fetch(`${supabaseUrl}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(propertyUrl)}&audit_date=eq.${auditDate}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(updatePayload)
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
        // No existing record found
        if (isPartialUpdate) {
          // For partial updates, don't create a new record if it doesn't exist
          console.log('[Supabase Save] ⚠ Partial update: No existing record found, skipping INSERT (queryTotals can only be added to existing audits)');
          return res.status(404).json({
            status: 'error',
            message: 'Cannot save queryTotals: No existing audit record found. Please run a full audit first.',
            meta: { generatedAt: new Date().toISOString() }
          });
        }
        // For full audits, proceed with INSERT
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
      // Record doesn't exist
      if (isPartialUpdate) {
        // For partial updates, don't create a new record if it doesn't exist
        console.log('[Supabase Save] ⚠ Partial update: Record not found, skipping INSERT (queryTotals can only be added to existing audits)');
        return res.status(404).json({
          status: 'error',
          message: 'Cannot save queryTotals: No existing audit record found. Please run a full audit first.',
          meta: { generatedAt: new Date().toISOString() }
        });
      }
      // For full audits, proceed with INSERT
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

    // Prepare response first (don't block on per-date calculation)
    const responseData = {
      status: 'ok',
      message: 'Audit results saved successfully',
      data: result,
      meta: { generatedAt: new Date().toISOString() }
    };

    // Calculate money_segment_metrics per-date for the last 28 days using current audit's moneyPagePriorityData
    // This ensures all dates in the GSC window have proper metrics, even if the audit was partial
    // ALWAYS use gsc_timeseries table to get complete 28-day data (not just current audit's timeseries)
    // Run this AFTER sending response to avoid timeout
    // TEMPORARILY DISABLED - causing syntax errors, will fix in next commit
    /*
    if (moneySegmentMetrics && moneyPagePriorityData && !isPartialUpdate) {
      // Don't await - run in background after response is sent
      setImmediate(async () => {
        try {
          const allMoney = moneySegmentMetrics.allMoney || {};
          
          // Check if current metrics are valid (not all zeros)
          const hasValidMetrics = allMoney.clicks > 0 || allMoney.impressions > 0;
          
          // ALWAYS fetch from gsc_timeseries table to ensure we have all dates in the last 28 days
          // (current audit's timeseries might not include all historical dates)
          if (hasValidMetrics) {
          console.log('[Supabase Save] Fetching timeseries from gsc_timeseries table for last 28 days...');
          const currentDate = new Date(auditDate);
          const twentyEightDaysAgo = new Date(currentDate);
          twentyEightDaysAgo.setDate(twentyEightDaysAgo.getDate() - 28);
          const startDateStr = twentyEightDaysAgo.toISOString().split('T')[0];
          
          const timeseriesQuery = `${supabaseUrl}/rest/v1/gsc_timeseries?property_url=eq.${encodeURIComponent(propertyUrl)}&date=gte.${startDateStr}&date=lte.${auditDate}&select=date,clicks,impressions,ctr,position&order=date.asc`;
          const timeseriesResponse = await fetch(timeseriesQuery, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`
            }
          });
          
          let timeseries = [];
          if (timeseriesResponse.ok) {
            const timeseriesData = await timeseriesResponse.json();
            timeseries = timeseriesData.map(t => ({
              date: t.date,
              clicks: t.clicks || 0,
              impressions: t.impressions || 0,
              ctr: t.ctr || 0,
              position: t.position || 0
            }));
            console.log(`[Supabase Save] Fetched ${timeseries.length} dates from gsc_timeseries table (${startDateStr} to ${auditDate})`);
          } else {
            console.warn('[Supabase Save] Failed to fetch from gsc_timeseries table, will skip per-date calculation');
          }
          
          if (hasValidMetrics && timeseries.length > 0) {
          // Calculate total site-wide metrics for the current audit date from timeseries
          const currentDateData = timeseries.find(t => {
            const tsDate = t.date ? (t.date.split('T')[0]) : null;
            return tsDate === auditDate;
          });
          
          if (currentDateData && currentDateData.clicks > 0 && currentDateData.impressions > 0) {
            // Calculate proportion of money pages from current audit
            const moneyClicksProportion = allMoney.clicks > 0 ? allMoney.clicks / currentDateData.clicks : 0;
            const moneyImpressionsProportion = allMoney.impressions > 0 ? allMoney.impressions / currentDateData.impressions : 0;
            
            // Skip if proportions are invalid (would cause NaN/Infinity)
            if (moneyClicksProportion <= 0 || moneyImpressionsProportion <= 0 || 
                moneyClicksProportion > 1 || moneyImpressionsProportion > 1) {
              console.warn(`[Supabase Save] ⚠ Invalid money page proportions (clicks: ${moneyClicksProportion}, impressions: ${moneyImpressionsProportion}), skipping per-date calculation`);
            } else {
              // Calculate segment proportions from current metrics
              const segmentProportions = {
                allMoney: { clicks: 1.0, impressions: 1.0 },
                landingPages: {
                  clicks: allMoney.clicks > 0 ? (moneySegmentMetrics.landingPages?.clicks || 0) / allMoney.clicks : 0,
                  impressions: allMoney.impressions > 0 ? (moneySegmentMetrics.landingPages?.impressions || 0) / allMoney.impressions : 0
                },
                eventPages: {
                  clicks: allMoney.clicks > 0 ? (moneySegmentMetrics.eventPages?.clicks || 0) / allMoney.clicks : 0,
                  impressions: allMoney.impressions > 0 ? (moneySegmentMetrics.eventPages?.impressions || 0) / allMoney.impressions : 0
                },
                productPages: {
                  clicks: allMoney.clicks > 0 ? (moneySegmentMetrics.productPages?.clicks || 0) / allMoney.clicks : 0,
                  impressions: allMoney.impressions > 0 ? (moneySegmentMetrics.productPages?.impressions || 0) / allMoney.impressions : 0
                }
              };
              
              console.log(`[Supabase Save] Calculating per-date money_segment_metrics for ${timeseries.length} dates using proportions`);
              console.log(`[Supabase Save] Money pages proportion: ${(moneyClicksProportion * 100).toFixed(1)}% clicks, ${(moneyImpressionsProportion * 100).toFixed(1)}% impressions`);
              
              // Get all audit dates in the timeseries range
              const timeseriesDates = timeseries.map(t => t.date ? t.date.split('T')[0] : null).filter(Boolean);
              const minDate = timeseriesDates.length > 0 ? timeseriesDates[0] : null;
              const maxDate = timeseriesDates.length > 0 ? timeseriesDates[timeseriesDates.length - 1] : null;
              
              if (minDate && maxDate) {
              // Fetch all audit dates in the timeseries range
              const historyQuery = `${supabaseUrl}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(propertyUrl)}&audit_date=gte.${minDate}&audit_date=lte.${maxDate}&select=audit_date,money_segment_metrics&order=audit_date.asc`;
              const historyResponse = await fetch(historyQuery, {
                method: 'GET',
                headers: {
                  'Content-Type': 'application/json',
                  'apikey': supabaseKey,
                  'Authorization': `Bearer ${supabaseKey}`
                }
              });
              
              if (historyResponse.ok) {
                const historyRecords = await historyResponse.json();
                const historyMap = new Map(historyRecords.map(r => [r.audit_date, r]));
                const updates = [];
                
                // Calculate metrics for each date in timeseries
                for (const tsPoint of timeseries) {
                  const tsDate = tsPoint.date ? tsPoint.date.split('T')[0] : null;
                  if (!tsDate) continue;
                  
                  // Skip current audit date (already saved with full calculation)
                  if (tsDate === auditDate) continue;
                  
                  // Check if this date needs updating (missing or all zeros)
                  const existingRecord = historyMap.get(tsDate);
                  let needsUpdate = false;
                  
                  if (!existingRecord) {
                    // No audit record for this date - skip (can't create audit records without full audit)
                    continue;
                  }
                  
                  let existingMetrics = existingRecord.money_segment_metrics;
                  if (typeof existingMetrics === 'string') {
                    try {
                      existingMetrics = JSON.parse(existingMetrics);
                    } catch (e) {
                      existingMetrics = null;
                    }
                  }
                  
                  const isInvalid = !existingMetrics || 
                    (existingMetrics.allMoney && existingMetrics.allMoney.clicks === 0 && existingMetrics.allMoney.impressions === 0) ||
                    (!existingMetrics.allMoney);
                  
                  if (isInvalid && tsPoint.clicks > 0) {
                    // Calculate money page metrics for this date using proportions
                    const dateMoneyClicks = Math.round(tsPoint.clicks * moneyClicksProportion);
                    const dateMoneyImpressions = Math.round(tsPoint.impressions * moneyImpressionsProportion);
                    const dateMoneyCtr = dateMoneyImpressions > 0 ? dateMoneyClicks / dateMoneyImpressions : 0;
                    
                    // Calculate segment metrics using proportions
                    const calculatedMetrics = {
                      allMoney: {
                        clicks: dateMoneyClicks,
                        impressions: dateMoneyImpressions,
                        ctr: dateMoneyCtr,
                        avgPosition: allMoney.avgPosition || 0, // Use current audit's avg position
                        behaviourScore: allMoney.behaviourScore || 0
                      },
                      landingPages: {
                        clicks: Math.round(dateMoneyClicks * segmentProportions.landingPages.clicks),
                        impressions: Math.round(dateMoneyImpressions * segmentProportions.landingPages.impressions),
                        ctr: 0,
                        avgPosition: moneySegmentMetrics.landingPages?.avgPosition || 0,
                        behaviourScore: moneySegmentMetrics.landingPages?.behaviourScore || 0
                      },
                      eventPages: {
                        clicks: Math.round(dateMoneyClicks * segmentProportions.eventPages.clicks),
                        impressions: Math.round(dateMoneyImpressions * segmentProportions.eventPages.impressions),
                        ctr: 0,
                        avgPosition: moneySegmentMetrics.eventPages?.avgPosition || 0,
                        behaviourScore: moneySegmentMetrics.eventPages?.behaviourScore || 0
                      },
                      productPages: {
                        clicks: Math.round(dateMoneyClicks * segmentProportions.productPages.clicks),
                        impressions: Math.round(dateMoneyImpressions * segmentProportions.productPages.impressions),
                        ctr: 0,
                        avgPosition: moneySegmentMetrics.productPages?.avgPosition || 0,
                        behaviourScore: moneySegmentMetrics.productPages?.behaviourScore || 0
                      }
                    };
                    
                    // Calculate CTRs for segments
                    if (calculatedMetrics.landingPages.impressions > 0) {
                      calculatedMetrics.landingPages.ctr = calculatedMetrics.landingPages.clicks / calculatedMetrics.landingPages.impressions;
                    }
                    if (calculatedMetrics.eventPages.impressions > 0) {
                      calculatedMetrics.eventPages.ctr = calculatedMetrics.eventPages.clicks / calculatedMetrics.eventPages.impressions;
                    }
                    if (calculatedMetrics.productPages.impressions > 0) {
                      calculatedMetrics.productPages.ctr = calculatedMetrics.productPages.clicks / calculatedMetrics.productPages.impressions;
                    }
                    
                    updates.push({
                      audit_date: tsDate,
                      money_segment_metrics: calculatedMetrics
                    });
                  }
                }
                
                // Batch update records (non-blocking - don't wait for completion to avoid timeout)
                if (updates.length > 0) {
                  console.log(`[Supabase Save] Queueing ${updates.length} audit date(s) for money_segment_metrics update (non-blocking)`);
                  
                  // Run updates in background without blocking the main save
                  // Limit to 10 updates at a time to avoid timeout
                  const maxUpdates = Math.min(updates.length, 10);
                  const updatesToProcess = updates.slice(0, maxUpdates);
                  
                  // Process updates without awaiting (fire and forget)
                  Promise.allSettled(
                    updatesToProcess.map(update => {
                      const updateUrl = `${supabaseUrl}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(propertyUrl)}&audit_date=eq.${update.audit_date}`;
                      return fetch(updateUrl, {
                        method: 'PATCH',
                        headers: {
                          'Content-Type': 'application/json',
                          'apikey': supabaseKey,
                          'Authorization': `Bearer ${supabaseKey}`
                        },
                        body: JSON.stringify({
                          money_segment_metrics: ensureJson(update.money_segment_metrics)
                        })
                      }).then(res => {
                        if (res.ok) {
                          console.log(`[Supabase Save] ✓ Updated money_segment_metrics for ${update.audit_date}`);
                        } else {
                          console.warn(`[Supabase Save] ⚠ Failed to update ${update.audit_date}: ${res.status}`);
                        }
                      }).catch(err => {
                        console.warn(`[Supabase Save] ⚠ Error updating ${update.audit_date}: ${err.message}`);
                      });
                    })
                  ).then(() => {
                    console.log(`[Supabase Save] ✓ Completed ${updatesToProcess.length}/${updates.length} money_segment_metrics updates`);
                  });
                  
                  if (updates.length > maxUpdates) {
                    console.log(`[Supabase Save] ⚠ Limited to ${maxUpdates} updates to avoid timeout (${updates.length - maxUpdates} remaining)`);
                  }
                }
              }
            }
          }
        }
        } catch (backfillError) {
          // Don't fail the entire save if calculation fails
          console.warn('[Supabase Save] ⚠ Error during per-date calculation (non-critical):', backfillError.message);
          console.warn('[Supabase Save] Stack:', backfillError.stack);
        }
      });
    }
    */

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
          opportunity_score: row.opportunityScore !== null && row.opportunityScore !== undefined ? parseInt(row.opportunityScore) : null,
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

          // Auto-enqueue all competitor domains from AI citations to domain_rank_pending
          try {
            const competitorDomains = new Set();
            for (const row of rankingAiData.combinedRows) {
              if (row.competitor_counts && typeof row.competitor_counts === 'object') {
                for (const domain of Object.keys(row.competitor_counts)) {
                  const normalized = normalizeDomain(domain);
                  if (normalized) {
                    competitorDomains.add(normalized);
                  }
                }
              }
            }

            if (competitorDomains.size > 0) {
              console.log(`[Supabase Save] Enqueuing ${competitorDomains.size} competitor domains to domain_rank_pending...`);
              await enqueuePending(Array.from(competitorDomains), {
                engine: 'google',
                source: 'ranking-ai-citations'
              });
              console.log(`[Supabase Save] ✓ Successfully enqueued ${competitorDomains.size} domains for domain strength snapshots`);
            } else {
              console.log(`[Supabase Save] No competitor domains found to enqueue`);
            }
          } catch (enqueueErr) {
            console.error('[Supabase Save] ✗ Error enqueuing competitor domains:', enqueueErr.message);
            // Don't fail the entire request if enqueueing fails
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

    // Return response immediately (per-date calculation runs in background)
    res.status(200).json({
      status: 'ok',
      message: 'Audit results saved successfully',
      data: result,
      meta: { generatedAt: new Date().toISOString() }
    });
    
    // Note: Per-date calculation continues in background (setImmediate above)
    // Don't return here - let it complete in background

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


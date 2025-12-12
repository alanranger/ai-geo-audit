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
    // Add early logging to verify function execution
    console.log('[get-latest-audit] Function invoked');
    console.log('[get-latest-audit] Method:', req.method);
    console.log('[get-latest-audit] Query:', JSON.stringify(req.query));
    
    const { propertyUrl, minimal } = req.query;
    const isMinimalRequest = minimal === 'true';

    if (!propertyUrl) {
      console.log('[get-latest-audit] Missing propertyUrl parameter');
      return res.status(400).json({
        status: 'error',
        message: 'Missing required parameter: propertyUrl',
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    // Get Supabase credentials from environment
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    console.log('[get-latest-audit] Supabase URL present:', !!supabaseUrl);
    console.log('[get-latest-audit] Supabase Key present:', !!supabaseKey);

    if (!supabaseUrl || !supabaseKey) {
      console.error('[get-latest-audit] Missing Supabase credentials');
      return res.status(500).json({
        status: 'error',
        message: 'Supabase not configured. Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.',
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    // CRITICAL: For minimal requests, only fetch essential fields to prevent FUNCTION_INVOCATION_FAILED
    // For full requests, fetch all fields but with aggressive truncation later
    let record;
    let auditDate;
    
    try {
      // For minimal requests, only fetch essential fields (timestamp + scores)
      // This prevents the function from crashing when large JSON fields are present
      let queryUrl;
      if (isMinimalRequest) {
        // For minimal requests, explicitly select only essential fields
        // URL encode the select parameter to handle commas properly
        const selectFields = 'audit_date,updated_at,visibility_score,content_schema_score,authority_score,local_entity_score,service_area_score';
        queryUrl = `${supabaseUrl}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(propertyUrl)}&order=audit_date.desc&limit=1&select=${encodeURIComponent(selectFields)}`;
      } else {
        // For full requests, fetch all fields (but we'll truncate large ones later)
        queryUrl = `${supabaseUrl}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(propertyUrl)}&order=audit_date.desc&limit=1&select=*`;
      }
      
      let response;
      try {
        response = await fetch(queryUrl, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`
          }
        });
        console.log(`[get-latest-audit] Supabase fetch completed, status: ${response.status}`);
      } catch (fetchError) {
        console.error('[get-latest-audit] Fetch error:', fetchError.message);
        console.error('[get-latest-audit] Fetch error stack:', fetchError.stack);
        return res.status(500).json({
          status: 'error',
          message: 'Failed to fetch from Supabase',
          details: fetchError.message,
          meta: { generatedAt: new Date().toISOString() }
        });
      }

      if (!response.ok) {
        let errorText;
        try {
          errorText = await response.text();
        } catch (textError) {
          errorText = `HTTP ${response.status}: ${response.statusText}`;
        }
        console.error('[get-latest-audit] Supabase query error:', errorText);
        return res.status(response.status).json({
          status: 'error',
          message: 'Failed to fetch latest audit from Supabase',
          details: errorText,
          meta: { generatedAt: new Date().toISOString() }
        });
      }

      // Check response size before parsing (for minimal requests, should be very small)
      const contentLength = response.headers.get('content-length');
      if (contentLength && isMinimalRequest) {
        const sizeKB = Math.round(parseInt(contentLength) / 1024);
        console.log(`[get-latest-audit] Minimal response size: ${sizeKB}KB`);
        if (sizeKB > 100) {
          console.warn(`[get-latest-audit] ⚠️  Minimal response is unexpectedly large (${sizeKB}KB)`);
        }
      }

      let results;
      try {
        results = await response.json();
        console.log(`[get-latest-audit] Successfully parsed JSON, results length: ${results?.length || 0}`);
      } catch (jsonError) {
        console.error('[get-latest-audit] Failed to parse Supabase response as JSON:', jsonError.message);
        console.error('[get-latest-audit] JSON error stack:', jsonError.stack);
        // Try to get the raw response for debugging (but this might fail if body was already consumed)
        try {
          const responseClone = response.clone();
          const rawText = await responseClone.text();
          console.error('[get-latest-audit] Raw response (first 500 chars):', rawText.substring(0, 500));
        } catch (cloneError) {
          console.error('[get-latest-audit] Could not clone response for debugging:', cloneError.message);
        }
        return res.status(500).json({
          status: 'error',
          message: 'Failed to parse Supabase response',
          details: jsonError.message,
          meta: { generatedAt: new Date().toISOString() }
        });
      }

      if (!results || results.length === 0) {
        console.log(`[get-latest-audit] No audit records found`);
        return res.status(200).json({
          status: 'ok',
          data: null,
          message: 'No audit found for this property URL',
          meta: { generatedAt: new Date().toISOString() }
        });
      }

      record = results[0];
      if (!record) {
        console.error('[get-latest-audit] Record is null or undefined');
        return res.status(500).json({
          status: 'error',
          message: 'Invalid record returned from Supabase',
          meta: { generatedAt: new Date().toISOString() }
        });
      }
      
      auditDate = record.audit_date;
      console.log(`[get-latest-audit] Found audit record for date: ${auditDate} (minimal: ${isMinimalRequest})`);
      console.log(`[get-latest-audit] Record keys: ${Object.keys(record).join(', ')}`);
    } catch (queryError) {
      console.error('[get-latest-audit] Error fetching audit record:', queryError);
      console.error('[get-latest-audit] Query error stack:', queryError.stack);
      return res.status(500).json({
        status: 'error',
        message: 'Failed to fetch audit record from Supabase',
        details: queryError.message,
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    // CRITICAL: If minimal request, return immediately after fetching essential fields
    // This prevents the function from processing large JSON fields that cause FUNCTION_INVOCATION_FAILED
    if (isMinimalRequest) {
      try {
        console.log(`[get-latest-audit] Returning minimal response (timestamp + scores only)`);
        const minimalData = {
          timestamp: record.updated_at ? new Date(record.updated_at).getTime() : (record.audit_date ? new Date(record.audit_date + 'T00:00:00').getTime() : Date.now()),
          auditDate: record.audit_date || null,
          scores: {
            visibility: record.visibility_score ?? null,
            contentSchema: record.content_schema_score ?? null,
            authority: record.authority_score ?? null,
            localEntity: record.local_entity_score ?? null,
            serviceArea: record.service_area_score ?? null
          },
          _minimal: true
        };
        return res.status(200).json({
          status: 'ok',
          data: minimalData,
          meta: { generatedAt: new Date().toISOString(), auditDate: record.audit_date || null, minimal: true }
        });
      } catch (minimalError) {
        console.error('[get-latest-audit] Error creating minimal response:', minimalError);
        console.error('[get-latest-audit] Record keys:', record ? Object.keys(record) : 'null');
        return res.status(500).json({
          status: 'error',
          message: 'Failed to create minimal response',
          details: minimalError.message,
          meta: { generatedAt: new Date().toISOString() }
        });
      }
    }

    // Fetch keyword rankings from keyword_rankings table for this audit_date and property_url
    // TEMPORARILY DISABLED: Skip keyword rankings fetch to prevent FUNCTION_INVOCATION_FAILED errors
    // The rankingAiData will be loaded from the audit_results.ranking_ai_data JSON field instead
    let rankingAiData = null;
    
    // CRITICAL: Temporarily skip ranking_ai_data parsing to prevent FUNCTION_INVOCATION_FAILED
    // The 246KB ranking_ai_data field is causing the function to crash
    // TODO: Re-enable after implementing proper pagination or chunking
    console.log(`[get-latest-audit] Skipping ranking_ai_data parsing to prevent FUNCTION_INVOCATION_FAILED (field is 246KB)`);
    rankingAiData = null;
    
    /* TEMPORARILY DISABLED: ranking_ai_data parsing
    // CRITICAL: Parse ranking_ai_data if it's a string (Supabase may return JSON as strings)
    // Also check size to prevent FUNCTION_INVOCATION_FAILED errors
    const rawRankingData = record.ranking_ai_data;
    if (rawRankingData) {
      // Skip parsing if string is too large (over 200KB) to prevent memory issues
      if (typeof rawRankingData === 'string' && rawRankingData.length > 200 * 1024) {
        console.warn(`[get-latest-audit] ⚠️  ranking_ai_data too large (${Math.round(rawRankingData.length / 1024)}KB), skipping parse to prevent FUNCTION_INVOCATION_FAILED`);
        rankingAiData = null;
      } else {
        try {
          if (typeof rawRankingData === 'string') {
            rankingAiData = JSON.parse(rawRankingData);
          } else {
            rankingAiData = rawRankingData;
          }
          console.log(`[get-latest-audit] Using rankingAiData from audit_results (${rankingAiData ? (rankingAiData.combinedRows?.length || 0) + ' keywords' : 'null'})`);
        } catch (parseError) {
          console.error(`[get-latest-audit] Failed to parse ranking_ai_data: ${parseError.message}`);
          rankingAiData = null;
        }
      }
    } else {
      console.log(`[get-latest-audit] No rankingAiData in audit_results`);
    }
    */
    
    /* DISABLED: Keyword rankings fetch - re-enable when function timeout issues are resolved
    try {
      console.log(`[get-latest-audit] Fetching keyword rankings for audit_date=${auditDate}, property_url=${propertyUrl}`);
      
      // First, try to fetch using the audit_date from audit_results
      // Limit to 2000 rows initially to prevent timeout/response size issues
      let keywordRankingsUrl = `${supabaseUrl}/rest/v1/keyword_rankings?property_url=eq.${encodeURIComponent(propertyUrl)}&audit_date=eq.${encodeURIComponent(auditDate)}&select=*&order=keyword.asc&limit=2000`;
      
      let keywordRankingsResponse = await fetch(keywordRankingsUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`
        }
      });

      let keywordRows = [];
      if (keywordRankingsResponse.ok) {
        keywordRows = await keywordRankingsResponse.json();
        console.log(`[get-latest-audit] Found ${keywordRows?.length || 0} keyword rows for audit_date=${auditDate}`);
      } else {
        const errorText = await keywordRankingsResponse.text();
        console.log(`[get-latest-audit] Query with audit_date=${auditDate} failed: ${keywordRankingsResponse.status} - ${errorText}`);
      }
      
      // If no rows found with the audit_date from audit_results, try to get the most recent data
      if (!keywordRows || keywordRows.length === 0) {
        console.log(`[get-latest-audit] No rows found for audit_date=${auditDate}, trying to fetch most recent data...`);
        keywordRankingsUrl = `${supabaseUrl}/rest/v1/keyword_rankings?property_url=eq.${encodeURIComponent(propertyUrl)}&select=*&order=audit_date.desc,keyword.asc&limit=1000`;
        keywordRankingsResponse = await fetch(keywordRankingsUrl, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`
          }
        });
        
        if (keywordRankingsResponse.ok) {
          const allRows = await keywordRankingsResponse.json();
          if (allRows && allRows.length > 0) {
            // Group by audit_date and get the most recent
            const rowsByDate = {};
            allRows.forEach(row => {
              if (!rowsByDate[row.audit_date]) {
                rowsByDate[row.audit_date] = [];
              }
              rowsByDate[row.audit_date].push(row);
            });
            const dates = Object.keys(rowsByDate).sort().reverse();
            if (dates.length > 0) {
              keywordRows = rowsByDate[dates[0]];
              console.log(`[get-latest-audit] Found ${keywordRows.length} keyword rows for most recent audit_date=${dates[0]}`);
            }
          }
        }
      }
        
        if (keywordRows && keywordRows.length > 0) {
          // Early truncation: limit to 2000 rows to prevent processing too much data
          if (keywordRows.length > 2000) {
            console.warn(`[get-latest-audit] Truncating keyword rows from ${keywordRows.length} to 2000 before processing`);
            keywordRows = keywordRows.slice(0, 2000);
          }
          
          // Convert database rows to frontend format (combinedRows)
          const combinedRows = keywordRows.map(row => {
            // Parse JSON fields if they're strings (Supabase may return JSON as strings)
            let aiCitations = row.ai_alan_citations || [];
            if (typeof aiCitations === 'string') {
              try {
                aiCitations = JSON.parse(aiCitations);
              } catch (e) {
                console.warn(`[get-latest-audit] Failed to parse ai_alan_citations for keyword "${row.keyword}":`, e.message);
                aiCitations = [];
              }
            }
            if (!Array.isArray(aiCitations)) aiCitations = [];
            
            // Truncate large aiCitations arrays (limit to 10 citations per keyword)
            if (aiCitations.length > 10) {
              aiCitations = aiCitations.slice(0, 10);
            }

            let competitorCounts = row.competitor_counts || {};
            if (typeof competitorCounts === 'string') {
              try {
                competitorCounts = JSON.parse(competitorCounts);
              } catch (e) {
                competitorCounts = {};
              }
            }
            if (typeof competitorCounts !== 'object' || competitorCounts === null) competitorCounts = {};
            
            // Truncate competitor_counts if it has too many entries (limit to top 20)
            if (Object.keys(competitorCounts).length > 20) {
              const entries = Object.entries(competitorCounts).sort((a, b) => b[1] - a[1]).slice(0, 20);
              competitorCounts = Object.fromEntries(entries);
            }

            let serpFeatures = row.serp_features || {};
            if (typeof serpFeatures === 'string') {
              try {
                serpFeatures = JSON.parse(serpFeatures);
              } catch (e) {
                serpFeatures = {};
              }
            }
            if (typeof serpFeatures !== 'object' || serpFeatures === null) serpFeatures = {};
            
            // Truncate serp_features if it's too large (limit to essential fields only)
            if (Object.keys(serpFeatures).length > 10) {
              const essentialFields = ['ai_overview', 'local_pack', 'people_also_ask', 'featured_snippet'];
              const truncated = {};
              essentialFields.forEach(field => {
                if (serpFeatures[field] !== undefined) {
                  truncated[field] = serpFeatures[field];
                }
              });
              serpFeatures = truncated;
            }

            return {
              keyword: row.keyword,
              best_rank_group: row.best_rank_group,
              best_rank_absolute: row.best_rank_absolute,
              best_url: row.best_url,
              best_title: row.best_title,
              search_volume: row.search_volume,
              has_ai_overview: row.has_ai_overview || false,
              ai_total_citations: row.ai_total_citations || 0,
              ai_alan_citations_count: row.ai_alan_citations_count || 0,
              ai_alan_citations: aiCitations,
              competitor_counts: competitorCounts,
              serp_features: serpFeatures,
              // New boolean fields for SERP feature coverage
              ai_overview_present_any: row.ai_overview_present_any === true,
              local_pack_present_any: row.local_pack_present_any === true,
              paa_present_any: row.paa_present_any === true,
              featured_snippet_present_any: row.featured_snippet_present_any === true,
              segment: row.segment,
              pageType: row.page_type,
              demand_share: row.demand_share,
              opportunityScore: row.opportunity_score ?? null
            };
          });

          // Calculate summary from combinedRows
          const totalKeywords = combinedRows.length;
          const keywordsWithRank = combinedRows.filter(r => r.best_rank_group != null && r.best_rank_group > 0).length;
          const top10 = combinedRows.filter(r => r.best_rank_group != null && r.best_rank_group <= 10).length;
          const top3 = combinedRows.filter(r => r.best_rank_group != null && r.best_rank_group <= 3).length;
          const keywordsWithAiOverview = combinedRows.filter(r => r.has_ai_overview === true).length;
          const keywordsWithAiCitations = combinedRows.filter(r => r.ai_alan_citations_count > 0).length;
          
          // Calculate unweighted average position
          const validRankingRows = combinedRows.filter(r => r.best_rank_group != null && r.best_rank_group > 0);
          const avgPositionUnweighted = validRankingRows.length > 0
            ? validRankingRows.reduce((sum, r) => sum + r.best_rank_group, 0) / validRankingRows.length
            : null;

          // Calculate volume-weighted average position
          const keywordsWithVolume = combinedRows.filter(r => r.search_volume != null && r.search_volume > 0);
          let avgPositionVolumeWeighted = null;
          if (keywordsWithVolume.length > 0) {
            let totalWeightedRank = 0;
            let totalVolume = 0;
            keywordsWithVolume.forEach(r => {
              const vol = r.search_volume || 10; // Fallback to 10 if null
              const rank = r.best_rank_group;
              if (rank != null && rank > 0) {
                totalWeightedRank += rank * vol;
                totalVolume += vol;
              }
            });
            if (totalVolume > 0) {
              avgPositionVolumeWeighted = totalWeightedRank / totalVolume;
            }
          }

          rankingAiData = {
            combinedRows,
            summary: {
              total_keywords: totalKeywords,
              keywords_with_rank: keywordsWithRank,
              top10,
              top3,
              keywords_with_ai_overview: keywordsWithAiOverview,
              keywords_with_ai_citations: keywordsWithAiCitations,
              avg_position_unweighted: avgPositionUnweighted,
              avg_position_volume_weighted: avgPositionVolumeWeighted,
              keywords_used_for_avg: validRankingRows.length,
              keywords_with_volume: keywordsWithVolume.length
            }
          };
          console.log(`[get-latest-audit] Successfully reconstructed rankingAiData with ${combinedRows.length} keywords`);
        } else {
          // Fallback to ranking_ai_data JSON from audit_results if keyword_rankings is empty
          console.log(`[get-latest-audit] No keyword rows found, falling back to ranking_ai_data from audit_results`);
          rankingAiData = record.ranking_ai_data || null;
        }
    } catch (keywordErr) {
      console.error('[get-latest-audit] Error fetching keyword rankings:', keywordErr);
      // Fallback to ranking_ai_data JSON from audit_results if keyword_rankings fetch errors
      rankingAiData = record.ranking_ai_data || null;
    }
    */
    
    // Log final rankingAiData status (safely, without accessing nested properties if it's still a string)
    if (rankingAiData && typeof rankingAiData === 'object' && rankingAiData.combinedRows) {
      console.log(`[get-latest-audit] Final rankingAiData: ${rankingAiData.combinedRows.length} keywords`);
    } else {
      console.log(`[get-latest-audit] Final rankingAiData: null or invalid`);
    }

    // Reconstruct the full audit object from Supabase data
    // Wrap in try-catch to handle any parsing errors gracefully
    let auditData;
    try {
      auditData = {
      scores: {
        visibility: record.visibility_score || null,
        contentSchema: record.content_schema_score || null,
        authority: (() => {
          const bySegment = record.authority_by_segment;
          let parsedBySegment = bySegment;
          if (bySegment && typeof bySegment === 'string') {
            try {
              parsedBySegment = JSON.parse(bySegment);
            } catch (e) {
              console.warn('[get-latest-audit] Failed to parse authority_by_segment JSON:', e.message);
              parsedBySegment = null;
            }
          }
          return parsedBySegment ? {
            score: record.authority_score || null,
            bySegment: parsedBySegment
          } : (record.authority_score || null);
        })(),
        localEntity: record.local_entity_score || null,
        serviceArea: record.service_area_score || null,
        brandOverlay: (() => {
          const overlay = record.brand_overlay;
          if (!overlay) return null;
          if (typeof overlay === 'string') {
            try {
              return JSON.parse(overlay);
            } catch (e) {
              console.warn('[get-latest-audit] Failed to parse brand_overlay JSON:', e.message);
              return null;
            }
          }
          return overlay;
        })(),
        // Fix: Parse JSON if money_pages_metrics is stored as string
        moneyPagesMetrics: (() => {
          const metrics = record.money_pages_metrics;
          if (!metrics) return null;
          if (typeof metrics === 'string') {
            try {
              return JSON.parse(metrics);
            } catch (e) {
              console.warn('[get-latest-audit] Failed to parse money_pages_metrics JSON:', e.message);
              return null;
            }
          }
          return metrics;
        })(),
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
        },
        // CRITICAL: Load timeseries data from audit_results table (now stored directly)
        // CRITICAL: Skip parsing if string is too large to prevent FUNCTION_INVOCATION_FAILED
        timeseries: (() => {
          const ts = record.gsc_timeseries;
          if (!ts) return null;
          // Skip parsing if string is larger than 500KB to prevent timeouts
          if (typeof ts === 'string' && ts.length > 500 * 1024) {
            console.warn(`[get-latest-audit] Skipping gsc_timeseries parse (too large: ${Math.round(ts.length / 1024)}KB)`);
            return null;
          }
          let parsed;
          if (typeof ts === 'string') {
            try {
              parsed = JSON.parse(ts);
            } catch (e) {
              console.warn('[get-latest-audit] Failed to parse gsc_timeseries JSON:', e.message);
              return null;
            }
          } else {
            parsed = ts;
          }
          if (Array.isArray(parsed)) {
            // Truncate to 90 items (3 months of daily data) immediately to prevent large responses
            if (parsed.length > 90) {
              console.warn(`[get-latest-audit] Truncating gsc_timeseries from ${parsed.length} to 90 immediately`);
              return parsed.slice(-90); // Keep the most recent 90 days
            }
            return parsed;
          }
          return null;
        })(),
        // Query+page level data for CTR metrics in keyword scorecard
        // Fix: Parse JSON if query_pages is stored as string
        // CRITICAL: Skip parsing if string is too large to prevent FUNCTION_INVOCATION_FAILED
        queryPages: (() => {
          const qp = record.query_pages;
          if (!qp) return null;
          // Skip parsing if string is larger than 1MB to prevent timeouts
          if (typeof qp === 'string' && qp.length > 1024 * 1024) {
            console.warn(`[get-latest-audit] Skipping query_pages parse (too large: ${Math.round(qp.length / 1024)}KB)`);
            return null;
          }
          let parsed;
          if (typeof qp === 'string') {
            try {
              parsed = JSON.parse(qp);
            } catch (e) {
              console.warn('[get-latest-audit] Failed to parse query_pages JSON:', e.message);
              return null;
            }
          } else {
            parsed = qp;
          }
          if (Array.isArray(parsed)) {
            // Truncate to 1000 items immediately to prevent large responses
            if (parsed.length > 1000) {
              console.warn(`[get-latest-audit] Truncating queryPages from ${parsed.length} to 1000 immediately`);
              return parsed.slice(0, 1000);
            }
            return parsed;
          }
          return null;
        })(),
        // Top queries from GSC
        // CRITICAL: Truncate immediately to prevent FUNCTION_INVOCATION_FAILED
        topQueries: (() => {
          const tq = record.top_queries;
          if (!tq) return null;
          let parsed;
          if (typeof tq === 'string') {
            try {
              parsed = JSON.parse(tq);
            } catch (e) {
              console.warn('[get-latest-audit] Failed to parse top_queries JSON:', e.message);
              return null;
            }
          } else {
            parsed = tq;
          }
          if (Array.isArray(parsed)) {
            // Truncate to 200 items immediately to prevent large responses
            if (parsed.length > 200) {
              console.warn(`[get-latest-audit] Truncating topQueries from ${parsed.length} to 200 immediately`);
              return parsed.slice(0, 200);
            }
            return parsed;
          }
          return null;
        })(),
        // Date range used for this audit
        dateRange: record.date_range || null,
        // Property URL
        propertyUrl: record.property_url || null
      },
      snippetReadiness: record.snippet_readiness || 0,
      // Fix: Check for schema data existence, not just content_schema_score (which might be 0)
      // Also check if schema_pages_detail exists (even as a string that needs parsing)
      schemaAudit: ((record.schema_total_pages != null && record.schema_total_pages > 0) || record.schema_coverage != null || record.content_schema_score != null || (record.schema_pages_detail != null && record.schema_pages_detail !== '[]' && record.schema_pages_detail !== '')) ? {
        status: 'ok',
        data: {
          coverage: record.schema_coverage != null ? record.schema_coverage : (record.content_schema_score != null ? record.content_schema_score : 0),
          totalPages: record.schema_total_pages || 0,
          // CRITICAL: Include pages array for scorecard schema detection
          // schema_pages_detail is the detailed array with url, title, metaDescription, hasSchema, schemaTypes, error per page
          // Parse JSON if stored as string in Supabase
          // CRITICAL: Skip parsing if string is too large to prevent FUNCTION_INVOCATION_FAILED
          pages: (() => {
            let pagesDetail = record.schema_pages_detail;
            if (!pagesDetail) return null;
            // Skip parsing if string is larger than 500KB to prevent timeouts
            if (typeof pagesDetail === 'string' && pagesDetail.length > 500 * 1024) {
              console.warn(`[get-latest-audit] Skipping schema_pages_detail parse (too large: ${Math.round(pagesDetail.length / 1024)}KB)`);
              return null;
            }
            // Parse if stored as string
            if (typeof pagesDetail === 'string') {
              try {
                pagesDetail = JSON.parse(pagesDetail);
              } catch (e) {
                console.warn('[get-latest-audit] Failed to parse schema_pages_detail JSON:', e.message);
                return null;
              }
            }
            // Return array if valid, otherwise null
            // Ensure all fields are present (backward compatibility for old records)
            if (Array.isArray(pagesDetail) && pagesDetail.length > 0) {
              // Truncate to 200 items immediately to prevent large responses
              const truncated = pagesDetail.length > 200 ? pagesDetail.slice(0, 200) : pagesDetail;
              if (pagesDetail.length > 200) {
                console.warn(`[get-latest-audit] Truncating schema_pages_detail from ${pagesDetail.length} to 200 immediately`);
              }
              return truncated.map(p => ({
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
            return null;
          })(),
          pagesWithSchema: (() => {
            let pagesDetail = record.schema_pages_detail;
            if (!pagesDetail) {
              // Fallback to count if detail not available
              return record.schema_pages_with_schema != null ? record.schema_pages_with_schema : 0;
            }
            // Skip parsing if string is larger than 500KB to prevent timeouts
            if (typeof pagesDetail === 'string' && pagesDetail.length > 500 * 1024) {
              console.warn(`[get-latest-audit] Skipping pagesWithSchema parse (too large: ${Math.round(pagesDetail.length / 1024)}KB)`);
              return record.schema_pages_with_schema != null ? record.schema_pages_with_schema : 0;
            }
            // Parse if stored as string
            if (typeof pagesDetail === 'string') {
              try {
                pagesDetail = JSON.parse(pagesDetail);
              } catch (e) {
                console.warn('[get-latest-audit] Failed to parse schema_pages_detail JSON:', e.message);
                return record.schema_pages_with_schema != null ? record.schema_pages_with_schema : 0;
              }
            }
            // Return array if valid, otherwise fallback to count
            // CRITICAL: Truncate array if too large to prevent FUNCTION_INVOCATION_FAILED
            if (Array.isArray(pagesDetail) && pagesDetail.length > 0) {
              if (pagesDetail.length > 200) {
                console.warn(`[get-latest-audit] Truncating pagesWithSchema array from ${pagesDetail.length} to 200 immediately`);
                return pagesDetail.slice(0, 200);
              }
              return pagesDetail;
            }
            return record.schema_pages_with_schema != null ? record.schema_pages_with_schema : 0;
          })(),
          schemaTypes: (() => {
            let types = record.schema_types;
            if (!types) return [];
            // Parse if stored as string
            if (typeof types === 'string') {
              try {
                types = JSON.parse(types);
              } catch (e) {
                console.warn('[get-latest-audit] Failed to parse schema_types JSON:', e.message);
                return [];
              }
            }
            return Array.isArray(types) ? types : [];
          })(),
          foundation: (() => {
            const foundation = record.schema_foundation;
            if (!foundation) return {};
            if (typeof foundation === 'string') {
              try {
                return JSON.parse(foundation);
              } catch (e) {
                console.warn('[get-latest-audit] Failed to parse schema_foundation JSON:', e.message);
                return {};
              }
            }
            return (typeof foundation === 'object' && foundation !== null) ? foundation : {};
          })(),
          richEligible: (() => {
            const richEligible = record.schema_rich_eligible;
            if (!richEligible) return {};
            if (typeof richEligible === 'string') {
              try {
                return JSON.parse(richEligible);
              } catch (e) {
                console.warn('[get-latest-audit] Failed to parse schema_rich_eligible JSON:', e.message);
                return {};
              }
            }
            return (typeof richEligible === 'object' && richEligible !== null) ? richEligible : {};
          })(),
          missingTypes: (() => {
            let types = record.schema_types;
            if (!types) return ['Organization', 'Person', 'WebSite', 'BreadcrumbList'];
            // Parse if stored as string
            if (typeof types === 'string') {
              try {
                types = JSON.parse(types);
              } catch (e) {
                return ['Organization', 'Person', 'WebSite', 'BreadcrumbList'];
              }
            }
            return Array.isArray(types) && types.length > 0 ? [] : ['Organization', 'Person', 'WebSite', 'BreadcrumbList'];
          })(),
          missingSchemaPages: (() => {
            let missing = record.schema_missing_pages;
            if (!missing) return [];
            // Parse if stored as string
            if (typeof missing === 'string') {
              try {
                missing = JSON.parse(missing);
              } catch (e) {
                console.warn('[get-latest-audit] Failed to parse schema_missing_pages JSON:', e.message);
                return [];
              }
            }
            return Array.isArray(missing) ? missing : [];
          })()
        },
        meta: (() => {
          // Reconstruct meta.diagnostic from schema_pages_detail by counting error types
          let pagesDetail = record.schema_pages_detail;
          if (!pagesDetail) return { generatedAt: record.created_at || new Date().toISOString() };
          
          // Parse if stored as string
          if (typeof pagesDetail === 'string') {
            try {
              pagesDetail = JSON.parse(pagesDetail);
            } catch (e) {
              return { generatedAt: record.created_at || new Date().toISOString() };
            }
          }
          
          if (!Array.isArray(pagesDetail) || pagesDetail.length === 0) {
            return { generatedAt: record.created_at || new Date().toISOString() };
          }
          
          // Count error types
          const errorTypes = {};
          const errorExamples = {};
          let failedPages = 0;
          let successfulPages = 0;
          
          pagesDetail.forEach(p => {
            if (p.error) {
              failedPages++;
              const errorType = p.errorType || 'Unknown';
              errorTypes[errorType] = (errorTypes[errorType] || 0) + 1;
              if (!errorExamples[errorType]) {
                errorExamples[errorType] = {
                  url: p.url,
                  error: p.error
                };
              }
            } else {
              successfulPages++;
            }
          });
          
          const totalPages = pagesDetail.length;
          const pagesWithSchema = pagesDetail.filter(p => p.hasSchema === true).length;
          
          return {
            generatedAt: record.created_at || new Date().toISOString(),
            urlsScanned: totalPages,
            urlsWithSchema: pagesWithSchema,
            diagnostic: {
              totalPages,
              successfulPages,
              failedPages,
              pagesWithInlineSchema: pagesWithSchema,
              pagesWithoutInlineSchema: totalPages - pagesWithSchema,
              errorTypes: Object.keys(errorTypes).length > 0 ? errorTypes : undefined,
              errorExamples: Object.keys(errorExamples).length > 0 ? errorExamples : undefined,
              note: 'Failed crawls are counted as pages without schema since schema cannot be verified'
            }
          };
        })()
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
      timestamp: record.updated_at ? new Date(record.updated_at).getTime() : new Date(record.audit_date + 'T00:00:00').getTime(),
      auditDate: record.audit_date,
      // Money Pages Priority Matrix data - restore from Supabase if available
      // Fix: Parse JSON if stored as string
      moneyPagePriorityData: (() => {
        const data = record.money_page_priority_data;
        if (!data) return null;
        if (typeof data === 'string') {
          try {
            return JSON.parse(data);
          } catch (e) {
            console.warn('[get-latest-audit] Failed to parse money_page_priority_data JSON:', e.message);
            return null;
          }
        }
        return data;
      })(),
      moneySegmentMetrics: (() => {
        const metrics = record.money_segment_metrics;
        if (!metrics) return null;
        if (typeof metrics === 'string') {
          try {
            return JSON.parse(metrics);
          } catch (e) {
            console.warn('[get-latest-audit] Failed to parse money_segment_metrics JSON:', e.message);
            return null;
          }
        }
        return metrics;
      })(),
      rankingAiData: (() => {
        // Truncate rankingAiData if it's too large to prevent FUNCTION_INVOCATION_FAILED
        if (!rankingAiData) return null;
        
        // If it has combinedRows, truncate to prevent large responses
        if (rankingAiData.combinedRows && Array.isArray(rankingAiData.combinedRows)) {
          if (rankingAiData.combinedRows.length > 2000) {
            console.warn(`[get-latest-audit] Truncating rankingAiData.combinedRows from ${rankingAiData.combinedRows.length} to 2000`);
            return {
              ...rankingAiData,
              combinedRows: rankingAiData.combinedRows.slice(0, 2000),
              _truncated: true
            };
          }
        }
        
        return rankingAiData;
      })() // Ranking & AI data reconstructed from keyword_rankings table
    };
    } catch (reconstructionError) {
      console.error('[get-latest-audit] Error reconstructing audit data:', reconstructionError);
      console.error('[get-latest-audit] Stack:', reconstructionError.stack);
      // Return minimal audit data if reconstruction fails
      auditData = {
        scores: {
          visibility: record.visibility_score || null,
          contentSchema: record.content_schema_score || null,
          authority: record.authority_score || null,
          localEntity: record.local_entity_score || null,
          serviceArea: record.service_area_score || null
        },
        searchData: {
          totalClicks: record.gsc_clicks || 0,
          totalImpressions: record.gsc_impressions || 0,
          averagePosition: record.gsc_avg_position || null,
          ctr: record.gsc_ctr || 0
        },
        schemaAudit: record.schema_pages_with_schema ? {
          status: 'ok',
          data: {
            totalPages: record.schema_total_pages || 0,
            pagesWithSchema: record.schema_pages_with_schema || 0,
            coverage: record.schema_pages_with_schema && record.schema_total_pages 
              ? (record.schema_pages_with_schema / record.schema_total_pages) * 100 
              : 0
          }
        } : null,
        timestamp: record.updated_at ? new Date(record.updated_at).getTime() : new Date(record.audit_date + 'T00:00:00').getTime(),
        auditDate: record.audit_date,
        _error: 'Partial data - reconstruction failed',
        _errorMessage: reconstructionError.message
      };
    }

    // Check response size before sending (Vercel limit is ~4.5MB)
    let responseJson;
    let responseSizeKB = 0;
    try {
      responseJson = JSON.stringify({ status: 'ok', data: auditData, meta: { generatedAt: new Date().toISOString(), auditDate: record.audit_date } });
      responseSizeKB = Math.round(responseJson.length / 1024);
      console.log(`[get-latest-audit] Initial response size: ${responseSizeKB}KB`);
    } catch (stringifyError) {
      console.error('[get-latest-audit] Error stringifying response:', stringifyError);
      // Try to return a minimal response
      try {
        const minimalData = {
          scores: auditData.scores || {},
          searchData: auditData.searchData || {},
          schemaAudit: auditData.schemaAudit || null,
          timestamp: auditData.timestamp || Date.now(),
          auditDate: auditData.auditDate || record.audit_date,
          _error: 'Response too large to stringify',
          _truncated: true
        };
        responseJson = JSON.stringify({ status: 'ok', data: minimalData, meta: { generatedAt: new Date().toISOString(), auditDate: record.audit_date, truncated: true } });
        responseSizeKB = Math.round(responseJson.length / 1024);
        console.log(`[get-latest-audit] Using minimal response, size: ${responseSizeKB}KB`);
      } catch (minimalError) {
        console.error('[get-latest-audit] Even minimal response failed:', minimalError);
        // Last resort: return just the timestamp so UI can update
        try {
          const timestampOnly = {
            timestamp: record.updated_at ? new Date(record.updated_at).getTime() : new Date(record.audit_date + 'T00:00:00').getTime(),
            auditDate: record.audit_date,
            _error: 'Could not serialize full response',
            _minimal: true
          };
          return res.status(200).json({
            status: 'ok',
            data: timestampOnly,
            meta: { generatedAt: new Date().toISOString(), auditDate: record.audit_date, minimal: true, error: 'Full response too large' }
          });
        } catch (finalError) {
          return res.status(500).json({
            status: 'error',
            message: 'Failed to serialize response data',
            details: 'Response data is too large or contains circular references',
            meta: { generatedAt: new Date().toISOString() }
          });
        }
      }
    }
    
    // If response is too large, truncate large arrays
    const MAX_RESPONSE_SIZE_KB = 4000; // 4MB limit (leaving 500KB buffer)
    if (responseSizeKB > MAX_RESPONSE_SIZE_KB) {
      console.warn(`[get-latest-audit] ⚠ Response size (${responseSizeKB}KB) exceeds limit, truncating large fields...`);
      
      // Truncate queryPages if too large
      if (auditData.searchData?.queryPages && auditData.searchData.queryPages.length > 2000) {
        console.warn(`[get-latest-audit] Truncating queryPages from ${auditData.searchData.queryPages.length} to 2000`);
        auditData.searchData.queryPages = auditData.searchData.queryPages.slice(0, 2000);
      }
      
      // Truncate topQueries if too large
      if (auditData.searchData?.topQueries && auditData.searchData.topQueries.length > 500) {
        console.warn(`[get-latest-audit] Truncating topQueries from ${auditData.searchData.topQueries.length} to 500`);
        auditData.searchData.topQueries = auditData.searchData.topQueries.slice(0, 500);
      }
      
      // Truncate rankingAiData combinedRows if too large (should already be limited to 2000, but double-check)
      if (auditData.rankingAiData?.combinedRows && auditData.rankingAiData.combinedRows.length > 2000) {
        console.warn(`[get-latest-audit] Truncating rankingAiData.combinedRows from ${auditData.rankingAiData.combinedRows.length} to 2000`);
        auditData.rankingAiData.combinedRows = auditData.rankingAiData.combinedRows.slice(0, 2000);
        // Recalculate summary with truncated data
        const totalKeywords = auditData.rankingAiData.combinedRows.length;
        const keywordsWithRank = auditData.rankingAiData.combinedRows.filter(r => r.best_rank_group != null && r.best_rank_group > 0).length;
        const top10 = auditData.rankingAiData.combinedRows.filter(r => r.best_rank_group != null && r.best_rank_group <= 10).length;
        const top3 = auditData.rankingAiData.combinedRows.filter(r => r.best_rank_group != null && r.best_rank_group <= 3).length;
        const keywordsWithAiOverview = auditData.rankingAiData.combinedRows.filter(r => r.has_ai_overview === true).length;
        const keywordsWithAiCitations = auditData.rankingAiData.combinedRows.filter(r => r.ai_alan_citations_count > 0).length;
        auditData.rankingAiData.summary = {
          total_keywords: totalKeywords,
          keywords_with_rank: keywordsWithRank,
          top10,
          top3,
          keywords_with_ai_overview: keywordsWithAiOverview,
          keywords_with_ai_citations: keywordsWithAiCitations,
          truncated: true // Flag to indicate data was truncated
        };
      }
      
      // Re-stringify to check new size
      responseJson = JSON.stringify({ status: 'ok', data: auditData, meta: { generatedAt: new Date().toISOString(), auditDate: record.audit_date } });
      responseSizeKB = Math.round(responseJson.length / 1024);
      console.log(`[get-latest-audit] Response size after truncation: ${responseSizeKB}KB`);
      
      if (responseSizeKB > MAX_RESPONSE_SIZE_KB) {
        console.error(`[get-latest-audit] ✗ Response still too large (${responseSizeKB}KB) after truncation`);
        return res.status(500).json({
          status: 'error',
          message: 'Response too large',
          details: `Response size (${responseSizeKB}KB) exceeds maximum allowed size (${MAX_RESPONSE_SIZE_KB}KB)`,
          meta: { generatedAt: new Date().toISOString() }
        });
      }
    }

    return res.status(200).json({
      status: 'ok',
      data: auditData,
      meta: { 
        generatedAt: new Date().toISOString(),
        auditDate: record.audit_date,
        responseSizeKB
      }
    });

  } catch (error) {
    console.error('[get-latest-audit] Exception:', error.message);
    console.error('[get-latest-audit] Stack:', error.stack);
    console.error('[get-latest-audit] Error type:', error.constructor.name);
    console.error('[get-latest-audit] Error details:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
    
    // Try to return minimal data (timestamp + scores) even if full processing failed
    // This ensures the UI can at least update the timestamp
    try {
      // If we have the record, extract minimal data from it
      if (typeof record !== 'undefined' && record) {
        const minimalData = {
          timestamp: record.updated_at ? new Date(record.updated_at).getTime() : new Date(record.audit_date + 'T00:00:00').getTime(),
          auditDate: record.audit_date,
          scores: {
            visibility: record.visibility_score || null,
            contentSchema: record.content_schema_score || null,
            authority: record.authority_score || null,
            localEntity: record.local_entity_score || null,
            serviceArea: record.service_area_score || null
          },
          _error: 'Full data processing failed',
          _errorMessage: error.message || String(error),
          _minimal: true
        };
        console.log('[get-latest-audit] Returning minimal data due to error');
        return res.status(200).json({
          status: 'ok',
          data: minimalData,
          meta: { 
            generatedAt: new Date().toISOString(), 
            auditDate: record.audit_date, 
            minimal: true,
            error: error.message || String(error)
          }
        });
      }
    } catch (minimalError) {
      console.error('[get-latest-audit] Failed to return minimal data:', minimalError);
    }
    
    // If we can't return minimal data, return error
    const errorMessage = error.message || String(error);
    if (errorMessage.includes('timeout') || errorMessage.includes('memory') || errorMessage.includes('invocation') || errorMessage.includes('FUNCTION_INVOCATION_FAILED')) {
      return res.status(500).json({
        status: 'error',
        message: 'Function invocation failed - response may be too large or function timed out',
        details: errorMessage,
        suggestion: 'Try reducing the amount of data requested or check Vercel function logs',
        meta: { generatedAt: new Date().toISOString() }
      });
    }
    
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      details: errorMessage,
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}


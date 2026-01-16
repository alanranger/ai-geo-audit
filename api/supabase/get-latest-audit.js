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
    
    const { propertyUrl, minimal, includePartial } = req.query;
    const isMinimalRequest = minimal === 'true';
    const includePartialAudits = includePartial === 'true';

    if (!propertyUrl) {
      console.log('[get-latest-audit] Missing propertyUrl parameter');
      return res.status(400).json({
        status: 'error',
        message: 'Missing required parameter: propertyUrl',
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    const normalizePropertyUrl = (value) => {
      if (!value || typeof value !== 'string') return null;
      let raw = value.trim();
      if (!raw) return null;
      try {
        if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
        const url = new URL(raw);
        return `${url.protocol}//${url.hostname}`;
      } catch {
        return raw;
      }
    };

    const buildPropertyUrlCandidates = (value) => {
      const normalized = normalizePropertyUrl(value);
      if (!normalized) return [];
      const url = new URL(normalized);
      const candidates = [normalized];
      if (url.hostname.startsWith('www.')) {
        const alt = new URL(normalized);
        alt.hostname = url.hostname.replace(/^www\./, '');
        candidates.push(alt.origin);
      } else {
        const alt = new URL(normalized);
        alt.hostname = `www.${url.hostname}`;
        candidates.push(alt.origin);
      }
      return [...new Set(candidates)];
    };

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
      // Prefer latest *complete* audit (schema_pages_detail present) to avoid
      // treating "refresh/partial" rows as a full audit run.
      const buildQueryUrl = (candidateUrl, includeSchemaDetailFilter) => {
        const base = `${supabaseUrl}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(candidateUrl)}&order=audit_date.desc&limit=1`;
        // If includePartial is true, don't filter by is_partial (include both partial and complete audits)
        // Otherwise, only return complete audits (is_partial=eq.false)
        const partialFilter = includePartialAudits ? '' : '&is_partial=eq.false';
        const schemaFilter = includeSchemaDetailFilter ? `&schema_pages_detail=not.is.null${partialFilter}` : partialFilter;
        if (isMinimalRequest) {
          const selectFields = 'audit_date,updated_at,visibility_score,content_schema_score,authority_score,local_entity_score,service_area_score';
          return `${base}${schemaFilter}&select=${encodeURIComponent(selectFields)}`;
        }
        return `${base}${schemaFilter}&select=*`;
      };

      let results;
      let lastErrorText = null;
      let lastStatus = null;
      const propertyUrlCandidates = buildPropertyUrlCandidates(propertyUrl);
      let resolvedPropertyUrl = propertyUrlCandidates[0] || propertyUrl;

      for (const candidateUrl of propertyUrlCandidates) {
        const queryAttempts = [buildQueryUrl(candidateUrl, true), buildQueryUrl(candidateUrl, false)];
        for (const queryUrl of queryAttempts) {
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
            lastStatus = response.status;
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
            try {
              lastErrorText = await response.text();
            } catch (textError) {
              lastErrorText = `HTTP ${response.status}: ${response.statusText}`;
            }
            console.error('[get-latest-audit] Supabase query error:', lastErrorText);
            continue;
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

          if (results && Array.isArray(results) && results.length > 0) {
            resolvedPropertyUrl = candidateUrl;
            break;
          }
        }
        if (results && Array.isArray(results) && results.length > 0) {
          break;
        }
      }

      if (!results || !Array.isArray(results)) {
        return res.status(500).json({
          status: 'error',
          message: 'Failed to fetch latest audit from Supabase',
          details: lastErrorText || 'Unknown error',
          meta: { generatedAt: new Date().toISOString(), status: lastStatus }
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
    // Re-enabled: Fetching from keyword_rankings table with proper limits to prevent timeouts
    let rankingAiData = null;
    let rankingDataAuditDate = null; // Track the actual audit_date of ranking data (may differ from latest audit)
    
    // Re-enabled: Keyword rankings fetch with proper limits (2000 rows max)
    try {
      const resolvedPropertyUrl = record?.property_url || propertyUrl;
      console.log(`[get-latest-audit] Fetching keyword rankings for audit_date=${auditDate}, property_url=${resolvedPropertyUrl}`);
      
      // First, try to fetch using the audit_date from audit_results
      // Limit to 2000 rows initially to prevent timeout/response size issues
      let keywordRankingsUrl = `${supabaseUrl}/rest/v1/keyword_rankings?property_url=eq.${encodeURIComponent(resolvedPropertyUrl)}&audit_date=eq.${encodeURIComponent(auditDate)}&select=*&order=keyword.asc&limit=2000`;
      
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
        if (keywordRows && keywordRows.length > 0) {
          rankingDataAuditDate = auditDate; // Ranking data matches latest audit date
        }
      } else {
        const errorText = await keywordRankingsResponse.text();
        console.log(`[get-latest-audit] Query with audit_date=${auditDate} failed: ${keywordRankingsResponse.status} - ${errorText}`);
      }
      
      // If no rows found with the audit_date from audit_results, try to get the most recent data
      if (!keywordRows || keywordRows.length === 0) {
        console.log(`[get-latest-audit] No rows found for audit_date=${auditDate}, trying to fetch most recent data...`);
        keywordRankingsUrl = `${supabaseUrl}/rest/v1/keyword_rankings?property_url=eq.${encodeURIComponent(resolvedPropertyUrl)}&select=*&order=audit_date.desc,keyword.asc&limit=1000`;
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
              rankingDataAuditDate = dates[0]; // Store the actual audit_date of the ranking data
              console.log(`[get-latest-audit] Found ${keywordRows.length} keyword rows for most recent audit_date=${rankingDataAuditDate}`);
              if (rankingDataAuditDate !== auditDate) {
                console.log(`[get-latest-audit] Ranking data is from older audit (${rankingDataAuditDate}) than latest audit (${auditDate})`);
              }
            }
          }
        }
      }
        
        if (keywordRows && keywordRows.length > 0) {
          let rankingDataTimestamp = null;
          const normalizeTimestampValue = (value) => {
            if (!value) return null;
            if (value instanceof Date) return value;
            if (typeof value !== 'string') return null;
            let normalized = value.trim();
            if (!normalized) return null;
            if (normalized.includes(' ') && !normalized.includes('T')) {
              normalized = normalized.replace(' ', 'T');
            }
            if (normalized.endsWith('+00')) {
              normalized = `${normalized}:00`;
            }
            return new Date(normalized);
          };
          try {
            const candidateTimestamps = keywordRows
              .map(row => row.updated_at || row.created_at || null)
              .map(normalizeTimestampValue)
              .filter(date => date && !isNaN(date.getTime()));
            if (candidateTimestamps.length > 0) {
              candidateTimestamps.sort((a, b) => b.getTime() - a.getTime());
              rankingDataTimestamp = candidateTimestamps[0].toISOString();
            }
          } catch (timestampErr) {
            console.warn('[get-latest-audit] Failed to compute ranking data timestamp:', timestampErr.message);
          }

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
            },
            // Include the actual audit_date of the ranking data (may differ from latest audit)
            audit_date: rankingDataAuditDate || null,
            // Track the most recent timestamp from keyword_rankings rows
            timestamp: rankingDataTimestamp || null
          };
          console.log(`[get-latest-audit] Successfully reconstructed rankingAiData with ${combinedRows.length} keywords`);
        } else {
          // No keyword rows found in keyword_rankings table
          console.log(`[get-latest-audit] No keyword rows found in keyword_rankings table`);
          rankingAiData = null;
        }
    } catch (keywordErr) {
      console.error('[get-latest-audit] Error fetching keyword rankings:', keywordErr);
      console.error('[get-latest-audit] Error stack:', keywordErr.stack);
      // Set to null on error - will be handled by frontend fallback to localStorage
      rankingAiData = null;
    }
    
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
      let schemaPagesDetailParsed = null;
      let schemaPagesDetailTruncated = null;
      if (record.schema_pages_detail) {
        if (typeof record.schema_pages_detail === 'string' && record.schema_pages_detail.length > 500 * 1024) {
          console.warn(`[get-latest-audit] Skipping schema_pages_detail parse (too large: ${Math.round(record.schema_pages_detail.length / 1024)}KB)`);
        } else {
          try {
            schemaPagesDetailParsed = typeof record.schema_pages_detail === 'string'
              ? JSON.parse(record.schema_pages_detail)
              : record.schema_pages_detail;
            if (Array.isArray(schemaPagesDetailParsed) && schemaPagesDetailParsed.length > 0) {
              schemaPagesDetailTruncated = schemaPagesDetailParsed.length > 200
                ? schemaPagesDetailParsed.slice(0, 200)
                : schemaPagesDetailParsed;
              if (schemaPagesDetailParsed.length > 200) {
                console.warn(`[get-latest-audit] Truncating schema_pages_detail from ${schemaPagesDetailParsed.length} to 200 immediately`);
              }
            }
          } catch (e) {
            console.warn('[get-latest-audit] Failed to parse schema_pages_detail JSON:', e.message);
          }
        }
      }

      const derivedSchemaTotalPages = record.schema_total_pages || (Array.isArray(schemaPagesDetailParsed) ? schemaPagesDetailParsed.length : 0);
      const derivedSchemaPagesWithSchema = record.schema_pages_with_schema != null
        ? record.schema_pages_with_schema
        : (Array.isArray(schemaPagesDetailParsed) ? schemaPagesDetailParsed.filter(p => p && p.hasSchema === true).length : 0);
      const derivedSchemaCoverage = record.schema_coverage != null
        ? record.schema_coverage
        : (derivedSchemaTotalPages > 0 ? (derivedSchemaPagesWithSchema / derivedSchemaTotalPages) * 100 : 0);

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
        // Query-only totals for tracked keywords (PATCH A2)
        queryTotals: (() => {
          const qt = record.query_totals;
          if (!qt) {
            return null;
          }
          let parsed;
          if (typeof qt === 'string') {
            try {
              parsed = JSON.parse(qt);
            } catch (e) {
              console.warn('[get-latest-audit] Failed to parse query_totals JSON:', e.message);
              return null;
            }
          } else {
            parsed = qt;
          }
          
          // Handle empty objects - return null instead of trying to convert
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && Object.keys(parsed).length === 0) {
            return null;
          }
          
          if (Array.isArray(parsed)) {
            // Truncate to 200 items (should be enough for tracked keywords)
            if (parsed.length > 200) {
              console.warn(`[get-latest-audit] Truncating queryTotals from ${parsed.length} to 200 immediately`);
              return parsed.slice(0, 200);
            }
            return parsed;
          }
          // If it's an object, try to convert it to an array
          if (typeof parsed === 'object' && parsed !== null) {
            // If it's an object with numeric keys, it might be an array-like object
            if (Object.keys(parsed).every(key => !isNaN(parseInt(key)))) {
              return Object.values(parsed);
            }
            // If it's an object with a single array property, extract it
            for (const key in parsed) {
              if (Array.isArray(parsed[key])) {
                return parsed[key];
              }
            }
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
          coverage: derivedSchemaCoverage,
          totalPages: derivedSchemaTotalPages || 0,
          // CRITICAL: Include pages array for scorecard schema detection
          // schema_pages_detail is the detailed array with url, title, metaDescription, hasSchema, schemaTypes, error per page
          // Parse JSON if stored as string in Supabase
          // CRITICAL: Skip parsing if string is too large to prevent FUNCTION_INVOCATION_FAILED
          pages: (() => {
            if (!Array.isArray(schemaPagesDetailTruncated) || schemaPagesDetailTruncated.length === 0) return null;
            return schemaPagesDetailTruncated.map(p => ({
              url: p.url || '',
              title: p.title || null,
              metaDescription: p.metaDescription || null,
              hasSchema: p.hasSchema === true,
              hasInheritedSchema: p.hasInheritedSchema === true,
              schemaTypes: Array.isArray(p.schemaTypes) ? p.schemaTypes : (p.schemaTypes ? [p.schemaTypes] : []),
              error: p.error || null,
              errorType: p.errorType || null
            })).filter(p => p.url);
          })(),
          pagesWithSchema: (() => {
            if (Array.isArray(schemaPagesDetailTruncated) && schemaPagesDetailTruncated.length > 0) {
              return schemaPagesDetailTruncated;
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
      backlinkMetrics: (() => {
        const metrics = record.backlink_metrics;
        if (!metrics) return null;
        if (typeof metrics === 'string') {
          try {
            return JSON.parse(metrics);
          } catch (e) {
            console.warn('[get-latest-audit] Failed to parse backlink_metrics JSON:', e.message);
            return null;
          }
        }
        return metrics;
      })(),
      localSignals: (() => {
        const shouldCreate = record.local_entity_score !== null || record.service_area_score !== null || record.locations || record.gbp_rating !== null || record.gbp_review_count !== null;
        console.log('[get-latest-audit] localSignals condition check:', {
          local_entity_score: record.local_entity_score,
          service_area_score: record.service_area_score,
          has_locations: !!record.locations,
          gbp_rating: record.gbp_rating,
          gbp_review_count: record.gbp_review_count,
          shouldCreate
        });
        return shouldCreate;
      })() ? {
        status: 'ok',
        data: {
          localEntityScore: record.local_entity_score,
          serviceAreaScore: record.service_area_score,
          napConsistencyScore: record.nap_consistency_score,
          knowledgePanelDetected: record.knowledge_panel_detected,
          serviceAreas: (() => {
            const sa = record.service_areas;
            if (!sa) return [];
            if (typeof sa === 'string') {
              try {
                return JSON.parse(sa);
              } catch (e) {
                console.warn('[get-latest-audit] Failed to parse service_areas JSON:', e.message);
                return [];
              }
            }
            return Array.isArray(sa) ? sa : [];
          })(),
          locations: (() => {
            const loc = record.locations;
            if (!loc) return [];
            // Parse if stored as JSON string (Supabase JSONB may return as string)
            if (typeof loc === 'string') {
              try {
                const parsed = JSON.parse(loc);
                return Array.isArray(parsed) ? parsed : [];
              } catch (e) {
                console.warn('[get-latest-audit] Failed to parse locations JSON:', e.message);
                return [];
              }
            }
            return Array.isArray(loc) ? loc : [];
          })(),
          localBusinessSchemaPages: record.local_business_schema_pages || 0,
          gbpRating: (() => {
            const val = record.gbp_rating !== null && record.gbp_rating !== undefined ? parseFloat(record.gbp_rating) : null;
            console.log('[get-latest-audit] gbpRating extraction:', { raw: record.gbp_rating, parsed: val });
            return val;
          })(),
          gbpReviewCount: (() => {
            const val = record.gbp_review_count !== null && record.gbp_review_count !== undefined ? parseInt(record.gbp_review_count) : null;
            console.log('[get-latest-audit] gbpReviewCount extraction:', { raw: record.gbp_review_count, parsed: val });
            return val;
          })()
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


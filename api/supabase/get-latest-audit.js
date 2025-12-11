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
    const auditDate = record.audit_date;

    // Fetch keyword rankings from keyword_rankings table for this audit_date and property_url
    let rankingAiData = null;
    try {
      console.log(`[get-latest-audit] Fetching keyword rankings for audit_date=${auditDate}, property_url=${propertyUrl}`);
      
      // First, try to fetch using the audit_date from audit_results
      let keywordRankingsUrl = `${supabaseUrl}/rest/v1/keyword_rankings?property_url=eq.${encodeURIComponent(propertyUrl)}&audit_date=eq.${encodeURIComponent(auditDate)}&select=*&order=keyword.asc`;
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
          // Convert database rows to frontend format (combinedRows)
          const combinedRows = keywordRows.map(row => ({
            keyword: row.keyword,
            best_rank_group: row.best_rank_group,
            best_rank_absolute: row.best_rank_absolute,
            best_url: row.best_url,
            best_title: row.best_title,
            search_volume: row.search_volume,
            has_ai_overview: row.has_ai_overview || false,
            ai_total_citations: row.ai_total_citations || 0,
            ai_alan_citations_count: row.ai_alan_citations_count || 0,
            ai_alan_citations: row.ai_alan_citations || [],
            competitor_counts: row.competitor_counts || {},
            serp_features: row.serp_features || {},
            segment: row.segment,
            pageType: row.page_type,
            demand_share: row.demand_share
          }));

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
    
    console.log(`[get-latest-audit] Final rankingAiData: ${rankingAiData ? (rankingAiData.combinedRows?.length || 0) + ' keywords' : 'null'}`);

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
        },
        // CRITICAL: Load timeseries data from gsc_timeseries table for Score Trends chart
        timeseries: null // Will be loaded separately via get-audit-history endpoint
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
      timestamp: record.updated_at ? new Date(record.updated_at).getTime() : new Date(record.audit_date + 'T00:00:00').getTime(),
      auditDate: record.audit_date,
      // Money Pages Priority Matrix data - restore from Supabase if available
      moneyPagePriorityData: record.money_page_priority_data || null, // Restore from Supabase, or rebuild if missing
      moneySegmentMetrics: record.money_segment_metrics || null,
      rankingAiData: rankingAiData // Ranking & AI data reconstructed from keyword_rankings table
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


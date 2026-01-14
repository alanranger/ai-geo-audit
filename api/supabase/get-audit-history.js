/**
 * Get Historical Audit Results from Supabase
 * 
 * Fetches historical schema audit data for trend visualization.
 * Returns data for Content/Schema pillar historical tracking.
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
    const { propertyUrl, startDate, endDate } = req.query;

    if (!propertyUrl) {
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

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({
        status: 'error',
        message: 'Supabase not configured. Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.',
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    // Build query URL with select fields
    // Phase 3: Include money pages fields for trend tracking
    // Phase: Money Pages Priority Matrix - include segment metrics for KPI tracker
    // NOTE: Include partial audits that have money_segment_metrics (GSC data) since partial audits
    // can still have valid GSC data (CTR, impressions, clicks, position) even if page crawl was incomplete
    // We'll fetch all audits and filter client-side to include:
    // 1. Non-partial audits (is_partial=false)
    // 2. Partial audits with money_segment_metrics (is_partial=true AND money_segment_metrics IS NOT NULL)
    let resolvedPropertyUrl = propertyUrl;
    const propertyUrlCandidates = buildPropertyUrlCandidates(propertyUrl);
    const resolvePropertyUrl = async () => {
      for (const candidate of propertyUrlCandidates) {
        const probeUrl = `${supabaseUrl}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(candidate)}&select=id&limit=1`;
        try {
          const probeResp = await fetch(probeUrl, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`
            }
          });
          if (probeResp.ok) {
            const rows = await probeResp.json();
            if (Array.isArray(rows) && rows.length > 0) {
              return candidate;
            }
          }
        } catch (e) {
          // Ignore and try next candidate
        }
      }
      return propertyUrlCandidates[0] || propertyUrl;
    };

    resolvedPropertyUrl = await resolvePropertyUrl();
    let queryUrl = `${supabaseUrl}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(resolvedPropertyUrl)}&order=audit_date.asc&select=audit_date,content_schema_score,visibility_score,authority_score,local_entity_score,service_area_score,brand_score,ai_summary_score,money_pages_behaviour_score,money_pages_summary,money_segment_metrics,schema_total_pages,schema_pages_with_schema,schema_coverage,is_partial`;
    
    if (startDate) {
      queryUrl += `&audit_date=gte.${startDate}`;
    }
    if (endDate) {
      queryUrl += `&audit_date=lte.${endDate}`;
    }
    
    // CRITICAL: Also fetch timeseries data from gsc_timeseries table.
    // NOTE: Money Pages charts compute rolling-28d values at multiple points across the last 28 days,
    // which requires MORE than 28 days of raw daily data (otherwise early points will never have a full
    // 28-day window and will show as "—"). Fetch ~56 days to support this.
    let timeseries = [];
    try {
      const LOOKBACK_DAYS = 56; // enough to compute rolling-28 across multiple points in a 28d view

      // Prefer using the latest available GSC timeseries date from the database.
      // GSC is often 1–2 days behind, so "yesterday" is not always correct.
      let endDateForTimeseries = null;
      try {
        const latestDateQuery = `${supabaseUrl}/rest/v1/gsc_timeseries?property_url=eq.${encodeURIComponent(resolvedPropertyUrl)}&select=date&order=date.desc&limit=1`;
        const latestResp = await fetch(latestDateQuery, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`
          }
        });
        if (latestResp.ok) {
          const latestRows = await latestResp.json();
          const latestDateStr = latestRows && latestRows[0] && latestRows[0].date ? String(latestRows[0].date) : null;
          if (latestDateStr) {
            endDateForTimeseries = new Date(latestDateStr + 'T00:00:00');
          }
        }
      } catch (e) {
        // Ignore and fall back.
      }

      if (!endDateForTimeseries || Number.isNaN(endDateForTimeseries.getTime())) {
        const today = new Date();
        endDateForTimeseries = new Date(today);
        endDateForTimeseries.setDate(endDateForTimeseries.getDate() - 1); // fallback: yesterday
      }

      const startDateForTimeseries = new Date(endDateForTimeseries);
      startDateForTimeseries.setDate(startDateForTimeseries.getDate() - (LOOKBACK_DAYS - 1));
      
      const formatDate = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };
      
      const timeseriesStartDate = formatDate(startDateForTimeseries);
      const timeseriesEndDate = formatDate(endDateForTimeseries);
      
      let timeseriesQuery = `${supabaseUrl}/rest/v1/gsc_timeseries?property_url=eq.${encodeURIComponent(resolvedPropertyUrl)}&date=gte.${timeseriesStartDate}&date=lte.${timeseriesEndDate}&order=date.asc`;
      
      console.log(`[get-audit-history] Fetching timeseries for ${resolvedPropertyUrl} from ${timeseriesStartDate} to ${timeseriesEndDate}`);
      
      const timeseriesResponse = await fetch(timeseriesQuery, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`
        }
      });
      
      if (timeseriesResponse.ok) {
        const timeseriesData = await timeseriesResponse.json();
        timeseries = timeseriesData.map(record => ({
          date: record.date,
          clicks: record.clicks || 0,
          impressions: record.impressions || 0,
          ctr: parseFloat(record.ctr) || 0,
          position: parseFloat(record.position) || 0
        }));
        console.log(`[get-audit-history] Fetched ${timeseries.length} timeseries records for ${resolvedPropertyUrl} (${timeseriesStartDate} to ${timeseriesEndDate})`);
        if (timeseries.length === 0) {
          console.warn(`[get-audit-history] WARNING: No timeseries data found in database for date range ${timeseriesStartDate} to ${timeseriesEndDate}`);
        }
      } else {
        const errorText = await timeseriesResponse.text();
        console.error(`[get-audit-history] Failed to fetch timeseries: ${timeseriesResponse.status} - ${errorText}`);
      }
    } catch (error) {
      console.error('[get-audit-history] Error fetching timeseries data:', error);
      // Continue without timeseries data
    }

    // Fetch from Supabase
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
        message: 'Failed to fetch audit history from Supabase',
        details: errorText,
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    const results = await response.json();

    // Filter results: Include non-partial audits OR partial audits that have money_segment_metrics
    // This ensures we get GSC data even for partial audits (like Dec 15 with 5 pages but valid GSC data)
    const filteredResults = results.filter(record => {
      // Include if not partial
      if (!record.is_partial) return true;
      // Include if partial but has money_segment_metrics (has GSC data)
      if (record.is_partial && record.money_segment_metrics !== null && record.money_segment_metrics !== undefined) {
        return true;
      }
      // Exclude partial audits without money_segment_metrics
      return false;
    });

    // Transform results to match expected format
    const history = filteredResults.map(record => ({
      date: record.audit_date,
      // Content/Schema data
      contentSchemaScore: record.content_schema_score,
      schemaCoverage: record.schema_coverage,
      schemaTotalPages: record.schema_total_pages,
      schemaPagesWithSchema: record.schema_pages_with_schema,
      schemaTypes: record.schema_types || [],
      foundationSchemas: record.schema_foundation || {},
      richEligible: record.schema_rich_eligible || {},
      // Business Profile data (for Local Entity and Service Area historical tracking)
      localEntityScore: record.local_entity_score,
      serviceAreaScore: record.service_area_score,
      napConsistencyScore: record.nap_consistency_score,
      knowledgePanelDetected: record.knowledge_panel_detected,
      serviceAreas: record.service_areas || [],
      locationsCount: record.service_areas ? (record.service_areas.length > 0 ? 1 : 0) : null, // Infer from service_areas data
      // Authority component scores (for historical Authority tracking)
      authorityScore: record.authority_score,
      // Visibility score (for historical Visibility tracking)
      visibilityScore: record.visibility_score,
      authorityBehaviourScore: record.authority_behaviour_score,
      authorityRankingScore: record.authority_ranking_score,
      authorityBacklinkScore: record.authority_backlink_score,
      authorityReviewScore: record.authority_review_score,
      // Segmented Authority scores (new: for building historical segmented data)
      authorityBySegment: record.authority_by_segment || null, // JSON object with {all, nonEducation, money}
      // Brand Overlay data (Phase 1: for trend charting)
      brandScore: record.brand_score || null,
      // Phase 3: Money Pages data (for trend tracking)
      moneyPagesBehaviourScore: record.money_pages_behaviour_score || null,
      moneyPagesSummary: record.money_pages_summary || null,
      // Phase: Money Pages Priority Matrix - segment metrics for KPI tracker
      // Parse JSON if stored as string (Supabase JSONB may return as string)
      moneySegmentMetrics: (() => {
        const metrics = record.money_segment_metrics;
        if (!metrics) return null;
        if (typeof metrics === 'string') {
          try {
            return JSON.parse(metrics);
          } catch (e) {
            console.warn('[get-audit-history] Failed to parse money_segment_metrics JSON:', e.message);
            return null;
          }
        }
        return metrics;
      })(),
      // Include is_partial flag for client-side filtering if needed
      isPartial: record.is_partial || false
    }));

    return res.status(200).json({
      status: 'ok',
      data: history,
      count: history.length,
      timeseries: timeseries, // CRITICAL: Include timeseries data for Score Trends chart
      meta: { generatedAt: new Date().toISOString() }
    });

  } catch (error) {
    console.error('Error fetching audit history:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      details: error.message,
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}


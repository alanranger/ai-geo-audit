// /api/supabase/money-pages-historical.js
// Fetch 90-day average metrics for a money page from historical audits

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';

const need = (k) => {
  const v = process.env[k];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${k}`);
  return v;
};

const sendJSON = (res, status, obj) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(obj));
};

// Normalize URL for comparison
function normalizeUrl(url) {
  if (!url) return '';
  let normalized = String(url).toLowerCase().trim();
  normalized = normalized.replace(/^https?:\/\//, '');
  normalized = normalized.replace(/^www\./, '');
  normalized = normalized.split('?')[0].split('#')[0];
  const parts = normalized.split('/');
  if (parts.length > 1) {
    normalized = parts.slice(1).join('/');
  }
  normalized = normalized.replace(/^\/+/, '').replace(/\/+$/, '');
  return normalized;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return sendJSON(res, 405, { error: `Method not allowed. Expected: GET` });
  }

  try {
    const { property_url, target_url, days = 90 } = req.query;
    
    if (!property_url || !target_url) {
      return sendJSON(res, 400, { error: 'property_url and target_url are required' });
    }
    
    let supabase;
    try {
      supabase = createClient(
        need('SUPABASE_URL'),
        need('SUPABASE_SERVICE_ROLE_KEY')
      );
    } catch (envError) {
      console.error('[Money Pages Historical] Environment variable error:', envError.message);
      return sendJSON(res, 500, { 
        status: 'error',
        error: 'Server configuration error' 
      });
    }

    const targetUrlNormalized = normalizeUrl(target_url);
    const daysNum = parseInt(days, 10) || 90;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysNum);

    // Get latest audit date
    let latestAudit;
    try {
      const { data, error: auditError } = await supabase
        .from('audit_results')
        .select('audit_date')
        .eq('property_url', property_url)
        .order('audit_date', { ascending: false })
        .limit(1)
        .single();
      
      if (auditError || !data) {
        console.error('[Money Pages Historical] Audit query error:', auditError);
        return sendJSON(res, 404, { 
          status: 'error',
          error: 'No audit found for property URL' 
        });
      }
      latestAudit = data;
    } catch (queryError) {
      console.error('[Money Pages Historical] Query exception:', queryError);
      return sendJSON(res, 500, { 
        status: 'error',
        error: 'Database query failed',
        details: queryError.message
      });
    }

    // Normalize target URL for query (same as get-gsc-page-metrics.js)
    const normalizeUrlForQuery = (url, siteUrl) => {
      if (!url || typeof url !== 'string') return '';
      
      let u = url.trim();
      if (u.startsWith("/")) {
        u = (siteUrl || property_url).replace(/\/+$/, '') + u;
      } else if (!u.startsWith("http")) {
        u = (siteUrl || property_url).replace(/\/+$/, '') + "/" + u.replace(/^\/+/, "");
      }
      
      try {
        const urlObj = new URL(u);
        let path = urlObj.pathname || "/";
        if (path.length > 1) path = path.replace(/\/+$/, "");
        return urlObj.origin.toLowerCase() + path;
      } catch {
        return u.split('?')[0].split('#')[0].replace(/\/+$/, '').toLowerCase();
      }
    };

    const normalizedPageUrl = normalizeUrlForQuery(target_url, property_url);
    const targetUrlNormalizedForMatch = normalizeUrl(target_url);

    // Simplified approach: Use money_pages_metrics from latest audit
    // This already contains aggregated 28-day data, which we'll use as a proxy for 90-day
    // (Better than trying to aggregate query_pages which can be huge and cause timeouts)
    let latestAuditWithData;
    try {
      const { data, error: auditError } = await supabase
        .from('audit_results')
        .select('audit_date, money_pages_metrics')
        .eq('property_url', property_url)
        .order('audit_date', { ascending: false })
        .limit(1)
        .single();

      if (auditError || !data) {
        console.error('[Money Pages Historical] Audit data query error:', auditError);
        return sendJSON(res, 404, { 
          status: 'error',
          error: 'No audit data found for property URL' 
        });
      }
      latestAuditWithData = data;
    } catch (queryError) {
      console.error('[Money Pages Historical] Query exception:', queryError);
      return sendJSON(res, 500, { 
        status: 'error',
        error: 'Database query failed',
        details: queryError.message
      });
    }

    let totalClicks = 0;
    let totalImpressions = 0;
    let positionSum = 0;
    let positionWeight = 0;
    let dataPoints = 0;

    // Parse money_pages_metrics and find matching row
    try {
      let moneyPagesMetrics = latestAuditWithData.money_pages_metrics;
      
      if (typeof moneyPagesMetrics === 'string') {
        try {
          moneyPagesMetrics = JSON.parse(moneyPagesMetrics);
        } catch (e) {
          console.warn('[Money Pages Historical] Failed to parse money_pages_metrics JSON:', e.message);
          moneyPagesMetrics = null;
        }
      }

      if (moneyPagesMetrics && moneyPagesMetrics.rows && Array.isArray(moneyPagesMetrics.rows)) {
        const matchingRow = moneyPagesMetrics.rows.find(row => {
          const rowUrl = row.url || row.page_url || '';
          if (!rowUrl) return false;
          
          const rowUrlNormalized = normalizeUrl(rowUrl);
          return rowUrlNormalized === targetUrlNormalizedForMatch || 
                 rowUrl === target_url ||
                 rowUrl.includes(targetUrlNormalizedForMatch) ||
                 targetUrlNormalizedForMatch.includes(rowUrlNormalized);
        });

        if (matchingRow) {
          // Use the latest audit's data as 90-day proxy
          // Note: This is the same as 28-day data, but it's better than nothing
          // True 90-day aggregation would require timeseries data which may not be available
          totalClicks = matchingRow.clicks || matchingRow.clicks_28d || 0;
          totalImpressions = matchingRow.impressions || matchingRow.impressions_28d || 0;
          const position = matchingRow.avg_position || matchingRow.position || matchingRow.avgPosition || null;
          
          if (position != null && totalImpressions > 0) {
            positionSum = position * totalImpressions;
            positionWeight = totalImpressions;
          }
          
          dataPoints = 1;
        }
      }
    } catch (parseError) {
      console.error('[Money Pages Historical] Error parsing money_pages_metrics:', parseError);
      // Continue to return null data rather than crash
    }

    if (dataPoints === 0) {
      return sendJSON(res, 200, {
        status: 'ok',
        data: {
          clicks_90d: null,
          impressions_90d: null,
          ctr_90d: null,
          avg_position_90d: null
        },
        message: 'No historical data found for this URL in money_pages_metrics'
      });
    }

    const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : null;
    const avgPosition = positionWeight > 0 ? positionSum / positionWeight : null;

    return sendJSON(res, 200, {
      status: 'ok',
      data: {
        clicks_90d: totalClicks,
        impressions_90d: totalImpressions,
        ctr_90d: avgCtr,
        avg_position_90d: avgPosition,
        data_points: dataPoints,
        data_source: 'money_pages_metrics',
        note: 'Using latest audit data as proxy (true 90-day aggregation requires timeseries data)'
      },
      audit_date: latestAuditWithData.audit_date
    });

  } catch (err) {
    console.error('[Money Pages Historical] Unhandled error:', err);
    console.error('[Money Pages Historical] Error stack:', err.stack);
    console.error('[Money Pages Historical] Error name:', err.name);
    console.error('[Money Pages Historical] Error message:', err.message);
    
    // Always return 200 with error status to prevent frontend from showing 500
    return sendJSON(res, 200, { 
      status: 'error',
      error: err.message || 'Internal server error',
      data: {
        clicks_90d: null,
        impressions_90d: null,
        ctr_90d: null,
        avg_position_90d: null
      },
      message: 'Failed to retrieve historical data'
    });
  }
}

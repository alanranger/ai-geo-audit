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
    
    const supabase = createClient(
      need('SUPABASE_URL'),
      need('SUPABASE_SERVICE_ROLE_KEY')
    );

    const targetUrlNormalized = normalizeUrl(target_url);
    const daysNum = parseInt(days, 10) || 90;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysNum);

    // Get latest audit date
    const { data: latestAudit, error: auditError } = await supabase
      .from('audit_results')
      .select('audit_date')
      .eq('property_url', property_url)
      .order('audit_date', { ascending: false })
      .limit(1)
      .single();
    
    if (auditError || !latestAudit) {
      return sendJSON(res, 404, { 
        status: 'error',
        error: 'No audit found for property URL' 
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

    // Query gsc_page_metrics_28d for historical snapshots within the date range
    // We'll aggregate multiple 28-day periods to get 90-day average
    // Note: If table doesn't exist yet, return null data gracefully
    let pageMetrics = [];
    let metricsError = null;
    
    try {
      const { data, error } = await supabase
        .from('gsc_page_metrics_28d')
        .select('clicks, impressions, ctr, avg_position, page_url, date_start, date_end, captured_at')
        .eq('site_url', property_url)
        .eq('page_url', normalizedPageUrl)
        .gte('captured_at', cutoffDate.toISOString().split('T')[0])
        .order('captured_at', { ascending: false });
      
      if (error) {
        // Check if it's a "relation does not exist" error
        if (error.message && error.message.includes('does not exist')) {
          console.warn('[Money Pages Historical] Table gsc_page_metrics_28d does not exist yet. Historical data will be available once the table is created.');
          // Return null data instead of error - this is expected until table exists
          return sendJSON(res, 200, {
            status: 'ok',
            data: {
              clicks_90d: null,
              impressions_90d: null,
              ctr_90d: null,
              avg_position_90d: null
            },
            message: 'Historical data table not yet available. 90-day trends will appear once historical audit data is stored in Supabase.'
          });
        }
        metricsError = error;
      } else {
        pageMetrics = data || [];
      }
    } catch (err) {
      // Handle any other errors (network, etc.)
      console.error('[Money Pages Historical] Query exception:', err);
      metricsError = err;
    }

    if (metricsError) {
      console.error('[Money Pages Historical] Query error:', metricsError);
      return sendJSON(res, 500, { 
        status: 'error',
        error: metricsError.message || 'Database query failed'
      });
    }

    const matchingMetrics = pageMetrics || [];

    if (matchingMetrics.length === 0) {
      return sendJSON(res, 200, {
        status: 'ok',
        data: {
          clicks_90d: null,
          impressions_90d: null,
          ctr_90d: null,
          avg_position_90d: null
        },
        message: 'No historical data found for this URL'
      });
    }

    // Aggregate metrics (weighted average for position, sum for clicks/impressions)
    let totalClicks = 0;
    let totalImpressions = 0;
    let positionSum = 0;
    let positionWeight = 0;

    matchingMetrics.forEach(metric => {
      totalClicks += metric.clicks || 0;
      totalImpressions += metric.impressions || 0;
      if (metric.avg_position != null && metric.impressions > 0) {
        positionSum += metric.avg_position * metric.impressions;
        positionWeight += metric.impressions;
      }
    });

    const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : null;
    const avgPosition = positionWeight > 0 ? positionSum / positionWeight : null;

    return sendJSON(res, 200, {
      status: 'ok',
      data: {
        clicks_90d: totalClicks,
        impressions_90d: totalImpressions,
        ctr_90d: avgCtr,
        avg_position_90d: avgPosition,
        periods_count: matchingMetrics.length
      },
      audit_date: latestAudit.audit_date
    });

  } catch (err) {
    console.error('[Money Pages Historical] Error:', err);
    return sendJSON(res, 500, { 
      status: 'error',
      error: err.message 
    });
  }
}

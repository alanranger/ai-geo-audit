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
    const targetUrlNormalizedForMatch = normalizeUrl(target_url);

    // Get latest audit with query_pages data (has page-level metrics)
    const { data: latestAuditWithData, error: auditError } = await supabase
      .from('audit_results')
      .select('audit_date, query_pages, money_pages_metrics')
      .eq('property_url', property_url)
      .order('audit_date', { ascending: false })
      .limit(1)
      .single();

    if (auditError || !latestAuditWithData) {
      console.error('[Money Pages Historical] Audit query error:', auditError);
      return sendJSON(res, 404, { 
        status: 'error',
        error: 'No audit found for property URL' 
      });
    }

    let totalClicks = 0;
    let totalImpressions = 0;
    let positionSum = 0;
    let positionWeight = 0;
    let dataPoints = 0;

    // Try to use query_pages data (has page-level metrics aggregated)
    let queryPages = latestAuditWithData.query_pages;
    if (typeof queryPages === 'string') {
      try {
        queryPages = JSON.parse(queryPages);
      } catch (e) {
        console.warn('[Money Pages Historical] Failed to parse query_pages JSON:', e.message);
        queryPages = null;
      }
    }

    if (Array.isArray(queryPages) && queryPages.length > 0) {
      // Aggregate all query-page pairs for the target URL
      queryPages.forEach(qp => {
        const pageUrl = qp.page || qp.url || '';
        if (!pageUrl) return;
        
        const pageUrlNormalized = normalizeUrl(pageUrl);
        const matches = pageUrlNormalized === targetUrlNormalizedForMatch || 
                       pageUrl === target_url ||
                       pageUrl.includes(targetUrlNormalizedForMatch) ||
                       targetUrlNormalizedForMatch.includes(pageUrlNormalized);
        
        if (matches) {
          const clicks = qp.clicks || 0;
          const impressions = qp.impressions || 0;
          const position = qp.position || qp.avg_position || null;
          
          totalClicks += clicks;
          totalImpressions += impressions;
          
          if (position != null && impressions > 0) {
            positionSum += position * impressions;
            positionWeight += impressions;
          }
          
          dataPoints++;
        }
      });
    }

    // Fallback: If no query_pages data or no matches, use money_pages_metrics from oldest audit in range
    if (dataPoints === 0) {
      const { data: audits, error: auditsError } = await supabase
        .from('audit_results')
        .select('audit_date, money_pages_metrics')
        .eq('property_url', property_url)
        .gte('audit_date', cutoffDate.toISOString().split('T')[0])
        .order('audit_date', { ascending: true }) // Get oldest first
        .limit(1);

      if (!auditsError && audits && audits.length > 0) {
        const oldestAudit = audits[0];
        let moneyPagesMetrics = oldestAudit.money_pages_metrics;
        
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
            const rowUrlNormalized = normalizeUrl(rowUrl);
            return rowUrlNormalized === targetUrlNormalizedForMatch || 
                   rowUrl === target_url ||
                   rowUrl.includes(targetUrlNormalizedForMatch) ||
                   targetUrlNormalizedForMatch.includes(rowUrlNormalized);
          });

          if (matchingRow) {
            // Use the oldest audit's data as a proxy for 90-day average
            // This is less accurate but better than summing overlapping periods
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
      }
    }

    // Add comprehensive error logging
    if (dataPoints === 0) {
      console.warn('[Money Pages Historical] No data found:', {
        target_url,
        targetUrlNormalizedForMatch,
        hasQueryPages: !!queryPages,
        queryPagesLength: Array.isArray(queryPages) ? queryPages.length : 0
      });
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
        message: 'No historical data found for this URL'
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
        data_source: dataPoints > 1 ? 'timeseries' : 'single_audit'
      },
      audit_date: latestAuditWithData.audit_date
    });

  } catch (err) {
    console.error('[Money Pages Historical] Unhandled error:', err);
    console.error('[Money Pages Historical] Error stack:', err.stack);
    return sendJSON(res, 500, { 
      status: 'error',
      error: err.message || 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
}

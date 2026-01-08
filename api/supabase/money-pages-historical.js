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

    // Query audit_results for historical audits within the date range
    // Each audit contains money_pages_metrics with rows array - we'll aggregate across audits
    const { data: audits, error: auditsError } = await supabase
      .from('audit_results')
      .select('audit_date, money_pages_metrics, updated_at')
      .eq('property_url', property_url)
      .gte('audit_date', cutoffDate.toISOString().split('T')[0])
      .order('audit_date', { ascending: false });

    if (auditsError) {
      console.error('[Money Pages Historical] Query error:', auditsError);
      return sendJSON(res, 500, { 
        status: 'error',
        error: auditsError.message || 'Database query failed'
      });
    }

    if (!audits || audits.length === 0) {
      return sendJSON(res, 200, {
        status: 'ok',
        data: {
          clicks_90d: null,
          impressions_90d: null,
          ctr_90d: null,
          avg_position_90d: null
        },
        message: 'No historical audit data found for this property URL'
      });
    }

    // Aggregate metrics from money_pages_metrics across all audits
    let totalClicks = 0;
    let totalImpressions = 0;
    let positionSum = 0;
    let positionWeight = 0;
    let auditCount = 0;

    audits.forEach(audit => {
      let moneyPagesMetrics = audit.money_pages_metrics;
      
      // Parse JSON if stored as string
      if (typeof moneyPagesMetrics === 'string') {
        try {
          moneyPagesMetrics = JSON.parse(moneyPagesMetrics);
        } catch (e) {
          console.warn('[Money Pages Historical] Failed to parse money_pages_metrics JSON:', e.message);
          return; // Skip this audit
        }
      }

      if (!moneyPagesMetrics || !moneyPagesMetrics.rows || !Array.isArray(moneyPagesMetrics.rows)) {
        return; // Skip if no rows
      }

      // Find matching row for this URL
      const matchingRow = moneyPagesMetrics.rows.find(row => {
        const rowUrl = row.url || row.page_url || '';
        const rowUrlNormalized = normalizeUrl(rowUrl);
        return rowUrlNormalized === targetUrlNormalizedForMatch || 
               rowUrl === target_url ||
               rowUrl.includes(targetUrlNormalizedForMatch);
      });

      if (matchingRow) {
        const clicks = matchingRow.clicks || matchingRow.clicks_28d || 0;
        const impressions = matchingRow.impressions || matchingRow.impressions_28d || 0;
        const position = matchingRow.avg_position || matchingRow.position || matchingRow.avgPosition || null;

        totalClicks += clicks;
        totalImpressions += impressions;
        
        if (position != null && impressions > 0) {
          positionSum += position * impressions;
          positionWeight += impressions;
        }
        
        auditCount++;
      }
    });

    if (auditCount === 0) {
      return sendJSON(res, 200, {
        status: 'ok',
        data: {
          clicks_90d: null,
          impressions_90d: null,
          ctr_90d: null,
          avg_position_90d: null
        },
        message: 'No historical data found for this URL in any audits'
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
        periods_count: auditCount,
        audits_aggregated: auditCount
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

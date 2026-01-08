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

    // Pull audits (with timeseries) within the 90d window, order newest-first
    let audits = [];
    try {
      const { data, error: auditError } = await supabase
        .from('audit_results')
        .select('audit_date, gsc_timeseries, money_pages_metrics')
        .eq('property_url', property_url)
        .order('audit_date', { ascending: false });

      if (auditError || !data || data.length === 0) {
        console.error('[Money Pages Historical] Audit data query error:', auditError);
        return sendJSON(res, 404, { 
          status: 'error',
          error: 'No audit data found for property URL' 
        });
      }
      audits = data;
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

    // Deduplicate by date to avoid double counting the same day across multiple audits
    const dailyMap = new Map(); // key: date -> { clicks, impressions, position }

    try {
      for (const audit of audits) {
        if (!audit?.gsc_timeseries) continue;
        let ts = audit.gsc_timeseries;
        if (typeof ts === 'string') {
          try { ts = JSON.parse(ts); } catch { ts = null; }
        }
        if (!Array.isArray(ts)) continue;

        ts.forEach(entry => {
          const dateStr = entry?.date || entry?.day || entry?.created_at || entry?.updated_at || null;
          const url = entry?.url || entry?.page || entry?.page_url || entry?.target_url || '';
          if (!dateStr || !url) return;

          const d = new Date(dateStr);
          if (Number.isNaN(d.getTime())) return;
          if (d < cutoffDate) return; // outside window

          const normalized = normalizeUrl(url);
          if (!normalized) return;
          const matches = normalized === targetUrlNormalizedForMatch ||
                          normalized.includes(targetUrlNormalizedForMatch) ||
                          targetUrlNormalizedForMatch.includes(normalized);
          if (!matches) return;

          // Use newest audit first; if date already present, skip to avoid double count
          if (dailyMap.has(dateStr)) return;

          const clicks = Number(entry.clicks || entry.clicks_28d || 0);
          const impr = Number(entry.impressions || entry.impressions_28d || 0);
          const pos = entry.position != null ? Number(entry.position) :
                      entry.avg_position != null ? Number(entry.avg_position) :
                      entry.avgPosition != null ? Number(entry.avgPosition) : null;

          dailyMap.set(dateStr, { clicks, impr, pos });
        });
      }
    } catch (parseErr) {
      console.error('[Money Pages Historical] Error processing timeseries:', parseErr);
    }

    dailyMap.forEach(({ clicks, impr, pos }) => {
      totalClicks += clicks || 0;
      totalImpressions += impr || 0;
      if (pos != null && impr > 0) {
        positionSum += pos * impr;
        positionWeight += impr;
      }
      dataPoints += 1;
    });

    // If no timeseries data matched, fallback to latest audit money_pages_metrics as a proxy
    if (dataPoints === 0) {
      const latestAuditWithData = audits[0];
      try {
        let moneyPagesMetrics = latestAuditWithData.money_pages_metrics;
        if (typeof moneyPagesMetrics === 'string') {
          try { moneyPagesMetrics = JSON.parse(moneyPagesMetrics); } catch { moneyPagesMetrics = null; }
        }

        if (moneyPagesMetrics?.rows && Array.isArray(moneyPagesMetrics.rows)) {
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
        console.error('[Money Pages Historical] Fallback parse error:', parseError);
      }
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
        message: 'No historical data found for this URL in timeseries or money_pages_metrics'
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
        data_source: dailyMap.size > 0 ? 'gsc_timeseries' : 'money_pages_metrics',
        note: dailyMap.size > 0 
          ? 'Aggregated from daily timeseries (no double-counting across audits)'
          : 'Fallback to latest audit 28-day metrics as proxy (no timeseries data)'
      },
      audit_date: audits[0]?.audit_date || null
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

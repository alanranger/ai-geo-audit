// /api/supabase/money-pages-historical.js
// Fetch 90-day average metrics for a money page from historical audits

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { isRowIndexable } from '../../lib/page-indexability-policy.js';

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

function slugFromTargetUrl(targetUrl) {
  const n = normalizeUrl(targetUrl);
  return n || '';
}

async function fetchPolicyForSlug(supabase, propertyUrl, slug) {
  const { data, error } = await supabase
    .from('revenue_gsc_joined_with_policy')
    .select('policy_value, policy_effective_date')
    .eq('property_url', propertyUrl)
    .eq('page_slug', slug)
    .order('period_start', { ascending: false })
    .limit(1);
  if (error || !data?.length) return { policy_value: null, policy_effective_date: null };
  return {
    policy_value: data[0].policy_value ?? null,
    policy_effective_date: data[0].policy_effective_date ?? null
  };
}

function periodStartFromDate(dateStr) {
  return `${String(dateStr).slice(0, 7)}-01`;
}

function policyRowForDay(targetUrl, propertyUrl, dateStr, policy) {
  return {
    page_url: targetUrl,
    property_url: propertyUrl,
    period_start: periodStartFromDate(dateStr),
    policy_value: policy.policy_value,
    policy_effective_date: policy.policy_effective_date
  };
}

function aggregateDailyMap(dailyMap, targetUrl, propertyUrl, policy) {
  let totalClicks = 0;
  let totalImpressions = 0;
  let positionSum = 0;
  let positionWeight = 0;
  let dataPoints = 0;
  let idxClicks = 0;
  let idxImpressions = 0;
  let idxPosSum = 0;
  let idxPosWeight = 0;
  let idxPoints = 0;

  dailyMap.forEach(({ clicks, impr, pos }, dateStr) => {
    totalClicks += clicks || 0;
    totalImpressions += impr || 0;
    if (pos != null && impr > 0) {
      positionSum += pos * impr;
      positionWeight += impr;
    }
    dataPoints += 1;
    if (!isRowIndexable(policyRowForDay(targetUrl, propertyUrl, dateStr, policy))) return;
    idxClicks += clicks || 0;
    idxImpressions += impr || 0;
    if (pos != null && impr > 0) {
      idxPosSum += pos * impr;
      idxPosWeight += impr;
    }
    idxPoints += 1;
  });

  return {
    totalClicks,
    totalImpressions,
    positionSum,
    positionWeight,
    dataPoints,
    idxClicks,
    idxImpressions,
    idxPosSum,
    idxPosWeight,
    idxPoints
  };
}

function buildAggregatePayload(totals) {
  const avgCtr = totals.totalImpressions > 0 ? (totals.totalClicks / totals.totalImpressions) * 100 : null;
  const avgPosition = totals.positionWeight > 0 ? totals.positionSum / totals.positionWeight : null;
  const idxCtr = totals.idxImpressions > 0 ? (totals.idxClicks / totals.idxImpressions) * 100 : null;
  const idxPosition = totals.idxPosWeight > 0 ? totals.idxPosSum / totals.idxPosWeight : null;
  return {
    clicks_90d: totals.totalClicks,
    impressions_90d: totals.totalImpressions,
    ctr_90d: avgCtr,
    avg_position_90d: avgPosition,
    clicks_90d_indexable: totals.idxClicks,
    impressions_90d_indexable: totals.idxImpressions,
    ctr_90d_indexable: idxCtr,
    avg_position_90d_indexable: idxPosition,
    data_points: totals.dataPoints,
    data_points_indexable: totals.idxPoints,
    rows_total_count: totals.dataPoints,
    rows_indexable_count: totals.idxPoints
  };
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

    const policy = await fetchPolicyForSlug(supabase, property_url, slugFromTargetUrl(target_url));

    // Deduplicate by date to avoid double counting the same day across multiple audits
    const dailyMap = new Map(); // key: date -> { clicks, impressions, position }
    let fromTimeseries = false;

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
          
          // Strict URL matching: exact match or same path segments (not substring matching)
          // This prevents matching "landscape-photography-workshops" when looking for "photography-workshops"
          const targetPathParts = targetUrlNormalizedForMatch.split('/').filter(p => p);
          const normalizedPathParts = normalized.split('/').filter(p => p);
          
          // Exact match
          let matches = normalized === targetUrlNormalizedForMatch;
          
          // If not exact, check if path segments match exactly (same depth, same segments)
          if (!matches && targetPathParts.length > 0 && normalizedPathParts.length === targetPathParts.length) {
            matches = targetPathParts.every((part, idx) => normalizedPathParts[idx] === part);
          }
          
          // Also allow matching if one is a prefix of the other at path segment level
          // (e.g., "photography-workshops" matches "photography-workshops/something")
          if (!matches) {
            const shorter = targetPathParts.length <= normalizedPathParts.length ? targetPathParts : normalizedPathParts;
            const longer = targetPathParts.length > normalizedPathParts.length ? targetPathParts : normalizedPathParts;
            if (shorter.length > 0 && longer.length >= shorter.length) {
              matches = shorter.every((part, idx) => longer[idx] === part);
            }
          }
          
          if (!matches) return;

          // Use newest audit first; if date already present, skip to avoid double count
          if (dailyMap.has(dateStr)) return;

          const clicks = Number(entry.clicks || entry.clicks_28d || 0);
          const impr = Number(entry.impressions || entry.impressions_28d || 0);
          const pos = entry.position != null ? Number(entry.position) :
                      entry.avg_position != null ? Number(entry.avg_position) :
                      entry.avgPosition != null ? Number(entry.avgPosition) : null;

          dailyMap.set(dateStr, { clicks, impr, pos });
          fromTimeseries = true;
        });
      }
    } catch (parseErr) {
      console.error('[Money Pages Historical] Error processing timeseries:', parseErr);
    }

    // If no timeseries data matched, fallback to latest audit money_pages_metrics as a proxy
    if (dailyMap.size === 0) {
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
            
            // Exact match first
            if (rowUrlNormalized === targetUrlNormalizedForMatch || rowUrl === target_url) {
              return true;
            }
            
            // Strict path segment matching (same logic as timeseries matching)
            const targetPathParts = targetUrlNormalizedForMatch.split('/').filter(p => p);
            const rowPathParts = rowUrlNormalized.split('/').filter(p => p);
            
            if (targetPathParts.length > 0 && rowPathParts.length === targetPathParts.length) {
              return targetPathParts.every((part, idx) => rowPathParts[idx] === part);
            }
            
            // Prefix matching at path segment level
            if (targetPathParts.length > 0 && rowPathParts.length >= targetPathParts.length) {
              return targetPathParts.every((part, idx) => rowPathParts[idx] === part);
            }
            
            return false;
          });

          if (matchingRow) {
            const auditDate = String(latestAuditWithData.audit_date || '').slice(0, 10)
              || new Date().toISOString().slice(0, 10);
            const clicks = matchingRow.clicks || matchingRow.clicks_28d || 0;
            const impr = matchingRow.impressions || matchingRow.impressions_28d || 0;
            const position = matchingRow.avg_position || matchingRow.position || matchingRow.avgPosition || null;
            dailyMap.set(auditDate, { clicks, impr, pos: position });
          }
        }
      } catch (parseError) {
        console.error('[Money Pages Historical] Fallback parse error:', parseError);
      }
    }

    if (dailyMap.size === 0) {
      return sendJSON(res, 200, {
        status: 'ok',
        data: {
          clicks_90d: null,
          impressions_90d: null,
          ctr_90d: null,
          avg_position_90d: null,
          clicks_90d_indexable: null,
          impressions_90d_indexable: null,
          ctr_90d_indexable: null,
          avg_position_90d_indexable: null,
          rows_total_count: 0,
          rows_indexable_count: 0
        },
        message: 'No historical data found for this URL in timeseries or money_pages_metrics'
      });
    }

    const totals = aggregateDailyMap(dailyMap, target_url, property_url, policy);
    const payload = buildAggregatePayload(totals);

    return sendJSON(res, 200, {
      status: 'ok',
      data: {
        ...payload,
        data_source: fromTimeseries ? 'gsc_timeseries' : 'money_pages_metrics',
        note: fromTimeseries
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

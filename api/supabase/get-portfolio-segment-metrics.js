// /api/supabase/get-portfolio-segment-metrics.js
// Fetch portfolio segment-level 28d metrics from Supabase

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

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return sendJSON(res, 405, { error: `Method not allowed. Received: ${req.method}, Expected: GET` });
  }

  try {
    const { 
      siteUrl,
      scope,
      segment,
      from,
      to,
      limit,
      order = 'desc' // 'asc' for chart (chronological), 'desc' for latest
    } = req.query;

    if (!siteUrl) {
      return sendJSON(res, 400, { 
        error: 'Missing required field: siteUrl' 
      });
    }

    const supabase = createClient(
      need('SUPABASE_URL'),
      need('SUPABASE_SERVICE_ROLE_KEY')
    );

    const toDateOnly = (v) => {
      if (!v) return null;
      const s = String(v);
      // Accept ISO strings and YYYY-MM-DD; normalize to YYYY-MM-DD when possible
      if (s.length >= 10) return s.slice(0, 10);
      return s;
    };

    // Build query
    let query = supabase
      .from('portfolio_segment_metrics_28d')
      .select('*')
      .eq('site_url', siteUrl);

    // Apply filters
    if (scope) {
      query = query.eq('scope', scope);
    }
    if (segment) {
      query = query.eq('segment', segment);
    }
    // IMPORTANT:
    // - Use date_end for filtering and ordering so time-series charts/table align to the actual GSC period.
    // - created_at can be "now" for backfilled history, which collapses weekly bucketing into a single week.
    const fromDate = toDateOnly(from);
    const toDate = toDateOnly(to);
    if (fromDate) query = query.gte('date_end', fromDate);
    if (toDate) query = query.lte('date_end', toDate);

    // Order by date_end first (actual period), then created_at (tie-break)
    query = query
      .order('date_end', { ascending: order === 'asc' })
      .order('created_at', { ascending: order === 'asc' });

    // Limit results
    if (limit) {
      const limitNum = parseInt(limit, 10);
      if (limitNum > 0) {
        query = query.limit(limitNum);
      }
    }

    const { data, error } = await query;

    if (error) {
      console.error('[Get Portfolio Segment Metrics] Query error:', error);
      // If table doesn't exist yet, return empty array instead of 500
      if (error.message && error.message.includes('does not exist')) {
        return sendJSON(res, 200, { 
          metrics: [],
          count: 0,
          message: 'Table not found - migration may not be applied yet'
        });
      }
      return sendJSON(res, 500, { error: error.message });
    }

    return sendJSON(res, 200, { 
      metrics: data || [],
      count: data?.length || 0
    });

  } catch (err) {
    console.error('[Get Portfolio Segment Metrics] Error:', err);
    // If table doesn't exist yet, return empty array instead of 500
    if (err.message && err.message.includes('does not exist')) {
      return sendJSON(res, 200, { 
        metrics: [],
        count: 0,
        message: 'Table not found - migration may not be applied yet'
      });
    }
    return sendJSON(res, 500, { error: err.message });
  }
}


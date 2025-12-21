// /api/supabase/get-gsc-page-metrics.js
// Fetch GSC page-level 28d metrics from Supabase

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
      runId,
      siteUrl,
      dateStart,
      dateEnd,
      pageUrl
    } = req.query;

    const supabase = createClient(
      need('SUPABASE_URL'),
      need('SUPABASE_SERVICE_ROLE_KEY')
    );

    // Build query
    let query = supabase
      .from('gsc_page_metrics_28d')
      .select('*')
      .order('captured_at', { ascending: false });

    // Apply filters
    if (runId) {
      query = query.eq('run_id', runId);
    }
    if (siteUrl) {
      query = query.eq('site_url', siteUrl);
    }
    if (dateStart) {
      query = query.eq('date_start', dateStart);
    }
    if (dateEnd) {
      query = query.eq('date_end', dateEnd);
    }
    // Normalize pageUrl if provided (matches frontend normalizeGscPageKey)
    // Frontend normalizeGscPageKey returns full URL with origin (e.g., "https://www.alanranger.com/path")
    if (pageUrl) {
      const normalizeUrl = (url, siteUrl) => {
        if (!url || typeof url !== 'string') return '';
        
        // Handle path-only URLs
        let u = url.trim();
        if (u.startsWith("/")) {
          u = (siteUrl || 'https://www.alanranger.com').replace(/\/+$/, '') + u;
        } else if (!u.startsWith("http")) {
          u = (siteUrl || 'https://www.alanranger.com').replace(/\/+$/, '') + "/" + u.replace(/^\/+/, "");
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
      query = query.eq('page_url', normalizeUrl(pageUrl, siteUrl));
    }

    // If no runId specified, get latest snapshot (most recent captured_at)
    if (!runId && !dateStart) {
      // Get the most recent date range first
      const { data: latestRange } = await supabase
        .from('gsc_page_metrics_28d')
        .select('date_start, date_end, captured_at')
        .eq('site_url', siteUrl || '')
        .order('captured_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestRange) {
        query = query
          .eq('date_start', latestRange.date_start)
          .eq('date_end', latestRange.date_end);
      }
    }

    const { data, error } = await query;

    if (error) {
      console.error('[Get GSC Page Metrics] Query error:', error);
      return sendJSON(res, 500, { error: error.message });
    }

    return sendJSON(res, 200, { 
      pages: data || [],
      count: data?.length || 0
    });

  } catch (err) {
    console.error('[Get GSC Page Metrics] Error:', err);
    return sendJSON(res, 500, { error: err.message });
  }
}


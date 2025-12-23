// /api/supabase/save-gsc-page-metrics.js
// Save GSC page-level 28d metrics to Supabase

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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(obj));
};

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return sendJSON(res, 405, { error: `Method not allowed. Received: ${req.method}, Expected: POST` });
  }

  try {
    const { 
      runId,
      siteUrl,
      dateStart,
      dateEnd,
      pages = []
    } = req.body;

    if (!runId || !siteUrl || !dateStart || !dateEnd) {
      return sendJSON(res, 400, { 
        error: 'Missing required fields: runId, siteUrl, dateStart, dateEnd' 
      });
    }

    const supabase = createClient(
      need('SUPABASE_URL'),
      need('SUPABASE_SERVICE_ROLE_KEY')
    );

    // Normalize URLs for consistency (matches frontend normalizeGscPageKey)
    // Frontend normalizeGscPageKey returns origin + path (e.g., "https://www.alanranger.com/path")
    // We store the full normalized URL (with origin) for consistency
    const normalizeUrl = (url) => {
      if (!url || typeof url !== 'string') return '';
      
      // Handle path-only URLs
      let u = url.trim();
      if (u.startsWith("/")) {
        u = siteUrl.replace(/\/+$/, '') + u;
      } else if (!u.startsWith("http")) {
        u = siteUrl.replace(/\/+$/, '') + "/" + u.replace(/^\/+/, "");
      }
      
      try {
        const urlObj = new URL(u);
        let path = urlObj.pathname || "/";
        // Remove trailing slash (except root)
        if (path.length > 1) path = path.replace(/\/+$/, "");
        // Return origin + path (matches frontend normalizeGscPageKey)
        return urlObj.origin.toLowerCase() + path;
      } catch {
        // Fallback: remove query, fragment, trailing slash, keep protocol
        return u.split('?')[0].split('#')[0].replace(/\/+$/, '').toLowerCase();
      }
    };
    
    // IMPORTANT:
    // GSC page dimension can contain URL variants (query params, trailing slashes, etc).
    // We normalize to a canonical URL, but we MUST aggregate metrics across variants rather than overwriting.
    const agg = new Map(); // normalizedUrl -> { url, clicks, impressions, posWeight, posImpr }

    for (const page of pages) {
      const rawUrl = page.page_url || page.url || '';
      const normalizedUrl = normalizeUrl(rawUrl);
      if (!normalizedUrl) continue;

      const clicks = parseFloat(page.clicks || 0) || 0;
      const impressions = parseFloat(page.impressions || 0) || 0;
      const pos = (page.position !== null && page.position !== undefined && !isNaN(parseFloat(page.position)) && parseFloat(page.position) > 0)
        ? parseFloat(page.position)
        : null;

      const existing = agg.get(normalizedUrl) || { url: rawUrl, clicks: 0, impressions: 0, posWeight: 0, posImpr: 0 };
      existing.clicks += clicks;
      existing.impressions += impressions;
      if (pos !== null && impressions > 0) {
        existing.posWeight += pos * impressions;
        existing.posImpr += impressions;
      }
      // Prefer first-seen raw URL for reference
      if (!existing.url) existing.url = rawUrl;
      agg.set(normalizedUrl, existing);
    }

    // Prepare rows for bulk upsert
    const rows = Array.from(agg.entries()).map(([normalizedUrl, a]) => {
      const ctr = a.impressions > 0 ? (a.clicks / a.impressions) : 0;
      const position = a.posImpr > 0 ? (a.posWeight / a.posImpr) : null;
      return {
        run_id: runId,
        site_url: siteUrl,
        page_url: normalizedUrl,
        date_start: dateStart,
        date_end: dateEnd,
        clicks_28d: a.clicks,
        impressions_28d: a.impressions,
        ctr_28d: ctr, // ratio (0-1)
        position_28d: position
      };
    });

    // Upsert in batches (Supabase has limits on batch size)
    const batchSize = 1000;
    let inserted = 0;
    let errors = [];

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      
      const { error } = await supabase
        .from('gsc_page_metrics_28d')
        .upsert(batch, {
          onConflict: 'run_id,page_url',
          ignoreDuplicates: false
        });

      if (error) {
        console.error(`[Save GSC Page Metrics] Batch ${i / batchSize + 1} error:`, error);
        errors.push({ batch: i / batchSize + 1, error: error.message });
      } else {
        inserted += batch.length;
      }
    }

    if (errors.length > 0 && inserted === 0) {
      return sendJSON(res, 500, { 
        error: 'Failed to save page metrics',
        details: errors
      });
    }

    return sendJSON(res, 200, { 
      inserted,
      total: rows.length,
      errors: errors.length > 0 ? errors : null,
      message: `Saved ${inserted} page metrics (${errors.length} batch errors)`
    });

  } catch (err) {
    console.error('[Save GSC Page Metrics] Error:', err);
    return sendJSON(res, 500, { error: err.message });
  }
}


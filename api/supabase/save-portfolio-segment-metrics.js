// /api/supabase/save-portfolio-segment-metrics.js
// Save portfolio segment-level 28d metrics to Supabase

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
      siteUrl,
      runId,
      dateStart,
      dateEnd,
      scope,
      rows = []
    } = req.body;

    if (!siteUrl || !runId || !dateStart || !dateEnd || !scope) {
      return sendJSON(res, 400, { 
        error: 'Missing required fields: siteUrl, runId, dateStart, dateEnd, scope' 
      });
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      return sendJSON(res, 400, { 
        error: 'rows array is required and must not be empty' 
      });
    }

    const supabase = createClient(
      need('SUPABASE_URL'),
      need('SUPABASE_SERVICE_ROLE_KEY')
    );

    // Prepare rows for upsert
    const insertRows = rows.map(row => {
      const positionValue = row.position_28d !== null && row.position_28d !== undefined 
        ? parseFloat(row.position_28d) 
        : null;
      
      // Log position values for debugging
      if (row.segment === 'money' || row.segment === 'landing') {
        console.log(`[Save Portfolio Segment Metrics] ${row.segment}: position_28d=${row.position_28d} (raw), parsed=${positionValue}, pages=${row.pages_count}, impressions=${row.impressions_28d}`);
      }
      
      return {
        run_id: runId,
        site_url: siteUrl,
        segment: row.segment,
        scope: scope,
        date_start: dateStart,
        date_end: dateEnd,
        pages_count: parseInt(row.pages_count || 0, 10),
        clicks_28d: parseFloat(row.clicks_28d || 0),
        impressions_28d: parseFloat(row.impressions_28d || 0),
        ctr_28d: parseFloat(row.ctr_28d || 0), // Already a ratio (0-1)
        position_28d: positionValue,
        ai_citations_28d: parseInt(row.ai_citations_28d || 0, 10),
        ai_overview_present_count: parseInt(row.ai_overview_present_count || 0, 10)
      };
    });

    // Batch upsert in chunks of 500
    const BATCH_SIZE = 500;
    let totalInserted = 0;
    let totalUpdated = 0;

    for (let i = 0; i < insertRows.length; i += BATCH_SIZE) {
      const batch = insertRows.slice(i, i + BATCH_SIZE);
      
      const { data, error } = await supabase
        .from('portfolio_segment_metrics_28d')
        .upsert(batch, {
          onConflict: 'run_id,site_url,segment,scope',
          ignoreDuplicates: false
        })
        .select();

      if (error) {
        console.error('[Save Portfolio Segment Metrics] Upsert error:', error);
        // If table doesn't exist yet, log warning but don't fail the audit
        if (error.message && error.message.includes('does not exist')) {
          console.warn('[Save Portfolio Segment Metrics] Table not found - migration may not be applied yet. Skipping save.');
          return sendJSON(res, 200, { 
            success: true,
            inserted: 0,
            message: 'Table not found - migration may not be applied yet. Segment metrics not saved.',
            warning: true
          });
        }
        throw error;
      }

      // Count inserted vs updated (upsert doesn't distinguish, so we'll just count total)
      totalInserted += batch.length;
      console.log(`[Save Portfolio Segment Metrics] Batch ${i / BATCH_SIZE + 1}: Upserted ${batch.length} rows (runId=${runId}, segments=${batch.map(r => r.segment).join(', ')})`);
    }

    console.log(`[Save Portfolio Segment Metrics] Total upserted: ${totalInserted} rows for runId=${runId}, siteUrl=${siteUrl}, scope=${scope}`);
    
    return sendJSON(res, 200, { 
      success: true,
      inserted: totalInserted,
      message: `Upserted ${totalInserted} portfolio segment metrics`,
      runId: runId,
      siteUrl: siteUrl,
      scope: scope
    });

  } catch (err) {
    console.error('[Save Portfolio Segment Metrics] Error:', err);
    return sendJSON(res, 500, { error: err.message });
  }
}


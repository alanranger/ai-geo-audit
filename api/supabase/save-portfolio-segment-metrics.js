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

    // Calibrate segment totals to GSC overview/date totals (via cached gsc_timeseries).
    // This keeps month backfills (which are calibrated) and daily runs consistent.
    let scaleClicks = 1;
    let scaleImpressions = 1;
    try {
      const { data: tsRows, error: tsErr } = await supabase
        .from('gsc_timeseries')
        .select('clicks, impressions')
        .eq('property_url', siteUrl)
        .gte('date', String(dateStart).slice(0, 10))
        .lte('date', String(dateEnd).slice(0, 10));

      if (tsErr) {
        console.warn('[Save Portfolio Segment Metrics] gsc_timeseries query error (skipping calibration):', tsErr.message);
      } else if (tsRows && tsRows.length > 0) {
        const overviewClicks = tsRows.reduce((s, r) => s + (parseFloat(r.clicks) || 0), 0);
        const overviewImpr = tsRows.reduce((s, r) => s + (parseFloat(r.impressions) || 0), 0);
        const moneyRow = rows.find(r => r.segment === 'money');
        const rawClicks = moneyRow ? (parseFloat(moneyRow.clicks_28d) || 0) : 0;
        const rawImpr = moneyRow ? (parseFloat(moneyRow.impressions_28d) || 0) : 0;
        if (overviewClicks > 0 && rawClicks > 0) scaleClicks = overviewClicks / rawClicks;
        if (overviewImpr > 0 && rawImpr > 0) scaleImpressions = overviewImpr / rawImpr;
        console.log(`[Save Portfolio Segment Metrics] Calibration scales: clicks=${scaleClicks.toFixed(4)}, impressions=${scaleImpressions.toFixed(4)} (overviewImpr=${overviewImpr}, rawImpr=${rawImpr})`);
      }
    } catch (calErr) {
      console.warn('[Save Portfolio Segment Metrics] Calibration error (skipping):', calErr.message);
    }

    // Prepare rows for upsert (apply calibration)
    const insertRows = rows.map(row => {
      const positionValue = row.position_28d !== null && row.position_28d !== undefined 
        ? parseFloat(row.position_28d) 
        : null;
      
      // Log position values for debugging
      if (row.segment === 'money' || row.segment === 'landing') {
        console.log(`[Save Portfolio Segment Metrics] ${row.segment}: position_28d=${row.position_28d} (raw), parsed=${positionValue}, pages=${row.pages_count}, impressions=${row.impressions_28d}`);
      }
      
      const rawClicks = parseFloat(row.clicks_28d || 0);
      const rawImpressions = parseFloat(row.impressions_28d || 0);
      const scaledClicks = rawClicks * scaleClicks;
      const scaledImpressions = rawImpressions * scaleImpressions;
      const scaledCtr = scaledImpressions > 0 ? (scaledClicks / scaledImpressions) : 0;

      return {
        run_id: runId,
        site_url: siteUrl,
        segment: row.segment,
        scope: scope,
        date_start: dateStart,
        date_end: dateEnd,
        pages_count: parseInt(row.pages_count || 0, 10),
        clicks_28d: scaledClicks,
        impressions_28d: scaledImpressions,
        ctr_28d: scaledCtr, // ratio (0-1)
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


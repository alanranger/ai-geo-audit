// /api/supabase/diagnose-portfolio-segments.js
// Diagnostic endpoint to check portfolio_segment_metrics_28d table

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
  res.status(status).send(JSON.stringify(obj, null, 2));
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return sendJSON(res, 405, { error: 'Method not allowed. Use GET.' });
  }

  try {
    const { siteUrl } = req.query;
    const supabase = createClient(
      need('SUPABASE_URL'),
      need('SUPABASE_SERVICE_ROLE_KEY')
    );

    // Get all records for this site
    let query = supabase
      .from('portfolio_segment_metrics_28d')
      .select('*')
      .order('created_at', { ascending: false });

    if (siteUrl) {
      query = query.eq('site_url', siteUrl);
    }

    const { data, error } = await query;

    if (error) {
      if (error.message && error.message.includes('does not exist')) {
        return sendJSON(res, 200, {
          error: 'Table does not exist',
          message: 'portfolio_segment_metrics_28d table not found. Migration may not be applied.',
          suggestion: 'Run the migration: 20251222_portfolio_segment_metrics_28d.sql'
        });
      }
      return sendJSON(res, 500, { error: error.message });
    }

    // Group by run_id and segment for analysis
    const byRunId = {};
    const bySegment = {};
    const byScope = {};
    const dateRanges = [];

    (data || []).forEach(row => {
      // Group by run_id
      if (!byRunId[row.run_id]) {
        byRunId[row.run_id] = [];
      }
      byRunId[row.run_id].push(row);

      // Group by segment
      if (!bySegment[row.segment]) {
        bySegment[row.segment] = [];
      }
      bySegment[row.segment].push(row);

      // Group by scope
      if (!byScope[row.scope]) {
        byScope[row.scope] = [];
      }
      byScope[row.scope].push(row);

      // Collect date ranges
      dateRanges.push({
        run_id: row.run_id,
        created_at: row.created_at,
        date_start: row.date_start,
        date_end: row.date_end
      });
    });

    return sendJSON(res, 200, {
      total_records: data?.length || 0,
      site_url_filter: siteUrl || 'all sites',
      summary: {
        unique_run_ids: Object.keys(byRunId).length,
        unique_segments: Object.keys(bySegment).length,
        unique_scopes: Object.keys(byScope).length,
        run_ids: Object.keys(byRunId).sort(),
        segments: Object.keys(bySegment).sort(),
        scopes: Object.keys(byScope).sort()
      },
      by_run_id: Object.keys(byRunId).reduce((acc, runId) => {
        acc[runId] = {
          count: byRunId[runId].length,
          segments: [...new Set(byRunId[runId].map(r => r.segment))],
          created_at: byRunId[runId][0].created_at,
          date_start: byRunId[runId][0].date_start,
          date_end: byRunId[runId][0].date_end
        };
        return acc;
      }, {}),
      date_ranges: dateRanges.slice(0, 20), // First 20 for brevity
      sample_records: (data || []).slice(0, 5).map(r => ({
        run_id: r.run_id,
        segment: r.segment,
        scope: r.scope,
        created_at: r.created_at,
        date_start: r.date_start,
        date_end: r.date_end,
        clicks_28d: r.clicks_28d,
        impressions_28d: r.impressions_28d,
        ctr_28d: r.ctr_28d,
        position_28d: r.position_28d,
        pages_count: r.pages_count,
        ai_citations_28d: r.ai_citations_28d,
        ai_overview_present_count: r.ai_overview_present_count
      })),
      position_analysis: {
        total_with_position: (data || []).filter(r => r.position_28d != null && r.position_28d > 0).length,
        total_null_position: (data || []).filter(r => r.position_28d == null).length,
        total_zero_position: (data || []).filter(r => r.position_28d === 0).length,
        avg_position_by_segment: Object.keys(bySegment).reduce((acc, seg) => {
          const segRows = bySegment[seg].filter(r => r.position_28d != null && r.position_28d > 0);
          if (segRows.length > 0) {
            acc[seg] = segRows.reduce((sum, r) => sum + r.position_28d, 0) / segRows.length;
          } else {
            acc[seg] = null;
          }
          return acc;
        }, {})
      }
    });

  } catch (err) {
    console.error('[Diagnose Portfolio Segments] Error:', err);
    return sendJSON(res, 500, { error: err.message });
  }
}


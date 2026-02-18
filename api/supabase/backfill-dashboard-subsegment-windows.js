// /api/supabase/backfill-dashboard-subsegment-windows.js
// Backfill dashboard_subsegment_windows for recent runs.

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
  if (req.method === 'OPTIONS') return sendJSON(res, 200, { ok: true });
  if (req.method !== 'POST') return sendJSON(res, 405, { error: 'Method not allowed. Expected POST.' });

  try {
    const {
      siteUrl = 'https://www.alanranger.com',
      scope = 'all_pages',
      limit = 30
    } = req.body || {};

    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
    const { data: runs, error: runsErr } = await supabase
      .from('portfolio_segment_metrics_28d')
      .select('run_id,date_end')
      .eq('site_url', siteUrl)
      .eq('scope', scope)
      .eq('segment', 'site')
      .order('date_end', { ascending: false })
      .limit(Math.max(1, Math.min(365, Number.parseInt(limit, 10) || 30)));
    if (runsErr) throw new Error(`run lookup failed: ${runsErr.message}`);

    const uniqueRuns = [];
    const seen = new Set();
    (runs || []).forEach((r) => {
      const key = `${r.run_id}|${String(r.date_end).slice(0, 10)}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueRuns.push({ runId: r.run_id, dateEnd: String(r.date_end).slice(0, 10) });
      }
    });

    const baseUrl = process.env.CRON_BASE_URL
      || process.env.NEXT_PUBLIC_SITE_URL
      || (req.headers.host ? `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}` : 'http://localhost:3000');

    const results = [];
    for (const r of uniqueRuns) {
      try {
        const response = await fetch(`${baseUrl}/api/supabase/save-dashboard-subsegment-windows`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            siteUrl,
            runId: r.runId,
            dateEnd: r.dateEnd,
            scope
          })
        });
        const data = await response.json();
        results.push({
          runId: r.runId,
          dateEnd: r.dateEnd,
          success: response.ok,
          inserted: data?.inserted || 0,
          error: response.ok ? null : (data?.error || `HTTP ${response.status}`)
        });
      } catch (err) {
        results.push({
          runId: r.runId,
          dateEnd: r.dateEnd,
          success: false,
          inserted: 0,
          error: err.message
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    return sendJSON(res, 200, {
      success: true,
      siteUrl,
      attempted: uniqueRuns.length,
      succeeded: successCount,
      failed: uniqueRuns.length - successCount,
      results
    });
  } catch (err) {
    console.error('[backfill-dashboard-subsegment-windows] error:', err);
    return sendJSON(res, 500, { error: err.message || 'Internal error' });
  }
}


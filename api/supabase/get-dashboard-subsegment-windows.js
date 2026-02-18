// /api/supabase/get-dashboard-subsegment-windows.js
// Read latest (or requested run) dashboard segment windows.

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
  if (req.method === 'OPTIONS') return sendJSON(res, 200, { ok: true });
  if (req.method !== 'GET') return sendJSON(res, 405, { error: 'Method not allowed. Expected GET.' });

  try {
    const { siteUrl, runId = null, scope = 'all_pages' } = req.query || {};
    if (!siteUrl) return sendJSON(res, 400, { error: 'Missing required field: siteUrl' });

    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
    let effectiveRunId = runId;

    if (!effectiveRunId) {
      const { data: latest, error: latestErr } = await supabase
        .from('dashboard_subsegment_windows')
        .select('run_id')
        .eq('site_url', siteUrl)
        .eq('scope', scope)
        .order('date_end', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1);
      if (latestErr) throw new Error(`latest run lookup failed: ${latestErr.message}`);
      effectiveRunId = latest?.[0]?.run_id || null;
    }

    if (!effectiveRunId) {
      return sendJSON(res, 200, { rows: [], runId: null, count: 0, message: 'No dashboard window rows found' });
    }

    const { data: rows, error } = await supabase
      .from('dashboard_subsegment_windows')
      .select('*')
      .eq('site_url', siteUrl)
      .eq('scope', scope)
      .eq('run_id', effectiveRunId)
      .order('window_days', { ascending: true })
      .order('segment', { ascending: true });
    if (error) throw new Error(`query failed: ${error.message}`);

    return sendJSON(res, 200, {
      runId: effectiveRunId,
      siteUrl,
      scope,
      rows: rows || [],
      count: rows?.length || 0
    });
  } catch (err) {
    console.error('[get-dashboard-subsegment-windows] error:', err);
    return sendJSON(res, 500, { error: err.message || 'Internal error' });
  }
}


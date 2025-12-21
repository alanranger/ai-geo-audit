// /api/portfolio/save-run.js
// Save portfolio audit run and snapshots

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
      windowDays = 28,
      windowStart,
      windowEnd,
      note,
      snapshots = []
    } = req.body;

    const supabase = createClient(
      need('SUPABASE_URL'),
      need('SUPABASE_SERVICE_ROLE_KEY')
    );

    // If run_id is provided, use existing run; otherwise create new one
    let runId;
    
    if (req.body.run_id) {
      // Use existing run
      runId = req.body.run_id;
      const { data: existingRun } = await supabase
        .from('portfolio_audit_runs')
        .select('id')
        .eq('id', runId)
        .single();
      
      if (!existingRun) {
        return sendJSON(res, 404, { error: 'Run not found' });
      }
    } else {
      // Create new audit run
      const { data: run, error: runError } = await supabase
        .from('portfolio_audit_runs')
        .insert({
          window_days: windowDays,
          window_start: windowStart || null,
          window_end: windowEnd || null,
          note: note || null
        })
        .select()
        .single();

      if (runError) {
        console.error('[Portfolio Save Run] Insert error:', runError);
        return sendJSON(res, 500, { error: runError.message });
      }
      
      runId = run.id;
    }

    // Insert snapshots in bulk if provided
    let snapshotsCount = 0;
    if (snapshots && snapshots.length > 0) {
      const snapshotsWithRunId = snapshots.map(s => ({
        run_id: runId,
        segment: s.segment,
        scope: s.scope,
        kpi: s.kpi,
        value: s.value,
        unit: s.unit || null,
        meta: s.meta || null
      }));

      const { error: snapshotsError } = await supabase
        .from('portfolio_snapshots_v2')
        .insert(snapshotsWithRunId);

      if (snapshotsError) {
        console.error('[Portfolio Save Run] Snapshots insert error:', snapshotsError);
        return sendJSON(res, 500, { error: snapshotsError.message });
      }
      
      snapshotsCount = snapshots.length;
    }

    // Fetch the run to return
    const { data: run } = await supabase
      .from('portfolio_audit_runs')
      .select('*')
      .eq('id', runId)
      .single();

    return sendJSON(res, 200, { 
      run,
      snapshotsCount,
      message: 'Portfolio audit run saved successfully'
    });

  } catch (err) {
    console.error('[Portfolio Save Run] Error:', err);
    return sendJSON(res, 500, { error: err.message });
  }
}


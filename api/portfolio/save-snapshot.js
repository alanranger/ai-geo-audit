// /api/portfolio/save-snapshot.js
// Save portfolio snapshot (called during audit runs)

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
      periodStart,
      periodType = 'weekly',
      segment,
      kpi,
      scope = 'all',
      medianDelta,
      medianValue,
      taskCount,
      filtersHash,
      filtersJson
    } = req.body;

    if (!periodStart || !segment || !kpi) {
      return sendJSON(res, 400, { 
        error: 'Missing required fields: periodStart, segment, kpi' 
      });
    }

    const supabase = createClient(
      need('SUPABASE_URL'),
      need('SUPABASE_SERVICE_ROLE_KEY')
    );

    // Upsert snapshot (update if exists, insert if not)
    const snapshotData = {
      period_start: periodStart,
      period_type: periodType,
      segment,
      kpi,
      scope,
      median_delta: medianDelta || null,
      median_value: medianValue || null,
      task_count: taskCount || null,
      filters_hash: filtersHash || null,
      filters_json: filtersJson || null
    };

    const { data, error } = await supabase
      .from('portfolio_snapshots')
      .upsert(snapshotData, {
        onConflict: 'period_start,period_type,segment,kpi,scope',
        ignoreDuplicates: false
      })
      .select()
      .single();

    if (error) {
      console.error('[Portfolio Save Snapshot] Upsert error:', error);
      return sendJSON(res, 500, { error: error.message });
    }

    return sendJSON(res, 200, { 
      snapshot: data,
      message: 'Snapshot saved successfully'
    });

  } catch (err) {
    console.error('[Portfolio Save Snapshot] Error:', err);
    return sendJSON(res, 500, { error: err.message });
  }
}



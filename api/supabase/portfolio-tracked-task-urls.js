// GET /api/supabase/portfolio-tracked-task-urls
// Returns target URLs for optimisation tasks that should count toward
// portfolio "active_cycles_only" / Money Pages (tracked) / All tracked.
//
// Intentionally uses the service role on the server (no browser admin key).
// The GSC audit flow saves page metrics without x-arp-admin-key; portfolio
// snapshots must still see active tasks or every tracked row saves as zero.

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-arp-admin-key, x-arp-share-token');
  res.status(status).send(JSON.stringify(obj));
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-arp-admin-key, x-arp-share-token');
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return sendJSON(res, 405, { error: 'Method not allowed' });
  }

  try {
    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));

    const { data: tasks, error } = await supabase
      .from('vw_optimisation_task_status')
      .select('target_url, target_url_clean, status')
      .neq('status', 'deleted');

    if (error) {
      return sendJSON(res, 500, { error: error.message });
    }

    const urls = [];
    const seen = new Set();
    for (const t of tasks || []) {
      if (!t?.status || ['done', 'cancelled', 'deleted'].includes(t.status)) continue;
      const raw = (t.target_url_clean || t.target_url || '').trim();
      if (!raw) continue;
      const k = raw.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      urls.push(raw);
    }

    return sendJSON(res, 200, { urls, count: urls.length });
  } catch (e) {
    return sendJSON(res, 500, { error: e?.message || String(e) });
  }
}

// Daily strategy_event_snapshots — Vercel cron + manual POST.
// Vercel schedules call GET; must accept x-vercel-cron and Bearer CRON_SECRET.
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { createClient } from '@supabase/supabase-js';
import { authoriseCron, sendJson, DEFAULT_PROPERTY } from '../../lib/ceo-weekly/shared.js';
import { runStrategyEventSnapshots } from '../../lib/strategy-snapshots.mjs';

const FLAG_KEY = 'strategy_event_snapshots';

async function saveRun(sb, patch) {
  try {
    await sb.from('system_maintenance_state').upsert(
      { key: FLAG_KEY, updated_at: new Date().toISOString(), ...patch },
      { onConflict: 'key' }
    );
  } catch { /* non-fatal */ }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  if (!['GET', 'POST'].includes(req.method)) {
    return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
  }
  if (!authoriseCron(req)) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE;
  if (!url || !key) return sendJson(res, 500, { ok: false, error: 'Missing Supabase credentials' });

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  await saveRun(supabase, { state: 'running', started_at: new Date().toISOString(), finished_at: null, last_error: null });

  try {
    const propertyUrl = String(req.query?.propertyUrl || DEFAULT_PROPERTY);
    const fillMissing = String(req.query?.fillMissing || '1') !== '0';
    const result = await runStrategyEventSnapshots(supabase, propertyUrl, { fillMissingDays: fillMissing });
    await saveRun(supabase, {
      state: 'done',
      finished_at: new Date().toISOString(),
      last_success_at: new Date().toISOString(),
      last_error: null,
      last_details: result
    });
    return sendJson(res, 200, { ok: true, ...result });
  } catch (e) {
    const msg = e?.message || String(e);
    await saveRun(supabase, {
      state: 'failed',
      finished_at: new Date().toISOString(),
      last_error: msg
    });
    return sendJson(res, 500, { ok: false, error: msg });
  }
}

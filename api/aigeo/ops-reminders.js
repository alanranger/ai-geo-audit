/**
 * Dated manual reminders (public.ops_reminders, lib/ceo-weekly/ops-reminders.js).
 *  GET                         → every open reminder with its state this week (upcoming / due / overdue)
 *  PATCH { id, done: boolean } → mark one done (or reopen it); dashboard admin key (x-arp-admin-key) or CRON_SECRET
 * Never touches Squarespace.
 */
export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { londonWeekStartYmd, sendJson } from '../../lib/ceo-weekly/shared.js';
import { requireCronOrAdmin } from '../../lib/api/cronAuth.js';
import { listOpenReminders, setReminderDone } from '../../lib/ceo-weekly/ops-reminders.js';

function need(key) {
  const v = process.env[key];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${key}`);
  return v;
}

async function handlePatch(sb, req, res) {
  if (!requireCronOrAdmin(req, res, sendJson)) return undefined;
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0 || typeof body.done !== 'boolean') return sendJson(res, 400, { ok: false, error: 'id and done (true / false) required' });
  const reminder = await setReminderDone(sb, id, body.done);
  if (!reminder) return sendJson(res, 404, { ok: false, error: 'reminder not found' });
  return sendJson(res, 200, { ok: true, reminder });
}

export default async function handler(req, res) {
  try {
    const sb = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
    if (req.method === 'GET') {
      const weekStart = londonWeekStartYmd();
      return sendJson(res, 200, { ok: true, week_start: weekStart, reminders: await listOpenReminders(sb, weekStart) });
    }
    if (req.method === 'PATCH') return await handlePatch(sb, req, res);
    res.setHeader('Allow', 'GET, PATCH');
    return sendJson(res, 405, { ok: false, error: 'method not allowed' });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err?.message || String(err) });
  }
}

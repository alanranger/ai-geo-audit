/**
 * CEO weekly email cron — safety net only.
 * Primary send is the last step of ceo-weekly-full-refresh.
 * This job waits until Monday Full Refresh has finished (email_sent);
 * it does not send early with incomplete/stale Surface/Top scores.
 */
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { createClient } from '@supabase/supabase-js';
import { authoriseCron, sendJson, londonWeekStartYmd } from '../../lib/ceo-weekly/shared.js';
import { runCeoWeeklyReport } from '../../lib/ceo-weekly/report.js';

function flag(req, name) {
  const q = req.query?.[name];
  const b = req.body?.[name];
  return String(q ?? b ?? '').toLowerCase() === 'true' || b === true;
}

function need(key) {
  const v = process.env[key];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${key}`);
  return v;
}

async function mondayFullRefreshDone(weekStart) {
  const sb = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
  const { data } = await sb
    .from('system_maintenance_state')
    .select('state, last_details')
    .eq('key', 'ceo_monday_full_refresh')
    .maybeSingle();
  const details = data?.last_details;
  if (!details || details.week_start !== weekStart) return false;
  return details.email_sent === true || data?.state === 'done';
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  if (!['GET', 'POST'].includes(req.method)) return sendJson(res, 405, { error: 'method_not_allowed' });
  if (!authoriseCron(req)) return sendJson(res, 401, { error: 'unauthorized' });

  try {
    const weekStart = String(req.query?.weekStart || req.body?.weekStart || '').trim() || londonWeekStartYmd();
    const fromFull = flag(req, 'fromFullRefresh');
    const force = flag(req, 'forceResend') || flag(req, 'force');

    // Backup cron must not fire before Full Refresh finishes (Alan: complete first, then email).
    if (!fromFull && !force && !flag(req, 'dryRun')) {
      const done = await mondayFullRefreshDone(weekStart);
      if (!done) {
        return sendJson(res, 200, {
          ok: true,
          status: 'waiting_for_full_refresh',
          weekStart,
          message: 'Monday Full Refresh still running — CEO email sends as its last step'
        });
      }
    }

    const result = await runCeoWeeklyReport({
      weekStart,
      dryRun: flag(req, 'dryRun'),
      forceFailSafe: flag(req, 'forceFailSafe'),
      skipGate: true,
      forceResend: force || fromFull,
      failReason: req.query?.failReason || req.body?.failReason || undefined,
      refreshLog: req.body?.refreshLog || null
    });
    return sendJson(res, 200, result);
  } catch (err) {
    return sendJson(res, 500, { error: 'ceo_weekly_report_failed', message: err?.message || String(err) });
  }
}

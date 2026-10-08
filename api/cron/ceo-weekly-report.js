/**
 * CEO weekly email cron — safety net only.
 * Primary send is the last step of ceo-weekly-full-refresh (after audit finishes).
 * Morning/early backup waits. Late Monday (20:00 UTC) may send if still missing.
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };

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

async function mondayEmailAlreadySent(weekStart) {
  const sb = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
  const { data: snap } = await sb
    .from('ceo_weekly_report_snapshots')
    .select('id')
    .eq('week_start', weekStart)
    .eq('send_status', 'sent')
    .limit(1)
    .maybeSingle();
  if (snap?.id) return true;

  const { data } = await sb
    .from('system_maintenance_state')
    .select('last_details')
    .eq('key', 'ceo_monday_full_refresh')
    .maybeSingle();
  const details = data?.last_details;
  return !!(details && details.week_start === weekStart && details.email_sent === true);
}

async function mondayFullRefreshFinished(weekStart) {
  const sb = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
  const { data } = await sb
    .from('system_maintenance_state')
    .select('state, last_details')
    .eq('key', 'ceo_monday_full_refresh')
    .maybeSingle();
  const details = data?.last_details;
  if (!details || details.week_start !== weekStart) return false;
  return details.email_sent === true || data?.state === 'done' || data?.state === 'failed';
}

/** After 20:00 UTC Monday, allow a last-resort send even if Full Refresh stalled. */
function lateMondayRescueWindow(now = new Date()) {
  if (now.getUTCDay() !== 1) return false;
  return now.getUTCHours() >= 20;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  if (!['GET', 'POST'].includes(req.method)) return sendJson(res, 405, { error: 'method_not_allowed' });
  if (!authoriseCron(req)) return sendJson(res, 401, { error: 'unauthorized' });

  try {
    const weekStart = String(req.query?.weekStart || req.body?.weekStart || '').trim() || londonWeekStartYmd();
    const fromFull = flag(req, 'fromFullRefresh');
    const force = flag(req, 'forceResend') || flag(req, 'force');

    if (!fromFull && !force && !flag(req, 'dryRun')) {
      if (await mondayEmailAlreadySent(weekStart)) {
        return sendJson(res, 200, {
          ok: true,
          status: 'already_sent',
          weekStart,
          message: 'CEO weekly email already sent for this week'
        });
      }
      const finished = await mondayFullRefreshFinished(weekStart);
      if (!finished && !lateMondayRescueWindow()) {
        return sendJson(res, 200, {
          ok: true,
          status: 'waiting_for_full_refresh',
          weekStart,
          message: 'Monday Full Refresh still running — email sends when that audit finishes'
        });
      }
    }

    const subjectSuffix = String(req.query?.subjectSuffix || req.body?.subjectSuffix || '').trim() || undefined;
    const subject = String(req.query?.subject || req.body?.subject || '').trim() || undefined;
    const result = await runCeoWeeklyReport({
      weekStart,
      dryRun: flag(req, 'dryRun'),
      forceFailSafe: flag(req, 'forceFailSafe'),
      skipGate: true,
      forceResend: force || fromFull || lateMondayRescueWindow(),
      failReason: req.query?.failReason || req.body?.failReason || undefined,
      refreshLog: req.body?.refreshLog || null,
      subjectSuffix,
      subject
    });
    return sendJson(res, 200, result);
  } catch (err) {
    return sendJson(res, 500, { error: 'ceo_weekly_report_failed', message: err?.message || String(err) });
  }
}

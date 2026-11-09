/**
 * Pre-send sense-check for the Monday CEO brief.
 *  GET  ?weekStart=[&holdOnly=1]             → any unreleased hold (dashboard banner) + this week's checks, not saved
 *  POST { action:'assess', weekStart, steps } → Monday refresh step: assess; opens a hold when a check fails
 *  POST { action:'send-anyway', weekStart[, dryRun] } → dashboard button: release the hold and send the brief as built
 *  POST { action:'send-anyway', weekStart, onceKey[, subjectSuffix] } → same send, at most once per (week, onceKey)
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { createClient } from '@supabase/supabase-js';
import { londonWeekStartYmd, sendJson, DEFAULT_PROPERTY } from '../../lib/ceo-weekly/shared.js';
import { activeHold, releaseHold, runBriefSenseCheck } from '../../lib/ceo-weekly/brief-hold.js';
import { assessBriefGate, loadBriefGateInputs } from '../../lib/ceo-weekly/brief-gate.js';
import { loadCurrentFindings } from '../../lib/fault-monitor/store.js';
import { weekOnWeekBlocks } from '../../lib/ceo-weekly/metrics.js';
import { runCeoWeeklyReport } from '../../lib/ceo-weekly/report.js';
import { claimOnce, finishOnce, sendRecord, validOnceKey } from '../../lib/ceo-weekly/send-once.js';

const FLAG_KEY = 'ceo_monday_full_refresh';

function need(key) {
  const v = process.env[key];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${key}`);
  return v;
}

async function refreshSteps(sb, weekStart) {
  const { data } = await sb.from('system_maintenance_state').select('last_details').eq('key', FLAG_KEY).maybeSingle();
  const d = data?.last_details;
  return d?.week_start === weekStart && Array.isArray(d.steps) ? d.steps : [];
}

async function markRefreshSent(sb, weekStart) {
  const { data } = await sb.from('system_maintenance_state').select('last_details').eq('key', FLAG_KEY).maybeSingle();
  const d = data?.last_details;
  if (d?.week_start !== weekStart) return;
  await sb.from('system_maintenance_state').update({
    state: 'done', last_error: null, finished_at: new Date().toISOString(),
    last_details: { ...d, email_sent: true, email_held: false, email_sent_anyway: true },
  }).eq('key', FLAG_KEY);
}

async function handleGet(sb, req, res) {
  const weekStart = String(req.query?.weekStart || '').trim() || londonWeekStartYmd();
  const propertyUrl = String(req.query?.propertyUrl || DEFAULT_PROPERTY);
  const hold = await activeHold(sb, weekStart);
  if (req.query?.holdOnly) return sendJson(res, 200, { ok: true, weekStart, hold });
  const steps = await refreshSteps(sb, weekStart);
  return sendJson(res, 200, { ok: true, weekStart, hold, steps_known: steps.length, note: 'GET never opens a hold', ...(await previewGate(sb, { weekStart, propertyUrl, steps })) });
}

async function previewGate(sb, args) {
  const { current, run } = await loadCurrentFindings(sb);
  const blocks = await weekOnWeekBlocks(sb, args.weekStart).catch((e) => ({ backlinks: { error: e.message }, seo_health: { error: e.message } }));
  const inputs = await loadBriefGateInputs(sb, { ...args, latestFullRunStart: run?.started_at || null,
    shownFindings: current.filter((f) => f.severity === 'red' || f.severity === 'amber'), blocks });
  return { gate: assessBriefGate(inputs) };
}

async function handleAssess(sb, body, res) {
  const weekStart = String(body.weekStart || '').trim() || londonWeekStartYmd();
  const propertyUrl = String(body.propertyUrl || DEFAULT_PROPERTY);
  const steps = Array.isArray(body.steps) ? body.steps : await refreshSteps(sb, weekStart);
  const gate = await runBriefSenseCheck(sb, { weekStart, propertyUrl, steps });
  return sendJson(res, 200, { ok: true, weekStart, ...gate });
}

async function sendAnywayReport(sb, body, weekStart, dryRun) {
  const released = dryRun ? null : await releaseHold(sb, weekStart, 'alan_dashboard_send_anyway');
  const subjectSuffix = typeof body.subjectSuffix === 'string' ? body.subjectSuffix.slice(0, 60) : undefined;
  const report = await runCeoWeeklyReport({ weekStart, propertyUrl: body.propertyUrl || DEFAULT_PROPERTY, skipGate: true, forceResend: true, sendAnyway: true, dryRun, subjectSuffix });
  if (report?.mode === 'report' && !dryRun) await markRefreshSent(sb, weekStart);
  return { released, report };
}

/** onceKey: at most one send per (week, key); a repeat returns 409 with the first send's record and sends nothing. */
async function sendOnce(sb, body, res, weekStart) {
  if (!validOnceKey(body.onceKey)) return sendJson(res, 400, { ok: false, error: 'onceKey must be 3–60 chars of a-z, 0-9, -' });
  const claim = await claimOnce(sb, weekStart, body.onceKey);
  if (!claim.claimed) return sendJson(res, 409, { ok: false, error: 'already_sent_once', weekStart, key: claim.key, prior: claim.prior, claim_error: claim.error || null });
  const claimDetails = { week_start: weekStart, once_key: body.onceKey };
  let out;
  try {
    out = await sendAnywayReport(sb, body, weekStart, false);
  } catch (err) {
    await finishOnce(sb, claim.key, claimDetails, { ok: false, error: err?.message || String(err) }).catch(() => null);
    throw err;
  }
  const record = sendRecord(out.report);
  const recordError = await finishOnce(sb, claim.key, claimDetails, record).then(() => null, (e) => e.message);
  return sendJson(res, 200, { ok: record.ok, weekStart, onceKey: body.onceKey, released: Boolean(out.released), mode: out.report?.mode, message_id: record.message_id, record_error: recordError, send: out.report?.send || null });
}

/** dryRun: builds the brief without sending and keeps the hold (for testing the button path). */
async function handleSendAnyway(sb, body, res) {
  const weekStart = String(body.weekStart || '').trim() || londonWeekStartYmd();
  const dryRun = body.dryRun === true;
  if (body.onceKey != null && !dryRun) return sendOnce(sb, body, res, weekStart);
  const { released, report } = await sendAnywayReport(sb, body, weekStart, dryRun);
  return sendJson(res, 200, { ok: report?.mode === 'report', weekStart, dryRun, released: Boolean(released), mode: report?.mode, send: report?.send || null });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  try {
    const sb = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
    if (req.method === 'GET') return await handleGet(sb, req, res);
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (body.action === 'assess') return await handleAssess(sb, body, res);
    if (body.action === 'send-anyway') return await handleSendAnyway(sb, body, res);
    return sendJson(res, 400, { ok: false, error: 'action must be assess or send-anyway' });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err?.message || String(err) });
  }
}

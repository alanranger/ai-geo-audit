/**
 * Silent fault monitor API.
 *  GET                      → open findings + latest run (dashboard section)
 *  POST { action:'tick', runId? }    → start (no runId) or advance a run; multi-tick
 *  POST { action:'recheck', url }    → re-check one page now; closes faults that pass
 *  POST { action:'accept-layout', url } → forget the C1 block baseline for a page
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { createClient } from '@supabase/supabase-js';
import { londonWeekStartYmd, sendJson } from '../../lib/ceo-weekly/shared.js';
import { recheckUrl, startRun, tickRun, tickSummary } from '../../lib/fault-monitor/runner.js';
import { faultKey, latestRun, loadOpenFindings, resolveKeys } from '../../lib/fault-monitor/store.js';
import { urlKey } from '../../lib/fault-monitor/prefetch.js';
import { loadFaultSummary } from '../../lib/fault-monitor/brief.js';

function need(key) {
  const v = process.env[key];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${key}`);
  return v;
}

function supabase() {
  return createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
}

async function handleGet(sb, res) {
  const [findings, run, summary] = await Promise.all([loadOpenFindings(sb), latestRun(sb), loadFaultSummary(sb)]);
  const runStart = run ? Date.parse(run.started_at) : 0;
  const rows = findings.map((f) => ({ ...f, not_rechecked: runStart > 0 && Date.parse(f.last_checked) < runStart }));
  return sendJson(res, 200, {
    ok: true,
    run: run ? { ...tickSummary(run), started_at: run.started_at, finished_at: run.finished_at, rotation_slot: run.rotation_slot, source: run.source, not_checked: run.not_checked || [] } : null,
    summary,
    findings: rows
  });
}

async function handleTick(sb, body, res) {
  let runId = body.runId || null;
  if (!runId) {
    const run = await startRun(sb, { source: String(body.source || 'manual').slice(0, 40), weekStart: londonWeekStartYmd() });
    runId = run.id;
  }
  const budgetMs = Math.min(Math.max(Number(body.budgetMs) || 200000, 20000), 230000);
  const tick = await tickRun(sb, runId, { budgetMs });
  return sendJson(res, 200, { ok: true, run_id: runId, ...tick });
}

async function handleRecheck(sb, body, res) {
  const url = String(body.url || '').trim();
  if (!/^https:\/\/(www\.)?alanranger\.com\//i.test(url) && !/^https:\/\/(www\.)?alanranger\.com$/i.test(url)) {
    return sendJson(res, 400, { ok: false, error: 'url must be an alanranger.com page' });
  }
  const result = await recheckUrl(sb, url);
  const open = (await loadOpenFindings(sb)).filter((f) => f.url && urlKey(f.url) === urlKey(url));
  return sendJson(res, 200, { ok: true, url, ...result, open });
}

async function handleAcceptLayout(sb, body, res) {
  const url = String(body.url || '').trim();
  if (!url) return sendJson(res, 400, { ok: false, error: 'url required' });
  const { error } = await sb.from('fault_monitor_page_baseline').delete().eq('url_key', urlKey(url));
  if (error) throw new Error(error.message);
  await resolveKeys(sb, [faultKey('C1', url)]);
  return sendJson(res, 200, { ok: true, url, accepted: true });
}

const ACTIONS = { tick: handleTick, recheck: handleRecheck, 'accept-layout': handleAcceptLayout };

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  try {
    const sb = supabase();
    if (req.method === 'GET') return await handleGet(sb, res);
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const fn = ACTIONS[body.action];
    if (!fn) return sendJson(res, 400, { ok: false, error: 'unknown action' });
    return await fn(sb, body, res);
  } catch (err) {
    console.error('[silent-fault-monitor]', err);
    return sendJson(res, 500, { ok: false, error: String(err?.message || err) });
  }
}

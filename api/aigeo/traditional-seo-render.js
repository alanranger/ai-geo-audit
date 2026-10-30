export const config = { runtime: 'nodejs', maxDuration: 300 };

import { createClient } from '@supabase/supabase-js';
import { londonWeekStartYmd, sendJson } from '../../lib/ceo-weekly/shared.js';
import { recheckUrl, startRun, tickRun, tickSummary } from '../../lib/fault-monitor/runner.js';
import { latestAnyTradSeoRun, latestRunningTradSeoRun, latestTradSeoRun, loadRun, saveRun } from '../../lib/fault-monitor/store.js';
import { isFullTradSeoSource } from '../../lib/trad-seo-render/run-kind.js';
import { loadFaultSummary } from '../../lib/fault-monitor/brief.js';
import { runSiteChecks } from '../../lib/fault-monitor/site-checks.js';
import { loadRunPages, loadLatestPage } from '../../lib/trad-seo-render/pages-store.js';
import { loadBrokenPages, tickBrokenLinks } from '../../lib/trad-seo-render/broken-job.js';

function need(key) {
  const v = process.env[key];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${key}`);
  return v;
}

function supabase() {
  return createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
}

function playwrightSource(source) {
  return /playwright/i.test(String(source || ''));
}

function healthRows(findings) {
  return (findings || [])
    .filter((f) => f.status === 'fault' && /^D[1-6]$/.test(f.check || f.check_id || ''))
    .map((f) => ({
      check: f.check || f.check_id,
      severity: f.severity === 'red' ? 'critical' : 'high',
      title: f.title,
      url: f.url || null
    }));
}

async function handleGet(sb, req, res) {
  const runId = String(req.query?.runId || '').trim();
  let run = runId ? await loadRun(sb, runId) : await latestTradSeoRun(sb);
  if (!run && !runId) run = await latestAnyTradSeoRun(sb);
  const pages = run ? await loadRunPages(sb, run.id) : [];
  const broken = run ? await loadBrokenPages(sb, run.id) : [];
  const summary = await loadFaultSummary(sb).catch(() => null);
  let health = [];
  if (String(req.query?.health || '') === '1') {
    const site = await runSiteChecks(sb, { plan: [], site_errors: {} }).catch(() => []);
    health = healthRows(site);
  }
  return sendJson(res, 200, {
    ok: true,
    run: run ? { ...tickSummary(run), started_at: run.started_at, finished_at: run.finished_at, source: run.source } : null,
    pages: pages.map((p) => ({
      page_url: p.page_url,
      checked_at: p.checked_at,
      outcome: p.outcome,
      reason: p.reason,
      http_status: p.http_status,
      extract_row: p.extract_row,
      findings: p.findings,
      html_len: p.html_len
    })),
    broken: broken.map((b) => ({
      page_url: b.page_url,
      checked_at: b.checked_at,
      outcome: b.outcome,
      status: b.status,
      note: b.note
    })),
    health,
    fault_summary: summary
  });
}

async function handleStart(sb, body, res) {
  const source = String(body.source || 'trad_seo').slice(0, 40);
  if (isFullTradSeoSource(source)) {
    const running = await latestRunningTradSeoRun(sb);
    if (running) {
      return sendJson(res, 200, { ok: true, run_id: running.id, resumed: true, ...tickSummary(running) });
    }
    const run = await startRun(sb, { source: 'trad_seo', weekStart: londonWeekStartYmd(), urls: [] });
    return sendJson(res, 200, { ok: true, run_id: run.id, resumed: false, ...tickSummary(run) });
  }
  const urls = Array.isArray(body.urls) ? body.urls.filter((u) => /^https:\/\/(www\.)?alanranger\.com/i.test(u)) : [];
  const forceNotChecked = Array.isArray(body.forceNotChecked) && playwrightSource(source)
    ? body.forceNotChecked
    : [];
  const run = await startRun(sb, { source, weekStart: londonWeekStartYmd(), urls, forceNotChecked });
  return sendJson(res, 200, { ok: true, run_id: run.id, resumed: false, ...tickSummary(run) });
}

async function handleTick(sb, body, res) {
  let runId = body.runId || null;
  if (!runId) {
    const latest = await latestRunningTradSeoRun(sb);
    if (!latest) {
      return sendJson(res, 200, { ok: true, done: true, idle: true });
    }
    runId = latest.id;
  }
  const tick = await tickRun(sb, runId, { budgetMs: Math.min(Math.max(Number(body.budgetMs) || 200000, 20000), 230000) });
  return sendJson(res, 200, { ok: true, run_id: runId, ...tick });
}

async function handleRecheck(sb, body, res) {
  const url = String(body.url || '').trim();
  if (!/^https:\/\/(www\.)?alanranger\.com/i.test(url)) {
    return sendJson(res, 400, { ok: false, error: 'url must be an alanranger.com page' });
  }
  const latest = await latestTradSeoRun(sb);
  const result = await recheckUrl(sb, url, latest?.id || null);
  const page = await loadLatestPage(sb, url);
  return sendJson(res, 200, { ok: true, url, ...result, page });
}

async function handleCancel(sb, body, res) {
  const runId = body.runId || (await latestRunningTradSeoRun(sb))?.id;
  if (!runId) return sendJson(res, 200, { ok: true, cancelled: false, idle: true });
  const run = await loadRun(sb, runId);
  if (!run) return sendJson(res, 404, { ok: false, error: 'run_not_found' });
  if (run.status === 'running') {
    await saveRun(sb, runId, {
      status: 'cancelled',
      finished_at: new Date().toISOString(),
      error: 'cancelled_by_user'
    });
  }
  return sendJson(res, 200, { ok: true, run_id: runId, cancelled: true, status: 'cancelled' });
}

async function handleBrokenTick(sb, body, res) {
  const explicit = body.runId || null;
  const runId = explicit || (await latestRunningTradSeoRun(sb))?.id || (await latestTradSeoRun(sb))?.id;
  if (!runId) return sendJson(res, 400, { ok: false, error: 'no_run' });
  const run = await loadRun(sb, runId);
  if (run && !explicit && !isFullTradSeoSource(run.source)) {
    return sendJson(res, 200, { ok: true, idle: true, done: true, run_id: runId });
  }
  const pages = await loadRunPages(sb, runId);
  const already = await loadBrokenPages(sb, runId);
  const doneKeys = new Set(already.map((r) => r.page_url));
  const remaining = pages.filter((p) => !doneKeys.has(p.page_url));
  const tick = await tickBrokenLinks(sb, runId, remaining, {
    budgetMs: Math.min(Math.max(Number(body.budgetMs) || 180000, 20000), 230000),
    forceNotChecked: Array.isArray(body.forceNotChecked) && playwrightSource(body.source)
      ? body.forceNotChecked
      : []
  });
  return sendJson(res, 200, { ok: true, run_id: runId, done: tick.remaining <= 0, ...tick });
}

const ACTIONS = {
  start: handleStart,
  tick: handleTick,
  cancel: handleCancel,
  recheck: handleRecheck,
  'broken-tick': handleBrokenTick
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  try {
    const sb = supabase();
    if (req.method === 'GET') return await handleGet(sb, req, res);
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const fn = ACTIONS[body.action];
    if (!fn) return sendJson(res, 400, { ok: false, error: 'unknown action' });
    return await fn(sb, body, res);
  } catch (err) {
    console.error('[traditional-seo-render]', err);
    return sendJson(res, 500, { ok: false, error: String(err?.message || err) });
  }
}

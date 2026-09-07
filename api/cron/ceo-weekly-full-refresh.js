/**
 * Unattended Monday Full Refresh (server-side stand-in for Dashboard Full button).
 * Runs one (or a few) steps per invoke, then continues on the next cron tick.
 * Last step = CEO weekly HTML email (same as manual Full Refresh).
 *
 * Schedule: every 15 min Mon 00:00–03:45 UTC (≈ 01:00–04:45 London BST).
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { createClient } from '@supabase/supabase-js';
import { authoriseCron, sendJson, londonWeekStartYmd, DEFAULT_PROPERTY } from '../../lib/ceo-weekly/shared.js';
import { runCeoWeeklyReport } from '../../lib/ceo-weekly/report.js';

const FLAG_KEY = 'ceo_monday_full_refresh';

function need(key) {
  const v = process.env[key];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${key}`);
  return v;
}

function baseUrl(req) {
  return (
    process.env.CEO_WEEKLY_BASE_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`)
    || (process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`)
    || (req.headers?.host && `https://${req.headers.host}`)
    || 'https://ai-geo-audit.vercel.app'
  ).replace(/\/$/, '');
}

function cronHeaders() {
  const h = {};
  if (process.env.CRON_SECRET) h['x-cron-secret'] = process.env.CRON_SECRET;
  return h;
}

async function hit(base, path, opts = {}) {
  const method = opts.method || 'GET';
  const init = { method, headers: { ...cronHeaders(), ...(opts.headers || {}) } };
  if (method !== 'GET' && method !== 'HEAD') {
    init.headers['Content-Type'] = 'application/json';
    if (opts.body) init.body = JSON.stringify(opts.body);
  }
  const t0 = Date.now();
  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text?.slice(0, 200) }; }
  const softSkip = json?.status === 'skipped' || json?.status === 'deferred';
  return {
    ok: res.ok && !softSkip,
    status: res.status,
    ms: Date.now() - t0,
    body: json,
    error: !res.ok || softSkip
      ? (json?.message || json?.error || (softSkip ? `soft_${json?.status}` : 'http_error'))
      : null
  };
}

/** Ordered Full-equivalent steps (APIs the Dashboard Full Refresh uses). */
function buildSteps(propertyUrl) {
  const q = encodeURIComponent(propertyUrl);
  return [
    { key: 'squarespace_revenue', method: 'POST', path: '/api/aigeo/squarespace-revenue-sync' },
    { key: 'stripe_revenue', method: 'POST', path: '/api/aigeo/stripe-revenue-sync' },
    { key: 'ga4_site_metrics', method: 'POST', path: '/api/cron/ga4-metrics-sync' },
    { key: 'ga4_channels', method: 'POST', path: '/api/cron/ga4-channels-sync' },
    { key: 'revenue_truth_cache', method: 'POST', path: '/api/cron/revenue-truth-cache-refresh' },
    { key: 'gbp_brand', method: 'POST', path: '/api/cron/gbp-brand-demand-sync' },
    { key: 'gsc_backlink_audit', method: 'GET', path: `/api/cron/daily-gsc-backlink?force=1&propertyUrl=${q}` },
    { key: 'ranking_ai', method: 'GET', path: `/api/cron/keyword-ranking-ai?force=1&propertyUrl=${q}` },
    { key: 'llm_mentions', method: 'POST', path: '/api/cron/llm-mentions-sync' },
    { key: 'youtube_stats', method: 'POST', path: '/api/cron/youtube-stats-sync' },
    {
      key: 'dfs_backlink_summary',
      method: 'POST',
      path: '/api/aigeo/dataforseo-backlink-summary',
      body: { action: 'refresh', domain: 'alanranger.com' }
    },
    {
      key: 'domain_strength',
      method: 'POST',
      path: '/api/domain-strength/snapshot',
      body: { mode: 'run', includePending: true }
    },
    {
      key: 'bulk_update_tasks',
      method: 'POST',
      path: `/api/optimisation/bulk-update?propertyUrl=${q}`
    },
    { key: 'ceo_weekly_email', kind: 'email' }
  ];
}

function emptyProgress(weekStart) {
  return { week_start: weekStart, step_index: 0, steps: [], email_sent: false };
}

async function loadState(sb) {
  const { data } = await sb
    .from('system_maintenance_state')
    .select('*')
    .eq('key', FLAG_KEY)
    .maybeSingle();
  return data || null;
}

async function saveState(sb, patch) {
  const now = new Date().toISOString();
  const row = {
    key: FLAG_KEY,
    updated_at: now,
    ...patch
  };
  const { error } = await sb.from('system_maintenance_state').upsert(row, { onConflict: 'key' });
  if (error) throw new Error(error.message);
  return row;
}

function readProgress(state, weekStart) {
  const details = state?.last_details;
  if (details && typeof details === 'object' && details.week_start === weekStart) {
    return details;
  }
  if (state?.last_error && String(state.last_error).startsWith('{')) {
    try {
      const parsed = JSON.parse(state.last_error);
      if (parsed?.week_start === weekStart) return parsed;
    } catch { /* ignore */ }
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  if (!['GET', 'POST'].includes(req.method)) return sendJson(res, 405, { error: 'method_not_allowed' });
  if (!authoriseCron(req)) return sendJson(res, 401, { error: 'unauthorized' });

  const sb = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
  const weekStart = londonWeekStartYmd();
  const propertyUrl = String(req.query?.propertyUrl || DEFAULT_PROPERTY).trim();
  const base = baseUrl(req);
  const allSteps = buildSteps(propertyUrl);
  const forceRestart = String(req.query?.restart || '').toLowerCase() === 'true';

  try {
    const state = await loadState(sb);
    let progress = forceRestart ? emptyProgress(weekStart) : (readProgress(state, weekStart) || emptyProgress(weekStart));

    // Same week already finished — idle until next Monday
    if (!forceRestart && progress.email_sent && state?.state === 'done') {
      return sendJson(res, 200, { ok: true, status: 'already_done', weekStart, progress });
    }

    // Steps finished but email failed — retry email only on later ticks / backup window
    if (!forceRestart && progress.step_index >= allSteps.length && !progress.email_sent) {
      progress.step_index = allSteps.length - 1;
      progress.steps = (progress.steps || []).filter((s) => s.key !== 'ceo_weekly_email');
    }

    await saveState(sb, {
      state: 'running',
      started_at: (progress.step_index === 0 ? new Date().toISOString() : (state?.started_at || new Date().toISOString())),
      finished_at: null,
      last_error: null,
      last_details: progress
    });

    // One heavy step per tick; batch light steps
    const LIGHT = new Set([
      'squarespace_revenue', 'stripe_revenue', 'ga4_site_metrics', 'ga4_channels',
      'revenue_truth_cache', 'gbp_brand', 'llm_mentions', 'youtube_stats', 'dfs_backlink_summary'
    ]);
    let ran = 0;
    const maxPerTick = 4;

    while (progress.step_index < allSteps.length && ran < maxPerTick) {
      const step = allSteps[progress.step_index];
      if (ran > 0 && !LIGHT.has(step.key)) break;

      let result;
      if (step.kind === 'email') {
        const report = await runCeoWeeklyReport({
          weekStart,
          propertyUrl,
          skipGate: true,
          forceResend: true,
          dryRun: false,
          refreshLog: {
            source: 'monday_full_refresh_cron',
            status: progress.email_sent ? 'ok' : 'partial',
            steps: progress.steps,
            finished_at: new Date().toISOString()
          }
        });
        const ok = report?.mode === 'report' || report?.mode === 'already_sent';
        result = {
          ok,
          status: 200,
          ms: null,
          body: report,
          error: report?.mode === 'fail_safe' ? (report?.gate?.reason || 'fail_safe') : null
        };
        if (result.ok) progress.email_sent = true;
      } else {
        result = await hit(base, step.path, { method: step.method, body: step.body });
      }

      progress.steps.push({
        key: step.key,
        ok: !!result.ok,
        status: result.status,
        ms: result.ms,
        error: result.error || null,
        at: new Date().toISOString()
      });
      progress.step_index += 1;
      ran += 1;

      await saveState(sb, {
        state: 'running',
        last_details: progress,
        last_error: null
      });

      if (!LIGHT.has(step.key)) break;
    }

    const done = progress.step_index >= allSteps.length;
    if (done) {
      await saveState(sb, {
        state: progress.email_sent ? 'done' : 'failed',
        finished_at: new Date().toISOString(),
        last_success_at: progress.email_sent ? new Date().toISOString() : state?.last_success_at || null,
        last_details: progress,
        last_error: progress.email_sent ? null : 'full_refresh_email_failed'
      });
      await sb.from('ceo_weekly_refresh_runs').upsert({
        week_start: weekStart,
        status: progress.email_sent ? 'ok' : 'partial',
        steps: progress.steps,
        finished_at: new Date().toISOString(),
        error: progress.email_sent ? null : 'full_refresh_email_failed'
      }, { onConflict: 'week_start' });
    }

    return sendJson(res, 200, {
      ok: true,
      status: done ? (progress.email_sent ? 'done' : 'failed') : 'continue',
      weekStart,
      next_step: done ? null : allSteps[progress.step_index]?.key,
      progress
    });
  } catch (err) {
    try {
      await saveState(sb, {
        state: 'failed',
        finished_at: new Date().toISOString(),
        last_error: err?.message || String(err)
      });
    } catch { /* ignore */ }
    return sendJson(res, 500, { ok: false, error: err?.message || String(err) });
  }
}

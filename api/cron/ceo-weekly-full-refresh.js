/**
 * Unattended Monday Full Refresh — same Full-tier steps as the dashboard
 * Full Refresh button (globalRunStepCatalog Full), including CEO HTML email.
 *
 * Ranking AI uses dashboard-parity batched ticks (SERP 20 / AI 10 / depth 50),
 * not the old /api/cron/keyword-ranking-ai monolith.
 *
 * Schedule: every 15 min Mon 00:00–04:45 UTC (before 05:45 UTC backup report).
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { createClient } from '@supabase/supabase-js';
import { authoriseCron, sendJson, londonWeekStartYmd, DEFAULT_PROPERTY } from '../../lib/ceo-weekly/shared.js';
import { runCeoWeeklyReport } from '../../lib/ceo-weekly/report.js';
import {
  buildDashboardFullSteps,
  runFullStep
} from '../../lib/ceo-weekly/dashboard-full-catalog.js';

const FLAG_KEY = 'ceo_monday_full_refresh';
/** UTC hour:minute — after this, skip remaining data steps and send CEO email. */
const EMAIL_DEADLINE_UTC_MIN = 4 * 60 + 15; // 04:15 UTC (before 05:45 backup)
/** Max continue-ticks for ranking / domain_strength before force-skip. */
const MAX_MULTI_TICKS = 12;

function need(key) {
  const v = process.env[key];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${key}`);
  return v;
}

function utcMinutesNow() {
  const d = new Date();
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function pastEmailDeadline() {
  return utcMinutesNow() >= EMAIL_DEADLINE_UTC_MIN;
}

/** Jump cursor to CEO email. Do NOT mark audit/ranking failed — still send numbers. */
function jumpToEmail(progress, allSteps, reason) {
  const emailIdx = allSteps.findIndex((s) => s.key === 'ceo_weekly_email' || s.kind === 'email');
  if (emailIdx < 0) return;
  while (progress.step_index < emailIdx) {
    const step = allSteps[progress.step_index];
    progress.steps.push({
      key: step.key,
      ok: true,
      status: 200,
      ms: 0,
      error: `deadline_skip:${reason}`,
      at: new Date().toISOString()
    });
    progress.step_index += 1;
  }
  progress.deadline_skipped = reason;
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

function emptyProgress(weekStart) {
  return {
    week_start: weekStart,
    step_index: 0,
    steps: [],
    failed_keys: [],
    email_sent: false,
    ranking: null,
    domain_strength: null
  };
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
  const row = { key: FLAG_KEY, updated_at: now, ...patch };
  const { error } = await sb.from('system_maintenance_state').upsert(row, { onConflict: 'key' });
  if (error) throw new Error(error.message);
  return row;
}

function readProgress(state, weekStart) {
  const details = state?.last_details;
  if (details && typeof details === 'object' && details.week_start === weekStart) return details;
  return null;
}

function depsFailed(step, failedKeys) {
  if (!step.dependsOn?.length) return null;
  const bad = step.dependsOn.filter((d) => failedKeys.includes(d));
  return bad.length ? bad.join(', ') : null;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  if (!['GET', 'POST'].includes(req.method)) return sendJson(res, 405, { error: 'method_not_allowed' });
  if (!authoriseCron(req)) return sendJson(res, 401, { error: 'unauthorized' });

  const sb = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
  const weekStart = londonWeekStartYmd();
  const propertyUrl = String(req.query?.propertyUrl || DEFAULT_PROPERTY).trim();
  const base = baseUrl(req);
  const headers = cronHeaders();
  const allSteps = buildDashboardFullSteps(propertyUrl);
  const forceRestart = String(req.query?.restart || '').toLowerCase() === 'true';

  try {
    const state = await loadState(sb);
    let progress = forceRestart
      ? emptyProgress(weekStart)
      : (readProgress(state, weekStart) || emptyProgress(weekStart));
    if (!Array.isArray(progress.failed_keys)) progress.failed_keys = [];

    if (!forceRestart && progress.email_sent && state?.state === 'done') {
      return sendJson(res, 200, { ok: true, status: 'already_done', weekStart, progress });
    }

    if (!forceRestart && progress.step_index >= allSteps.length && !progress.email_sent) {
      progress.step_index = allSteps.length - 1;
      progress.steps = (progress.steps || []).filter((s) => s.key !== 'ceo_weekly_email');
    }

    // Guarantee CEO email inside the Monday window even if Ranking/DFS stalls
    if (!progress.email_sent && pastEmailDeadline()) {
      jumpToEmail(progress, allSteps, 'past_0415_utc');
    }

    await saveState(sb, {
      state: 'running',
      started_at: progress.step_index === 0
        ? new Date().toISOString()
        : (state?.started_at || new Date().toISOString()),
      finished_at: null,
      last_error: null,
      last_details: progress
    });

    let ran = 0;
    const maxPerTick = 4;

    while (progress.step_index < allSteps.length && ran < maxPerTick) {
      const step = allSteps[progress.step_index];
      if (ran > 0 && !step.light) break;

      const skipDeps = depsFailed(step, progress.failed_keys);
      let result;

      if (skipDeps) {
        result = {
          ok: false,
          done: true,
          status: 200,
          ms: 0,
          body: null,
          error: `Skipped — ${skipDeps} failed`
        };
      } else if (step.kind === 'email') {
        const criticalFailed = progress.failed_keys.includes('audit_scan')
          || progress.failed_keys.includes('ranking_ai');
        const partial = progress.failed_keys.length > 0;
        const report = await runCeoWeeklyReport({
          weekStart,
          propertyUrl,
          skipGate: true,
          forceResend: true,
          forceFailSafe: criticalFailed,
          failReason: criticalFailed
            ? `monday_full_deps_failed:${progress.failed_keys.join(',')}`
            : undefined,
          dryRun: false,
          refreshLog: {
            source: 'monday_full_refresh_cron',
            status: criticalFailed || partial ? 'partial' : 'ok',
            steps: progress.steps,
            finished_at: new Date().toISOString()
          }
        });
        const ok = report?.mode === 'report'
          || report?.mode === 'already_sent'
          || report?.mode === 'fail_safe';
        result = {
          ok,
          done: true,
          status: 200,
          ms: null,
          body: report,
          error: report?.mode === 'fail_safe' && criticalFailed
            ? (report?.gate?.reason || 'fail_safe')
            : null
        };
        if (ok) progress.email_sent = true;
      } else {
        result = await runFullStep(step, { base, headers, propertyUrl, progress });
      }

      if (result.ranking) progress.ranking = result.ranking;
      if (result.domain_strength) progress.domain_strength = result.domain_strength;

      let stepDone = result.done !== false;
      if (!stepDone && (step.kind === 'ranking_parity' || step.kind === 'domain_strength')) {
        progress.multi_ticks = (progress.multi_ticks || 0) + 1;
        if (progress.multi_ticks >= MAX_MULTI_TICKS || pastEmailDeadline()) {
          result = {
            ok: true,
            done: true,
            status: 200,
            ms: result.ms,
            body: result.body,
            error: pastEmailDeadline() ? 'deadline_abort_multi_tick' : `max_multi_ticks_${MAX_MULTI_TICKS}`
          };
          stepDone = true;
        }
      } else if (stepDone) {
        progress.multi_ticks = 0;
      }

      if (stepDone) {
        progress.steps.push({
          key: step.key,
          ok: !!result.ok,
          status: result.status,
          ms: result.ms,
          error: result.error || null,
          at: new Date().toISOString()
        });
        const err = String(result.error || '');
        if (!result.ok && !err.startsWith('Skipped') && !err.startsWith('deadline') && !err.startsWith('max_multi')) {
          progress.failed_keys.push(step.key);
        }
        if (step.key === 'ranking_ai') progress.ranking = null;
        if (step.key === 'domain_strength') progress.domain_strength = null;
        progress.step_index += 1;
        ran += 1;
      } else {
        await saveState(sb, { state: 'running', last_details: progress, last_error: null });
        return sendJson(res, 200, {
          ok: true,
          status: 'continue',
          weekStart,
          next_step: step.key,
          progress,
          tick: result.body || null
        });
      }

      await saveState(sb, { state: 'running', last_details: progress, last_error: null });
      if (!step.light) break;
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
        status: progress.email_sent
          ? (progress.failed_keys.length ? 'partial' : 'ok')
          : 'partial',
        steps: progress.steps,
        finished_at: new Date().toISOString(),
        error: progress.email_sent
          ? (progress.failed_keys.length ? `partial:${progress.failed_keys.join(',')}` : null)
          : 'full_refresh_email_failed'
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

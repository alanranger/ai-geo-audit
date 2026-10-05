/**
 * Unattended Monday Full Refresh — same Full-tier steps as the dashboard
 * Full Refresh button, including CEO HTML email.
 *
 * Ranking uses the same endpoints/depth as dashboard loadRankingAiData, but
 * serverless cannot keep a 90‑min browser loop. Each cron tick:
 *  - runs small SERP/AI batches (5) that fit under Vercel maxDuration
 *  - checkpoints progress after every paid batch (no re-buy on timeout)
 *  - hard-aborts Ranking after ~90 min (dashboard-like ceiling) or too many ticks
 *
 * Schedule: every 15 min Monday UTC.
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { createClient } from '@supabase/supabase-js';
import { authoriseCron, sendJson, londonWeekStartYmd, DEFAULT_PROPERTY } from '../../lib/ceo-weekly/shared.js';
import { runCeoWeeklyReport } from '../../lib/ceo-weekly/report.js';
import {
  buildDashboardFullSteps,
  runFullStep
} from '../../lib/ceo-weekly/dashboard-full-catalog.js';
import {
  CRON_AI_BATCH_SIZE,
  CRON_SERP_BATCH_SIZE,
  CRON_TICK_BUDGET_MS,
  isHaltRequested,
  rankingTicksExceeded,
  rankingWallExceeded,
  slimRankingForPersist
} from '../../lib/ceo-weekly/monday-ranking-guards.js';

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

function emptyProgress(weekStart) {
  return {
    week_start: weekStart,
    step_index: 0,
    steps: [],
    failed_keys: [],
    email_sent: false,
    cancelled: false,
    ranking: null,
    ranking_started_at: null,
    domain_strength: null,
    multi_ticks: 0
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

function abortRankingResult(reason) {
  return {
    ok: false,
    done: true,
    status: 200,
    ms: 0,
    body: { aborted: true, reason },
    error: reason,
    ranking: null
  };
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
  const cancelQuery = String(req.query?.cancel || '').toLowerCase() === 'true';

  try {
    const state = await loadState(sb);
    let progress = forceRestart
      ? emptyProgress(weekStart)
      : (readProgress(state, weekStart) || emptyProgress(weekStart));
    if (!Array.isArray(progress.failed_keys)) progress.failed_keys = [];

    if (cancelQuery) {
      progress.cancelled = true;
      progress.ranking = null;
      await saveState(sb, {
        state: 'cancelled',
        finished_at: new Date().toISOString(),
        last_error: 'cancelled_via_query',
        last_details: progress
      });
      return sendJson(res, 200, { ok: true, status: 'cancelled', weekStart, progress });
    }

    if (isHaltRequested(state, progress, { forceRestart, cancelQuery: false })) {
      return sendJson(res, 200, {
        ok: true,
        status: progress.cancelled ? 'cancelled' : 'already_done',
        weekStart,
        progress
      });
    }

    if (!forceRestart && progress.step_index >= allSteps.length && !progress.email_sent) {
      progress.step_index = allSteps.length - 1;
      progress.steps = (progress.steps || []).filter((s) => s.key !== 'ceo_weekly_email');
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
      } else if (step.key === 'ranking_ai' && rankingWallExceeded(progress)) {
        result = abortRankingResult('ranking_aborted_wall_clock_90m');
      } else if (step.key === 'ranking_ai' && rankingTicksExceeded(progress)) {
        result = abortRankingResult('ranking_aborted_max_ticks');
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
        if (step.key === 'ranking_ai' && !progress.ranking_started_at) {
          progress.ranking_started_at = new Date().toISOString();
        }
        result = await runFullStep(step, {
          base,
          headers,
          propertyUrl,
          progress,
          rankingBudgetMs: CRON_TICK_BUDGET_MS,
          rankingSerpBatchSize: CRON_SERP_BATCH_SIZE,
          rankingAiBatchSize: CRON_AI_BATCH_SIZE,
          onRankingProgress: async (rankingState) => {
            progress.ranking = slimRankingForPersist(rankingState);
            await saveState(sb, {
              state: 'running',
              last_details: progress,
              last_error: null
            });
          }
        });
      }

      if (result.ranking) progress.ranking = slimRankingForPersist(result.ranking);
      if (result.domain_strength) progress.domain_strength = result.domain_strength;

      const stepDone = result.done !== false;
      if (stepDone) {
        progress.multi_ticks = 0;
        progress.steps.push({
          key: step.key,
          ok: !!result.ok,
          status: result.status,
          ms: result.ms,
          error: result.error || null,
          at: new Date().toISOString()
        });
        const err = String(result.error || '');
        if (!result.ok && !err.startsWith('Skipped')) {
          progress.failed_keys.push(step.key);
        }
        if (step.key === 'ranking_ai') {
          // Incomplete ranking must not clear as a clean success — leave failed_keys marked.
          if (result.ok) {
            progress.ranking = null;
            progress.ranking_started_at = null;
          } else if (String(result.error || '').startsWith('ranking_incomplete')) {
            progress.ranking = null;
            progress.ranking_started_at = null;
            progress.ranking_incomplete = true;
          }
        }
        if (step.key === 'domain_strength') progress.domain_strength = null;
        progress.step_index += 1;
        ran += 1;
      } else {
        progress.multi_ticks = (progress.multi_ticks || 0) + 1;
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

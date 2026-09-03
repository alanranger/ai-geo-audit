/**
 * Monday 01:00 orchestrator — warm the same data paths the dashboard relies on.
 * Logs every step to ceo_weekly_refresh_runs for the report fail-safe gate.
 */
import { createClient } from '@supabase/supabase-js';
import { DEFAULT_PROPERTY, londonWeekStartYmd } from './shared.js';

function need(key) {
  const v = process.env[key];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${key}`);
  return v;
}

function baseUrl() {
  return (
    process.env.CEO_WEEKLY_BASE_URL
    || process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    || process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`
    || 'https://ai-geo-audit.vercel.app'
  ).replace(/\/$/, '');
}

async function hit(path, opts = {}) {
  const url = `${baseUrl()}${path}`;
  const headers = { ...(opts.headers || {}) };
  const secret = process.env.CRON_SECRET;
  if (secret) headers['x-cron-secret'] = secret;
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: opts.method || 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text?.slice(0, 200) }; }
    return {
      ok: res.ok,
      status: res.status,
      ms: Date.now() - t0,
      body: json
    };
  } catch (err) {
    return { ok: false, status: 0, ms: Date.now() - t0, error: err?.message || String(err) };
  }
}

/** Ordered warm steps — best-effort; failures are recorded, not swallowed silently. */
const STEPS = [
  { key: 'squarespace_revenue', path: '/api/aigeo/squarespace-revenue-sync' },
  { key: 'stripe_revenue', path: '/api/aigeo/stripe-revenue-sync' },
  { key: 'ga4_site_metrics', path: '/api/cron/ga4-metrics-sync', method: 'GET' },
  { key: 'ga4_channels', path: '/api/cron/ga4-channels-sync', method: 'GET' },
  { key: 'revenue_truth_cache', path: '/api/cron/revenue-truth-cache-refresh' },
  { key: 'gbp_brand', path: '/api/cron/gbp-brand-demand-sync', method: 'GET' },
  { key: 'llm_mentions', path: '/api/cron/llm-mentions-sync', method: 'GET' },
  { key: 'youtube_stats', path: '/api/cron/youtube-stats-sync', method: 'GET' },
  {
    key: 'dfs_backlink_summary',
    path: '/api/aigeo/dataforseo-backlink-summary',
    method: 'POST',
    body: { action: 'refresh', domain: 'alanranger.com' }
  }
];

export async function runCeoWeeklyRefresh(opts = {}) {
  const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
  const weekStart = opts.weekStart || londonWeekStartYmd();
  const { data: run, error: insErr } = await supabase
    .from('ceo_weekly_refresh_runs')
    .insert({ week_start: weekStart, status: 'running', steps: [] })
    .select('*')
    .single();
  if (insErr) throw new Error(insErr.message);

  const steps = [];
  let failed = 0;
  for (const step of STEPS) {
    if (opts.skipKeys?.includes(step.key)) {
      steps.push({ key: step.key, skipped: true });
      continue;
    }
    const result = await hit(step.path, {
      method: step.method,
      body: step.body,
      headers: step.headers
    });
    const row = {
      key: step.key,
      ok: !!result.ok,
      status: result.status,
      ms: result.ms,
      error: result.error || (!result.ok ? (result.body?.message || result.body?.error || 'http_error') : null)
    };
    steps.push(row);
    if (!row.ok) failed += 1;
    await supabase
      .from('ceo_weekly_refresh_runs')
      .update({ steps })
      .eq('id', run.id);
  }

  // Sanity: Revenue Truth cache must be present after warm
  const { data: cacheRow } = await supabase
    .from('revenue_truth_payload_cache')
    .select('computed_at')
    .eq('property_url', DEFAULT_PROPERTY)
    .eq('cache_key', 'findings:v1')
    .maybeSingle();
  const cacheAgeH = cacheRow?.computed_at
    ? (Date.now() - new Date(cacheRow.computed_at).getTime()) / 3600000
    : null;
  const cacheOk = cacheAgeH != null && cacheAgeH < 30;
  if (!cacheOk) {
    failed += 1;
    steps.push({
      key: 'postflight_revenue_truth_cache',
      ok: false,
      error: cacheRow ? `stale_${cacheAgeH?.toFixed(1)}h` : 'missing_findings_cache'
    });
  } else {
    steps.push({ key: 'postflight_revenue_truth_cache', ok: true, age_h: Number(cacheAgeH.toFixed(2)) });
  }

  // Critical path: revenue syncs + truth cache — soft-fail optional channels
  const criticalKeys = new Set(['squarespace_revenue', 'stripe_revenue', 'revenue_truth_cache', 'postflight_revenue_truth_cache']);
  const criticalFail = steps.some((s) => criticalKeys.has(s.key) && s.ok === false);
  const status = criticalFail ? 'failed' : (failed ? 'partial' : 'ok');
  const error = criticalFail
    ? steps.filter((s) => criticalKeys.has(s.key) && !s.ok).map((s) => `${s.key}:${s.error}`).join('; ')
    : null;

  const { data: finished } = await supabase
    .from('ceo_weekly_refresh_runs')
    .update({
      status,
      steps,
      error,
      finished_at: new Date().toISOString()
    })
    .eq('id', run.id)
    .select('*')
    .single();

  return { run: finished || { ...run, status, steps, error }, weekStart, criticalFail, failed };
}

/** Fail-safe gate for the report job. */
export async function latestRefreshGate(supabase, weekStart) {
  const { data, error } = await supabase
    .from('ceo_weekly_refresh_runs')
    .select('*')
    .eq('week_start', weekStart)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, reason: error.message, run: null };
  if (!data) return { ok: false, reason: 'no_refresh_run_for_week', run: null };
  if (data.status === 'running') return { ok: false, reason: 'refresh_still_running', run: data };
  if (data.status === 'failed') return { ok: false, reason: data.error || 'refresh_failed', run: data };
  // partial is allowed only if critical path ok (status would be failed otherwise)
  if (!data.finished_at) return { ok: false, reason: 'refresh_incomplete', run: data };
  const ageH = (Date.now() - new Date(data.finished_at).getTime()) / 3600000;
  if (ageH > 12) return { ok: false, reason: `refresh_stale_${ageH.toFixed(1)}h`, run: data };
  return { ok: true, reason: null, run: data };
}

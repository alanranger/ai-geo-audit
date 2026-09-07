/**
 * Monday refresh — revenue warm only.
 * Full audit jobs run as separate Monday crons (GSC + Ranking) so each can use
 * its own time budget; the report (~6h later) gates on today's audit freshness.
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
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`)
    || (process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`)
    || 'https://ai-geo-audit.vercel.app'
  ).replace(/\/$/, '');
}

function londonYmd() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

async function hit(path, opts = {}) {
  const url = `${baseUrl()}${path}`;
  const headers = { ...(opts.headers || {}) };
  const secret = process.env.CRON_SECRET;
  if (secret) headers['x-cron-secret'] = secret;
  const method = opts.method || 'POST';
  const t0 = Date.now();
  try {
    const init = { method, headers: { ...headers } };
    if (method !== 'GET' && method !== 'HEAD') {
      init.headers['Content-Type'] = 'application/json';
      if (opts.body) init.body = JSON.stringify(opts.body);
    }
    const res = await fetch(url, init);
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text?.slice(0, 200) }; }
    const softSkip = json?.status === 'skipped' || json?.status === 'deferred';
    return {
      ok: res.ok && !softSkip,
      status: res.status,
      ms: Date.now() - t0,
      body: json,
      softSkip
    };
  } catch (err) {
    return { ok: false, status: 0, ms: Date.now() - t0, error: err?.message || String(err) };
  }
}

const STEPS = [
  { key: 'squarespace_revenue', path: '/api/aigeo/squarespace-revenue-sync' },
  { key: 'stripe_revenue', path: '/api/aigeo/stripe-revenue-sync' },
  { key: 'ga4_site_metrics', path: '/api/cron/ga4-metrics-sync', method: 'POST' },
  { key: 'ga4_channels', path: '/api/cron/ga4-channels-sync', method: 'POST' },
  { key: 'revenue_truth_cache', path: '/api/cron/revenue-truth-cache-refresh' },
  { key: 'gbp_brand', path: '/api/cron/gbp-brand-demand-sync', method: 'POST' },
  { key: 'llm_mentions', path: '/api/cron/llm-mentions-sync', method: 'POST' },
  { key: 'youtube_stats', path: '/api/cron/youtube-stats-sync', method: 'POST' },
  {
    key: 'dfs_backlink_summary',
    path: '/api/aigeo/dataforseo-backlink-summary',
    method: 'POST',
    body: { action: 'refresh', domain: 'alanranger.com' }
  }
];

const CRITICAL_KEYS = new Set([
  'squarespace_revenue',
  'stripe_revenue',
  'revenue_truth_cache',
  'postflight_revenue_truth_cache'
]);

export async function auditFreshness(supabase) {
  const today = londonYmd();
  const { data: audit } = await supabase
    .from('audit_results')
    .select('audit_date')
    .ilike('property_url', '%alanranger.com%')
    .order('audit_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: ranks } = await supabase
    .from('keyword_rankings')
    .select('audit_date')
    .ilike('property_url', '%alanranger.com%')
    .order('audit_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  const auditDate = audit?.audit_date || null;
  const rankingsDate = ranks?.audit_date || null;
  return {
    ok: auditDate === today && rankingsDate === today,
    today,
    auditDate,
    rankingsDate
  };
}

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
    const result = await hit(step.path, { method: step.method, body: step.body });
    const row = {
      key: step.key,
      ok: !!result.ok,
      status: result.status,
      ms: result.ms,
      error: result.error
        || (!result.ok
          ? (result.softSkip
            ? `soft_${result.body?.status || 'skip'}:${result.body?.message || 'not_run'}`
            : (result.body?.message || result.body?.error || 'http_error'))
          : null)
    };
    steps.push(row);
    if (!row.ok) failed += 1;
    await supabase.from('ceo_weekly_refresh_runs').update({ steps }).eq('id', run.id);
  }

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

  const criticalFail = steps.some((s) => CRITICAL_KEYS.has(s.key) && s.ok === false && !s.skipped);
  const status = criticalFail ? 'failed' : (failed ? 'partial' : 'ok');
  const error = criticalFail
    ? steps.filter((s) => CRITICAL_KEYS.has(s.key) && !s.ok && !s.skipped).map((s) => `${s.key}:${s.error}`).join('; ')
    : null;

  const { data: finished } = await supabase
    .from('ceo_weekly_refresh_runs')
    .update({ status, steps, error, finished_at: new Date().toISOString() })
    .eq('id', run.id)
    .select('*')
    .single();

  return { run: finished || { ...run, status, steps, error }, weekStart, criticalFail, failed };
}

/** Report gate: revenue refresh ok + today's GSC audit + today's Ranking & AI. */
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
  if (!data.finished_at) return { ok: false, reason: 'refresh_incomplete', run: data };
  const ageH = (Date.now() - new Date(data.finished_at).getTime()) / 3600000;
  if (ageH > 12) return { ok: false, reason: `refresh_stale_${ageH.toFixed(1)}h`, run: data };

  const fresh = await auditFreshness(supabase);
  if (!fresh.ok) {
    return {
      ok: false,
      reason: `audit_not_fresh(today=${fresh.today}, audit=${fresh.auditDate}, rankings=${fresh.rankingsDate})`,
      run: data,
      fresh
    };
  }
  return { ok: true, reason: null, run: data, fresh };
}

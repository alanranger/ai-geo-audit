/**
 * Monday Full Refresh step catalog — mirrors audit-dashboard.html
 * globalRunStepCatalog() Full tier keys, endpoints, and bodies.
 *
 * Ranking AI uses dashboard-parity ticks (same SERP/AI batch sizes + params
 * as loadRankingAiData), not /api/cron/keyword-ranking-ai monolith.
 */

import { runDashboardParityRankingTick } from '../keyword-ranking/dashboard-parity-tick.js';

export const DEFAULT_PROPERTY = 'https://www.alanranger.com';
export const DFS_DOMAIN = 'alanranger.com';

/** Full-tier revenue window: first day of month 12 months ago → today (dashboard). */
export function fullRevenueDateRange(today = new Date()) {
  const end = today.toISOString().slice(0, 10);
  const startDt = new Date(today.getFullYear(), today.getMonth() - 12, 1);
  return { start: startDt.toISOString().slice(0, 10), end };
}

/**
 * Ordered Full steps. Same keys as dashboard Full catalog (+ ceo_weekly_email).
 * dependsOn matches dashboard for skip-on-dep-failure behaviour.
 */
export function buildDashboardFullSteps(propertyUrl = DEFAULT_PROPERTY) {
  const q = encodeURIComponent(propertyUrl);
  const { start, end } = fullRevenueDateRange();
  const revenueBody = { propertyUrl, period_start: start, period_end: end };

  return [
    {
      key: 'sync_csv',
      label: 'Sync CSV',
      dependsOn: [],
      light: true,
      method: 'GET',
      path: '/api/sync-csv'
    },
    {
      key: 'audit_scan',
      label: 'GSC & Backlink Audit',
      dependsOn: [],
      light: false,
      // Server equivalent of window.runAudit GSC/backlink persist path
      method: 'GET',
      path: `/api/cron/daily-gsc-backlink?force=1&propertyUrl=${q}`
    },
    {
      key: 'ranking_ai',
      label: 'Ranking & AI scan (tracked keywords)',
      dependsOn: [],
      light: false,
      kind: 'ranking_parity'
    },
    {
      key: 'llm_visibility',
      label: 'ChatGPT / LLM visibility',
      dependsOn: ['ranking_ai'],
      light: false,
      method: 'POST',
      path: '/api/aigeo/llm-visibility-collect'
    },
    {
      key: 'revenue_sync',
      label: 'Revenue sync (Squarespace + Stripe, 13mo)',
      dependsOn: [],
      light: true,
      kind: 'revenue_pair',
      bodies: [
        { path: '/api/aigeo/squarespace-revenue-sync', body: revenueBody },
        { path: '/api/aigeo/stripe-revenue-sync', body: revenueBody }
      ]
    },
    {
      key: 'ga4_sync',
      label: 'GA4 enquiry metrics (28d)',
      dependsOn: [],
      light: true,
      method: 'POST',
      path: '/api/aigeo/ga4-metrics',
      body: { propertyUrl, refresh: true }
    },
    {
      key: 'rf_summary',
      label: 'Revenue Funnel summary refresh',
      dependsOn: [],
      light: true,
      method: 'GET',
      path: `/api/aigeo/revenue-funnel-summary?propertyUrl=${q}&includeJlr=true`
    },
    {
      key: 'rf_trust_loop',
      label: 'Revenue Funnel trust loop',
      dependsOn: ['audit_scan'],
      light: true,
      method: 'GET',
      path: `/api/aigeo/revenue-funnel-trust-loop?propertyUrl=${q}`
    },
    {
      key: 'rf_seasonality',
      label: 'Revenue Funnel seasonality bands',
      dependsOn: [],
      light: true,
      method: 'GET',
      path: `/api/aigeo/revenue-funnel-seasonality?propertyUrl=${q}`
    },
    {
      key: 'scenario_auto_optimise',
      label: 'Scenario Planning Auto-Optimise',
      dependsOn: ['audit_scan'],
      light: false,
      method: 'GET',
      path: `/api/aigeo/revenue-funnel-auto-optimise?propertyUrl=${q}`
    },
    {
      key: 'scenario_cockpit',
      label: 'Scenario Planning cockpit refresh',
      dependsOn: [],
      light: true,
      kind: 'ui_noop',
      note: 'Dashboard re-renders charts from prior API data; no extra server write'
    },
    {
      key: 'money_pages',
      label: 'Reload Money Pages view',
      dependsOn: ['audit_scan'],
      light: true,
      kind: 'ui_noop',
      note: 'Dashboard reloads Money Pages from latest audit_results; data already persisted by audit_scan'
    },
    {
      key: 'trad_seo_full',
      label: 'Traditional SEO + full extractability refresh',
      dependsOn: ['audit_scan'],
      light: false,
      method: 'POST',
      path: '/api/aigeo/content-extractability?tier=all&refreshTiersSource=true',
      body: { tier: 'all' }
    },
    {
      key: 'ke_topup',
      label: 'Keywords Everywhere top-up (stale rows)',
      dependsOn: [],
      light: false,
      kind: 'ke_topup'
    },
    {
      key: 'dfs_full_index',
      label: 'DataForSEO backlink full index',
      dependsOn: [],
      light: false,
      method: 'POST',
      path: '/api/aigeo/dataforseo-backlink-domain',
      body: { action: 'full', domain: DFS_DOMAIN }
    },
    {
      key: 'gsc_url_inspection',
      label: 'GSC URL Inspection refresh',
      dependsOn: ['audit_scan'],
      light: false,
      kind: 'gsc_url_inspection'
    },
    {
      key: 'domain_strength',
      label: 'Domain Strength snapshot (all batches)',
      dependsOn: [],
      light: false,
      kind: 'domain_strength'
    },
    {
      key: 'acquisition_channels',
      label: 'Acquisition channels (AI mentions + YouTube + GA4)',
      dependsOn: [],
      light: true,
      kind: 'acquisition_channels'
    },
    {
      key: 'update_tasks',
      label: 'Update all tasks with latest data',
      dependsOn: ['audit_scan'],
      light: false,
      method: 'POST',
      path: `/api/optimisation/bulk-update?propertyUrl=${q}`
    },
    {
      key: 'ceo_weekly_email',
      label: 'CEO weekly HTML email',
      dependsOn: [],
      light: false,
      kind: 'email'
    }
  ];
}

export async function hit(base, path, opts = {}) {
  const method = opts.method || 'GET';
  const init = { method, headers: { ...(opts.headers || {}) } };
  if (method !== 'GET' && method !== 'HEAD') {
    init.headers['Content-Type'] = 'application/json';
    if (opts.body) init.body = JSON.stringify(opts.body);
  }
  const t0 = Date.now();
  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text?.slice(0, 200) };
  }
  const softSkip = json?.status === 'skipped' || json?.status === 'deferred';
  return {
    ok: res.ok && !softSkip && json?.ok !== false && json?.status !== 'error',
    status: res.status,
    ms: Date.now() - t0,
    body: json,
    error: !res.ok || softSkip || json?.ok === false || json?.status === 'error'
      ? (json?.message || json?.error || (softSkip ? `soft_${json?.status}` : 'http_error'))
      : null
  };
}

async function runKeTopup(base, propertyUrl, headers) {
  // Mirror traditionalSeoRefreshKeywordMetricsFromProvider intent: refresh stale KE rows.
  // Pull pairs from latest evaluation cache when present; otherwise no-op ok.
  const cache = await hit(
    base,
    `/api/aigeo/traditional-seo-evaluation-cache?propertyUrl=${encodeURIComponent(propertyUrl)}`,
    { method: 'GET', headers }
  );
  const rows = cache.body?.evaluationRows || [];
  const pairs = [];
  const seen = new Set();
  for (const row of rows) {
    const url = String(row?.page_url || row?.url || '').trim();
    const kw = String(row?.target_keyword || row?.keyword || '').trim();
    if (!url || !kw) continue;
    const key = `${url}||${kw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ url, keyword: kw });
  }
  if (!pairs.length) {
    return { ok: true, status: 200, ms: 0, body: { ok: true, skipped: 'no_eval_pairs' }, error: null };
  }
  return hit(base, '/api/aigeo/keyword-target-metrics', {
    method: 'POST',
    headers,
    body: { action: 'refresh', pairs: pairs.slice(0, 400), force: false, propertyDomain: DFS_DOMAIN }
  });
}

async function runGscUrlInspection(base, propertyUrl, headers) {
  const cache = await hit(
    base,
    `/api/aigeo/traditional-seo-evaluation-cache?propertyUrl=${encodeURIComponent(propertyUrl)}`,
    { method: 'GET', headers }
  );
  const rows = cache.body?.evaluationRows || [];
  const urls = [];
  const seen = new Set();
  for (const row of rows) {
    const u = String(row?.page_url || row?.url || '').trim();
    if (!u || seen.has(u) || !/^https?:\/\//i.test(u)) continue;
    seen.add(u);
    urls.push(u);
  }
  if (!urls.length) {
    return { ok: true, status: 200, ms: 0, body: { ok: true, skipped: 'no_urls' }, error: null };
  }
  // Dashboard batches; one tick inspects up to API max (typically 50–100).
  const chunk = urls.slice(0, 50);
  return hit(base, '/api/aigeo/gsc-url-inspection', {
    method: 'POST',
    headers,
    body: { propertyUrl, urls: chunk }
  });
}

async function runDomainStrengthTick(base, headers, progress) {
  const ds = progress.domain_strength || { batchCount: 0, remaining: 1 };
  const maxBatches = 20;
  if (ds.batchCount >= maxBatches) {
    return {
      ok: true,
      done: true,
      status: 200,
      ms: 0,
      body: { ok: true, capped: true, batchCount: ds.batchCount },
      error: null,
      domain_strength: ds
    };
  }
  const t0 = Date.now();
  const snap = await hit(base, '/api/domain-strength/snapshot', {
    method: 'POST',
    headers,
    body: { mode: 'run', domains: [], includePending: true, forceCompetitors: true }
  });
  ds.batchCount += 1;
  let remaining = 0;
  try {
    const pending = await hit(base, '/api/domain-strength/pending-count', { method: 'GET', headers });
    remaining = Number(pending.body?.count || 0);
  } catch {
    remaining = 0;
  }
  ds.remaining = remaining;
  const done = remaining <= 0 || ds.batchCount >= maxBatches;
  return {
    ok: snap.ok,
    done,
    status: snap.status,
    ms: Date.now() - t0,
    body: snap.body,
    error: snap.error,
    domain_strength: ds
  };
}

async function runAcquisitionChannels(base, headers) {
  const t0 = Date.now();
  const results = await Promise.all([
    hit(base, '/api/cron/llm-mentions-sync', { method: 'POST', headers }),
    hit(base, '/api/cron/youtube-stats-sync', { method: 'POST', headers }),
    hit(base, '/api/cron/ga4-channels-sync', { method: 'POST', headers })
  ]);
  const failed = results.find((r) => !r.ok);
  return {
    ok: !failed,
    status: failed ? failed.status : 200,
    ms: Date.now() - t0,
    body: { results: results.map((r) => ({ ok: r.ok, error: r.error })) },
    error: failed?.error || null
  };
}

/**
 * Execute one Full step (or one ranking/domain_strength tick).
 * @returns {{ ok, done?, status, ms, body, error, ranking?, domain_strength? }}
 */
export async function runFullStep(step, ctx) {
  const { base, headers, propertyUrl, progress } = ctx;

  if (step.kind === 'ui_noop') {
    return { ok: true, done: true, status: 200, ms: 0, body: { ok: true, mode: 'ui_noop', note: step.note }, error: null };
  }

  if (step.kind === 'revenue_pair') {
    const t0 = Date.now();
    const ss = await hit(base, step.bodies[0].path, { method: 'POST', headers, body: step.bodies[0].body });
    const st = await hit(base, step.bodies[1].path, { method: 'POST', headers, body: step.bodies[1].body });
    return {
      ok: ss.ok && st.ok,
      done: true,
      status: ss.ok && st.ok ? 200 : 500,
      ms: Date.now() - t0,
      body: { squarespace: ss.body, stripe: st.body },
      error: !ss.ok || !st.ok ? (ss.error || st.error) : null
    };
  }

  if (step.kind === 'ranking_parity') {
    const tick = await runDashboardParityRankingTick({
      baseUrl: base,
      propertyUrl,
      state: progress.ranking || null,
      headers
    });
    return {
      ok: tick.ok,
      done: tick.done,
      status: tick.ok ? 200 : 500,
      ms: null,
      body: tick.detail || null,
      error: tick.error || null,
      ranking: tick.state
    };
  }

  if (step.kind === 'ke_topup') {
    const r = await runKeTopup(base, propertyUrl, headers);
    return { ...r, done: true };
  }

  if (step.kind === 'gsc_url_inspection') {
    const r = await runGscUrlInspection(base, propertyUrl, headers);
    return { ...r, done: true };
  }

  if (step.kind === 'domain_strength') {
    return runDomainStrengthTick(base, headers, progress);
  }

  if (step.kind === 'acquisition_channels') {
    const r = await runAcquisitionChannels(base, headers);
    return { ...r, done: true };
  }

  if (step.method && step.path) {
    const r = await hit(base, step.path, { method: step.method, headers, body: step.body });
    return { ...r, done: true };
  }

  return { ok: false, done: true, status: 500, ms: 0, body: null, error: 'unknown_step_kind' };
}

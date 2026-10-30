/**
 * Multi-tick runner. Each tick renders pages until its time budget is spent,
 * checkpoints the cursor, and returns. The last tick runs the site-wide checks.
 * Same code path for the Monday cron, the dashboard Full refresh and re-checks.
 */
import { fetchCanonicalSiteUrlList } from '../../api/aigeo/canonical-site-urls.js';
import { THRESHOLDS } from './monitor-config.js';
import { navigationOutcome, urlKey } from './prefetch.js';
import { buildFullPlan, isAcademyUrl, pageTypeOf, policyFor } from './plan.js';
import { runPageChecks, statusFault } from './page-checks.js';
import { launchRenderer, renderAndMeasure } from './renderer.js';
import { googleIndexChecks, runSiteChecks, SITE_CHECK_IDS } from './site-checks.js';
import { checkSupabaseSync } from './sync-check.js';
import {
  applyResults, createRun, faultKey, loadBaselines, loadRun, resolveAbsent, saveBaseline, saveRun
} from './store.js';
import { saveRenderPage } from '../trad-seo-render/pages-store.js';

const SITE_PHASE_MIN_MS = 60000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function loadPolicies(sb) {
  const { data, error } = await sb.from('page_indexability_policy').select('url_or_prefix, match_type, policy, redirect_target');
  if (error) throw new Error(`policy_read:${error.message}`);
  return data || [];
}

export async function startRun(sb, { source = 'manual', weekStart, urls, forceNotChecked } = {}) {
  const siteUrls = await fetchCanonicalSiteUrlList({ forceRefresh: true });
  if (!siteUrls.length) throw new Error('no_site_urls_06');
  const list = Array.isArray(urls) && urls.length ? urls : siteUrls;
  const { slot, items } = buildFullPlan(list);
  const forced = new Set(forceNotChecked || []);
  items.forEach((i) => { if (forced.has(i.u)) i.forceNotChecked = true; });
  return createRun(sb, {
    week_start: weekStart, source, rotation_slot: slot, plan: items, pages_planned: items.length
  });
}

function union(a, b) {
  return Array.from(new Set([...(a || []), ...(b || [])])).sort();
}

async function updateBaseline(sb, url, baseline, out) {
  if (!out.blocks) return;
  const c1 = out.results.find((r) => r.check === 'C1');
  if (!baseline || c1?.status === 'pass') await saveBaseline(sb, url, union(baseline, out.blocks));
}

async function persistPage(sb, item, runId, extra) {
  if (!runId) return;
  try {
    await saveRenderPage(sb, {
      runId,
      url: item.u,
      pageType: item.t,
      ...extra
    });
  } catch (e) {
    console.warn('[trad-seo-render] persist failed', e?.message || e);
  }
}

/** @returns {Promise<{ outcome: 'checked'|'retry'|'not_checked', reason?: string, siteErrors?: string[], results?: object[] }>} */
export async function checkOnePage(sb, renderer, item, policyRows, runId, extras = {}) {
  const policy = policyFor(item.u, policyRows);
  if (item.forceNotChecked) {
    const res = { outcome: 'not_checked', reason: '429 rate limited', siteErrors: [], results: [] };
    await persistPage(sb, item, runId, {
      outcome: 'not_checked', reason: res.reason, http: 429, render: {}, results: [],
      inCsv: extras.inCsv, intentionalNoindex: policy.intentionalNoindex
    });
    return res;
  }
  const render = await renderAndMeasure(renderer, item.u);
  if (render.status === 429) {
    if (item.retried) {
      const res = { outcome: 'not_checked', reason: '429 rate limited', siteErrors: [], results: [] };
      await persistPage(sb, item, runId, {
        outcome: 'not_checked', reason: res.reason, http: 429, render, results: [],
        inCsv: extras.inCsv, intentionalNoindex: policy.intentionalNoindex
      });
      return res;
    }
    return { outcome: 'retry', reason: '429 rate limited' };
  }
  if (!render.ok) {
    const res = { outcome: 'not_checked', reason: render.error, siteErrors: [], results: [] };
    await persistPage(sb, item, runId, {
      outcome: 'not_checked', reason: res.reason, http: render.status, render, results: [],
      inCsv: extras.inCsv, intentionalNoindex: policy.intentionalNoindex
    });
    return res;
  }
  const pre = navigationOutcome(item.u, render);
  const ctx = { runId, pageType: item.t };
  const b4 = statusFault(item.u, pre, policy);
  if (b4 || !render.measure) {
    const results = b4 ? [b4] : [];
    await applyResults(sb, results, ctx);
    const res = { outcome: b4 ? 'checked' : 'not_checked', reason: b4 ? null : `status ${render.status}`, siteErrors: [], results };
    await persistPage(sb, item, runId, {
      outcome: res.outcome, reason: res.reason, http: render.status, render, results,
      inCsv: extras.inCsv, intentionalNoindex: policy.intentionalNoindex
    });
    return res;
  }
  const baseline = (await loadBaselines(sb, [item.u])).get(urlKey(item.u)) || null;
  const out = runPageChecks({
    url: item.u, pageType: item.t, isAcademy: isAcademyUrl(item.u), prefetch: pre, render, policy, baseline
  });
  await applyResults(sb, out.results, ctx);
  await updateBaseline(sb, item.u, baseline, out);
  await persistPage(sb, item, runId, {
    outcome: 'checked', reason: null, http: render.status, render, results: out.results,
    siteErrors: out.siteErrors, inCsv: extras.inCsv, intentionalNoindex: policy.intentionalNoindex
  });
  return { outcome: 'checked', siteErrors: out.siteErrors, results: out.results };
}

function recordOutcome(state, item, res) {
  if (res.outcome === 'checked') {
    state.checked += 1;
    for (const msg of res.siteErrors || []) {
      state.siteErrors[msg] = Array.from(new Set([...(state.siteErrors[msg] || []), item.u]));
    }
    return;
  }
  if (res.outcome === 'retry' && !item.retried) {
    state.retry.push({ ...item, retried: true, at: Date.now() });
    return;
  }
  state.notChecked.push({ u: item.u, t: item.t, reason: res.reason || 'not checked' });
}

function nextItem(run, state) {
  if (state.cursor < run.plan.length) return { item: run.plan[state.cursor], fromRetry: false };
  const ready = state.retry.findIndex((r) => Date.now() - r.at >= THRESHOLDS.retry429AfterMs);
  if (ready >= 0) return { item: state.retry[ready], fromRetry: true, index: ready };
  return null;
}

async function renderPhase(sb, run, state, policyRows, deadline, extras) {
  let renderer = null;
  try {
    while (Date.now() < deadline) {
      const next = nextItem(run, state);
      if (!next) break;
      if (next.fromRetry) state.retry.splice(next.index, 1);
      else state.cursor += 1;
      renderer = renderer || await launchRenderer();
      const res = await checkOnePage(sb, renderer, next.item, policyRows, run.id, extras);
      recordOutcome(state, next.item, res);
      const pause = res.outcome === 'retry' ? THRESHOLDS.cooldown429Ms : THRESHOLDS.pageGapMs;
      await sleep(Math.min(pause, Math.max(0, deadline - Date.now())));
    }
  } finally {
    if (renderer) await renderer.close().catch(() => {});
  }
  return state;
}

function runState(run) {
  return {
    cursor: run.cursor || 0,
    retry: Array.isArray(run.retry) ? run.retry : [],
    notChecked: Array.isArray(run.not_checked) ? run.not_checked : [],
    siteErrors: run.site_errors && typeof run.site_errors === 'object' ? run.site_errors : {},
    checked: run.pages_checked || 0
  };
}

function statePatch(state) {
  return {
    cursor: state.cursor,
    retry: state.retry,
    not_checked: state.notChecked,
    site_errors: state.siteErrors,
    pages_checked: state.checked,
    pages_not_checked: state.notChecked.length
  };
}

async function sitePhase(sb, run, state) {
  const results = await runSiteChecks(sb, { ...run, site_errors: state.siteErrors });
  await applyResults(sb, results, { runId: run.id });
  const keep = results.filter((r) => r.status === 'fault').map((r) => r.key || faultKey(r.check, r.url));
  await resolveAbsent(sb, SITE_CHECK_IDS, keep);
}

export function tickSummary(run, extra = {}) {
  return {
    run_id: run.id,
    status: run.status,
    pages_planned: run.pages_planned,
    pages_checked: run.pages_checked,
    pages_not_checked: run.pages_not_checked,
    cursor: run.cursor,
    retry_pending: (run.retry || []).length,
    ...extra
  };
}

/** One tick. Returns { done, waiting, summary }. */
export async function tickRun(sb, runId, { budgetMs = THRESHOLDS.tickBudgetMs } = {}) {
  const run = await loadRun(sb, runId);
  if (!run) throw new Error('fault_run_not_found');
  if (run.status !== 'running') return { done: true, waiting: false, summary: tickSummary(run) };
  const deadline = Date.now() + budgetMs;
  let state = runState(run);
  const siteUrls = await fetchCanonicalSiteUrlList({ forceRefresh: false });
  const extras = { inCsv: new Set(siteUrls.map((u) => urlKey(u))) };
  state = await renderPhase(sb, run, state, await loadPolicies(sb), deadline, extras);
  const pagesLeft = state.cursor < run.plan.length || state.retry.length > 0;
  await saveRun(sb, run.id, statePatch(state));
  if (pagesLeft || deadline - Date.now() < SITE_PHASE_MIN_MS) {
    const merged = { ...run, ...statePatch(state) };
    return { done: false, waiting: pagesLeft && state.cursor >= run.plan.length, summary: tickSummary(merged) };
  }
  await sitePhase(sb, run, state);
  const finished = { ...statePatch(state), site_checks_done: true, status: 'done', finished_at: new Date().toISOString() };
  await saveRun(sb, run.id, finished);
  return { done: true, waiting: false, summary: tickSummary({ ...run, ...finished }) };
}

/** "Re-check this page now": same page checks + this URL's D5/B3, closes faults that now pass. */
export async function recheckUrl(sb, url, runId = null) {
  const item = { u: url, t: pageTypeOf(url) };
  const renderer = await launchRenderer();
  const siteUrls = await fetchCanonicalSiteUrlList({ forceRefresh: false });
  const extras = { inCsv: new Set(siteUrls.map((u) => urlKey(u))) };
  let res;
  try {
    res = await checkOnePage(sb, renderer, item, await loadPolicies(sb), runId, extras);
  } finally {
    await renderer.close().catch(() => {});
  }
  const d5 = await checkSupabaseSync(sb, { onlyUrl: url });
  const b3 = (item.t === 'money' || item.t === 'landing') ? await googleIndexChecks(sb, [item]) : [];
  const b3Pass = b3.length ? [] : [{ check: 'B3', key: faultKey('B3', url), status: 'pass' }];
  await applyResults(sb, [...d5, ...b3, ...b3Pass], { pageType: item.t });
  return { outcome: res.outcome, reason: res.reason || null, page_type: item.t };
}

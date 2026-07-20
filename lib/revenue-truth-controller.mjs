/**
 * Revenue Truth tab controller — browser entry (replaces inline IIFE).
 */
import { BAND_COLOURS, BAND_LABEL, basisBadge, DEFAULT_TIER_BANDS } from './revenue-truth-ui-core.mjs';
import { readIncludeJlr, persistIncludeJlr, syncJlrCheckboxes } from './dashboard-jlr-preference.mjs';
import { renderExecSummaryHtml } from './revenue-truth-exec-summary.mjs';
import { renderCurrentMonthPulseHtml } from './revenue-truth-current-month-pulse-ui.mjs';
import { renderSection9Html } from './revenue-truth-section9-ui.mjs';
import { bindRtTableSorting } from './revenue-truth-table-sort.mjs';
import {
  renderHeadlineForecastPanelHtml, headlineForecastSignals, renderMarketTable, renderCategoryTable,
  renderProductBreakdownTable, renderPageBreakdownTable, renderReconciliationPivotTable,
  renderFundingTable, renderMoversIntoGrid, visibleMonthKeys, renderFlagKeyHtml, renderTierChartSvg
} from './revenue-truth-tables-ui.mjs';
import { renderOpportunityStackHtml, bindOpportunityStack, setOpportunityLiveFacts } from './revenue-truth-opportunity-stack.mjs';
import { channelSignals, clientsSignals } from './revenue-truth-key-signals.mjs';

const PROPERTY_URL = 'https://www.alanranger.com';
const RT_TIER_OPTIONS = [
  ['courses_masterclasses', 'Courses / Masterclasses'],
  ['workshops_non_residential', 'Workshops Non Residential'],
  ['workshops_residential', 'Workshops Residential (volatile)'],
  ['pick_n_mix_inc', 'Pick n Mix Inc'],
  ['one_to_one_lessons', '1-2-1 Lessons'],
  ['gift_vouchers_inc', 'Gift Vouchers Inc'],
  ['prints_royalties', 'Prints & Royalties'],
  ['commissions', 'Commissions'],
  ['academy', 'Academy'],
  ['mentoring', 'Mentoring']
];

let rtData = null;
let rtChart = null;
let rtShowGp = false;
let rtWindowMode = 'rolling13';
let rtCategorySort = 'market';
let rtFindings = null;
let rtIncludeJlr = readIncludeJlr();
let rtFindingsWindow = '2025->2026';
let rtProdTierFilter = '';
let rtPageTierFilter = '';
let rtProdSearch = '';
let rtPageSearch = '';
let rtDiagnosis = null;
let rtDiagWindowMonths = 12;
let rtDiagIncludeEvent = false;
let rtDiagShowNewPages = false;
const rtDiagBreakdownCache = new Map();
const rtDiagExpandedTiers = new Set();

function monthKeys() {
  return visibleMonthKeys(rtData?.monthly, rtWindowMode, rtData?.config?.now);
}

function jlrQuery() {
  return rtIncludeJlr ? 'true' : 'false';
}

function jlrBadgeHtml() {
  if (rtIncludeJlr) return basisBadge('jlr_incl');
  const j = rtData?.jlrSummary;
  const by = j?.by_year || {};
  const y = j?.year || rtData?.config?.now?.year || new Date().getUTCFullYear();
  const tip = j
    ? `JLR stripped: ${fmtJlr(j.ytd_total)} YTD across ${j.ytd_count} woodland walk booking(s) (Source = JLR). Historical: ${y - 1} ${fmtJlr(by[y - 1]?.total)} / ${y - 2} ${fmtJlr(by[y - 2]?.total)}.`
    : 'Non-JLR net — JLR woodland walk bookings stripped at source.';
  return `<span class="rt-basis-badge rt-jlr-badge" data-basis="nonjlr_net" title="${escapeAttr(tip)}">Non-JLR / Net</span>`;
}

function fmtJlr(n) {
  return '£' + (Number(n) || 0).toLocaleString('en-GB', { maximumFractionDigits: 0 });
}

function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function basisNoteHtml() {
  return jlrBadgeHtml();
}

async function loadRevenueTruth() {
  const url = '/api/aigeo/revenue-truth-summary?propertyUrl=' + encodeURIComponent(PROPERTY_URL)
    + '&includeJlr=' + jlrQuery();
  const cacheKey = 'rt_summary_cache_v1';
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        cache: 'no-store',
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout
          ? AbortSignal.timeout(45000)
          : undefined
      });
      if (!res.ok) throw new Error('summary failed');
      const json = await res.json();
      try {
        sessionStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), data: json }));
      } catch (_e) { /* quota */ }
      return json;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  try {
    const raw = sessionStorage.getItem(cacheKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.data) {
        return { ...parsed.data, _staleCache: true, _cachedAt: parsed.t || null };
      }
    }
  } catch (_e) { /* ignore */ }
  throw lastErr || new Error('summary failed');
}

async function loadFindings() {
  const res = await fetch('/api/aigeo/revenue-truth-findings?propertyUrl=' + encodeURIComponent(PROPERTY_URL), { cache: 'no-store' });
  if (!res.ok) throw new Error('findings failed');
  return res.json();
}

async function loadDiagnosis() {
  const url = '/api/aigeo/revenue-funnel-diagnosis?propertyUrl=' + encodeURIComponent(PROPERTY_URL)
    + '&windowMonths=' + rtDiagWindowMonths
    + '&includeJlr=' + jlrQuery()
    + '&includeEvent=' + (rtDiagIncludeEvent ? 'true' : 'false')
    + '&includeAllPages=' + (rtDiagShowNewPages ? 'true' : 'false');
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('diagnosis failed');
  return res.json();
}

async function loadProductBreakdown(slug) {
  const key = slug + '|' + (rtIncludeJlr ? '1' : '0') + '|' + rtDiagWindowMonths;
  if (rtDiagBreakdownCache.has(key)) return rtDiagBreakdownCache.get(key);
  const url = '/api/aigeo/revenue-funnel-product-breakdown?page=' + encodeURIComponent(slug)
    + '&includeJlr=' + jlrQuery() + '&windowMonths=' + rtDiagWindowMonths;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('breakdown failed');
  const data = await res.json();
  rtDiagBreakdownCache.set(key, data);
  return data;
}

function rtProgressEls() {
  return {
    host: document.getElementById('rt-upload-progress'),
    step: document.getElementById('rt-upload-progress-step'),
    pct: document.getElementById('rt-upload-progress-pct'),
    fill: document.getElementById('rt-upload-progress-fill'),
    log: document.getElementById('rt-upload-progress-log')
  };
}

function rtProgressShow(step) {
  const els = rtProgressEls();
  if (!els.host) return;
  els.host.style.display = 'block';
  els.host.classList.remove('is-error', 'is-success');
  if (els.step) els.step.textContent = step || 'Starting…';
  if (els.pct) els.pct.textContent = '0%';
  if (els.fill) { els.fill.style.width = '0%'; els.fill.classList.add('is-indeterminate'); }
  if (els.log) els.log.innerHTML = '';
}

function rtProgressUpdate(pct, step) {
  const els = rtProgressEls();
  if (!els.host) return;
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  if (els.fill) { els.fill.classList.remove('is-indeterminate'); els.fill.style.width = clamped + '%'; }
  if (els.pct) els.pct.textContent = clamped + '%';
  if (step && els.step) els.step.textContent = step;
}

function rtProgressLog(message, kind) {
  const els = rtProgressEls();
  if (!els.log) return;
  const ts = new Date().toLocaleTimeString('en-GB', { hour12: false });
  const cls = kind === 'ok' ? 'rt-upload-log-ok' : (kind === 'err' ? 'rt-upload-log-err' : '');
  const line = document.createElement('div');
  line.className = cls;
  line.textContent = `[${ts}] ${message}`;
  els.log.appendChild(line);
  els.log.scrollTop = els.log.scrollHeight;
}

function rtProgressFinish(kind, summary) {
  const els = rtProgressEls();
  if (!els.host) return;
  if (els.fill) { els.fill.classList.remove('is-indeterminate'); els.fill.style.width = '100%'; }
  if (els.pct) els.pct.textContent = '100%';
  els.host.classList.add(kind === 'error' ? 'is-error' : 'is-success');
  if (summary && els.step) els.step.textContent = summary;
}

function rtFileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

function rtPickBookingFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsm,.xlsx';
    input.onchange = () => resolve(input.files?.[0] || null);
    input.click();
  });
}

async function rtRunBookingSheetUpload(file) {
  rtProgressLog(`Reading "${file.name}" (${Math.round(file.size / 1024)} KB)…`);
  const contentBase64 = await rtFileToBase64(file);
  rtProgressUpdate(25, 'Uploading and parsing workbook…');
  const res = await fetch('/api/aigeo/booking-sheet-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: file.name, contentBase64, propertyUrl: PROPERTY_URL })
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data?.error || ('HTTP ' + res.status));
  rtProgressUpdate(70, 'Refreshing Revenue Truth tables…');
  rtProgressLog(`Wrote ${data.category_rows_written} category + ${data.gp_rows_written || 0} GP + ${data.transaction_rows_written || 0} transaction rows.`, 'ok');
  return data;
}

async function rtUploadBookingSheetOnly() {
  const btn = document.getElementById('rt-upload-booking-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Picking file…'; }
  try {
    const file = await rtPickBookingFile();
    if (!file) return;
    rtProgressShow(`Booking Sheet upload — ${file.name}`);
    await rtRunBookingSheetUpload(file);
    rtDiagBreakdownCache.clear();
    rtDiagnosis = null;
    rtData = await loadRevenueTruth();
    rtFindings = await loadFindings();
    renderAllSections();
    await loadAndRenderDiagnosis();
    rtProgressFinish('success', 'Booking Sheet imported — all Revenue Truth tables refreshed.');
    if (typeof window.updateRevenueSyncBanner === 'function') {
      try { await window.updateRevenueSyncBanner(PROPERTY_URL); } catch (_) { /* swallow */ }
    }
  } catch (err) {
    rtProgressLog(err?.message || String(err), 'err');
    rtProgressFinish('error', 'Upload failed — see log above.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📋 Upload Booking Sheet'; }
  }
}

function updateGlobalBasisBadge() {
  const el = document.getElementById('rt-global-basis-badge');
  if (el) el.innerHTML = jlrBadgeHtml();
}

function renderTierChart() {
  const wrap = document.querySelector('#rt-tier-chart-section .rt-tier-chart-wrap');
  const host = document.getElementById('rt-tier-chart-host') || wrap;
  if (!host || !rtData) return;
  const keys = monthKeys();
  const monthly = rtData.monthly.filter((m) => keys.has(`${m.year}|${m.month}`));
  const chartWidth = wrap?.clientWidth || host.clientWidth || 960;
  host.innerHTML = renderTierChartSvg(monthly, rtData.config, rtIncludeJlr, chartWidth);
  const leg = document.getElementById('rt-tier-legend');
  if (leg) {
    leg.innerHTML = ['thrive', 'comfortable', 'survival', 'below_survival'].map((b) =>
      `<span><span class="swatch" style="background:${BAND_COLOURS[b]}"></span>${BAND_LABEL[b]}</span>`).join('')
      + `<span><span class="swatch" style="background:${BAND_COLOURS.partial}"></span>Month in progress</span>`
      + basisNoteHtml()
      + `<span class="rt-basis-badge" data-basis="recurring_baseline" title="Recurring baseline = operational run-rate (headline minus voucher tiers + redemptions). Residential workshops and seasonal events are included. Can exceed headline in heavy voucher-redemption months.">Recurring baseline (hatched)</span>`;
  }
  const sub = document.getElementById('rt-section-1-sub');
  if (sub) {
    const tb = rtData?.config?.tierBands || DEFAULT_TIER_BANDS;
    const kLabel = (v) => `£${Math.round((Number(v) || 0) / 1000)}k`;
    const refBands = `${kLabel(tb.survival)} / ${kLabel(tb.comfortable)} / ${kLabel(tb.thrive)}`;
    sub.textContent = rtIncludeJlr
      ? `Inline bars with £ labels: headline gross (solid) vs recurring baseline (hatched). Reference lines at ${refBands} survival bands.`
      : 'Inline bars with £ labels: headline with JLR stripped (solid) vs recurring baseline (hatched). Toggle at top to include JLR.';
  }
}

function renderCurrentMonthPulse() {
  const el = document.getElementById('rt-current-month-pulse-body');
  if (!el) return;
  const badge = document.getElementById('rt-pulse-basis-badge');
  if (badge) {
    badge.textContent = (rtData?.currentMonthPulse?.include_jlr ? 'JLR incl. / Net' : 'Non-JLR / Net') + ' · PARTIAL';
  }
  el.innerHTML = renderCurrentMonthPulseHtml(rtData, rtDiagnosis);
}

function renderExecSummary() {
  const el = document.getElementById('rt-exec-body');
  if (!el) return;
  el.innerHTML = renderExecSummaryHtml({ summary: rtData, findings: rtFindings, diagnosis: rtDiagnosis, windowMonths: rtDiagWindowMonths });
}

function renderOpportunityStack() {
  const body = document.getElementById('rt-opportunity-stack-body');
  if (!body) return;
  setOpportunityLiveFacts(rtDiagnosis, rtIncludeJlr);
  body.innerHTML = renderOpportunityStackHtml();
}

function populateTierSelects() {
  for (const id of ['rt-product-tier-filter', 'rt-page-tier-filter']) {
    const sel = document.getElementById(id);
    if (!sel || sel.dataset.populated === '1') continue;
    sel.innerHTML = ['<option value="">All tiers</option>']
      .concat(RT_TIER_OPTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`)).join('');
    sel.dataset.populated = '1';
  }
}

function renderFindingsSection() {
  if (!rtFindings) return;
  renderCurrentMonthPulse();
  renderExecSummary();
  updateGlobalBasisBadge();
  const blocks = renderMoversIntoGrid(rtFindings, rtFindingsWindow, rtIncludeJlr);
  const el = (id) => document.getElementById(id);
  if (el('rt-findings-products-decline')) el('rt-findings-products-decline').innerHTML = blocks.productsDecline;
  if (el('rt-findings-pages-decline')) el('rt-findings-pages-decline').innerHTML = blocks.pagesDecline;
  if (el('rt-findings-products-growth')) el('rt-findings-products-growth').innerHTML = blocks.productsGrowth;
  const flagsEl = el('rt-findings-flags');
  if (flagsEl) {
    const f = rtFindings.flags || {};
    flagsEl.innerHTML = Object.entries(f).filter(([, rows]) => rows?.length).map(([k, rows]) => `${k}: ${rows.length}`).join(' · ') || 'None flagged.';
  }
  const prodWrap = document.querySelector('#rt-product-breakdown .rt-table-scroll');
  if (prodWrap) prodWrap.innerHTML = renderProductBreakdownTable(rtFindings, { tierFilter: rtProdTierFilter, search: rtProdSearch, includeJlr: rtIncludeJlr });
  const prodKey = document.getElementById('rt-product-flag-key');
  if (prodKey) prodKey.innerHTML = renderFlagKeyHtml();
  const pageWrap = document.querySelector('#rt-page-breakdown .rt-table-scroll');
  if (pageWrap) pageWrap.innerHTML = renderPageBreakdownTable(rtFindings, { tierFilter: rtPageTierFilter, search: rtPageSearch, includeJlr: rtIncludeJlr });
  const pageKey = document.getElementById('rt-page-flag-key');
  if (pageKey) pageKey.innerHTML = renderFlagKeyHtml();
  populateTierSelects();
  bindRtTableSorting(document.querySelector('section[data-panel="revenue-truth"]'));
}

function applyHeadlineForecastPanel() {
  const sig = document.getElementById('rt-headline-forecast-signals');
  const body = document.getElementById('rt-headline-forecast-body');
  if (!rtData) return;
  if (sig) { sig.style.display = 'block'; sig.innerHTML = headlineForecastSignals(rtData.headlineStrip, rtData.config, rtData.forecast, rtData.currentMonthPulse); }
  if (body) body.innerHTML = renderHeadlineForecastPanelHtml(rtData.headlineStrip, rtData.config, rtData.forecast, rtData.currentMonthPulse, rtData.recurringForecast, rtFindings);
}

function renderAllSections() {
  updateGlobalBasisBadge();
  const keys = monthKeys();
  applyHeadlineForecastPanel();
  renderOpportunityStack();
  renderTierChart();
  const mktWrap = document.querySelector('#rt-market .rt-table-scroll');
  if (mktWrap && rtData) mktWrap.innerHTML = renderMarketTable(rtData.monthly, keys);
  const catWrap = document.querySelector('#rt-category .rt-table-scroll');
  if (catWrap && rtData) catWrap.innerHTML = renderCategoryTable(rtData.categoryBreakdown, keys, rtCategorySort);
  const chWrap = document.querySelector('#rt-channel-section .rt-table-scroll');
  if (chWrap && rtData) {
    chWrap.innerHTML = renderReconciliationPivotTable(rtData.channelMix, 'Channel', (r) => r.label, keys);
    const cs = document.getElementById('rt-channel-signals');
    if (cs) { cs.style.display = 'block'; cs.innerHTML = channelSignals(rtData.channelMix); }
  }
  const clWrap = document.querySelector('#rt-clients-section .rt-table-scroll');
  if (clWrap && rtData) {
    clWrap.innerHTML = renderReconciliationPivotTable(rtData.newVsExisting, 'Client type', (r) => r.label, keys);
    const cs = document.getElementById('rt-clients-signals');
    if (cs) { cs.style.display = 'block'; cs.innerHTML = clientsSignals(rtData.newVsExisting); }
  }
  const fuWrap = document.querySelector('#rt-funding-section .rt-table-scroll');
  if (fuWrap && rtData) fuWrap.innerHTML = renderFundingTable(rtData.fundingFees, keys);
  renderFindingsSection();
  renderCurrentMonthPulse();
  bindRtTableSorting(document.querySelector('section[data-panel="revenue-truth"]'));
}

async function applyGlobalJlrToggle() {
  rtDiagBreakdownCache.clear();
  rtDiagnosis = null;
  rtData = await loadRevenueTruth();
  renderAllSections();
  await loadAndRenderDiagnosis();
}

async function renderDiagnosis() {
  const listEl = document.getElementById('rt-diag-tier-list');
  const statusEl = document.getElementById('rt-diag-status');
  if (!listEl || !rtDiagnosis) return;
  const hubProducts = new Map();
  for (const tierKey of rtDiagExpandedTiers) {
    const pages = (rtDiagnosis.diagnostics || []).filter((d) => d.tier_key === tierKey);
    for (const p of pages) {
      try { hubProducts.set(p.page_slug, await loadProductBreakdown(p.page_slug)); } catch (_) { /* skip */ }
    }
  }
  const s9 = renderSection9Html(rtDiagnosis, {
    expandTiers: rtDiagExpandedTiers,
    windowMonths: rtDiagWindowMonths,
    hubProducts,
    includeJlr: rtIncludeJlr
  });
  if (statusEl) statusEl.innerHTML = s9.statusLine;
  const diagnostics = rtDiagnosis.diagnostics || [];
  const suppressedCount = diagnostics.filter((d) => d.policy_suppression_reason != null).length;
  const diagTotal = diagnostics.length;
  const diagActive = suppressedCount > 0;
  if (typeof window.activatePolicyBanner === 'function') {
    window.activatePolicyBanner({
      placement: 'diagnosis',
      isActive: diagActive,
      titleText: diagActive
        ? `${suppressedCount} of ${diagTotal} diagnosis rows have visibility_loss suppressed by active policy`
        : '',
      detailText: 'Pages on or after their policy effective date are not flagged as visibility loss. This is expected behaviour for pages intentionally noindexed or retired.'
    });
  }
  listEl.innerHTML = '<div class="rt-diag-tier-list-header"><div>Tier</div><div>Revenue / Hub / Product</div><div></div><div>Page states</div></div>' + s9.tierRowsHtml;
  bindRtTableSorting(document.querySelector('section[data-panel="revenue-truth"]'));
}

async function loadAndRenderDiagnosis(preloaded) {
  const listEl = document.getElementById('rt-diag-tier-list');
  if (listEl) listEl.innerHTML = '<div class="rt-loading">Loading diagnosis…</div>';
  try {
    // `preloaded` lets callers kick off the (slow) diagnosis fetch in parallel
    // with summary/findings so total wall time is max(fetches), not the sum.
    rtDiagnosis = await (preloaded || loadDiagnosis());
    await renderDiagnosis();
    renderCurrentMonthPulse();
    renderExecSummary();
    renderOpportunityStack();
  } catch (err) {
    if (listEl) listEl.innerHTML = '<div class="rt-error">' + err.message + '</div>';
  }
}

async function scrollToDiagTier(tierKey) {
  if (tierKey) rtDiagExpandedTiers.add(tierKey);
  await renderDiagnosis();
  const row = tierKey ? document.getElementById(`rt-diag-tier-${tierKey}`) : null;
  (row || document.getElementById('rt-diag-section'))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export async function initRevenueTruthTab() {
  persistIncludeJlr(rtIncludeJlr);
  syncJlrCheckboxes(rtIncludeJlr);
  try {
    // Fire all three (independent) loads in parallel. Diagnosis is the slow one
    // (~12–26s server-side); starting it up front means summary + findings can
    // paint as soon as they resolve instead of waiting behind diagnosis.
    const diagPromise = loadDiagnosis();
    diagPromise.catch(() => { /* handled in loadAndRenderDiagnosis */ });
    const findPromise = loadFindings().catch(() => rtFindings || null);
    rtData = await loadRevenueTruth();
    rtFindings = await findPromise;
    bindOpportunityStack(document.getElementById('rt-opportunity-stack'), scrollToDiagTier);
    renderAllSections();
    if (rtData?._staleCache) {
      const el = document.getElementById('rt-error-banner');
      if (el) {
        el.innerHTML = '<div class="rt-warn" style="background:#fff3cd;border-left:4px solid #f59e0b;padding:0.75rem 1rem;margin-bottom:1rem;color:#92400e;">Database temporarily unavailable — showing last cached Revenue Truth snapshot.</div>';
      }
    }
    await loadAndRenderDiagnosis(diagPromise);
    window.renderRevenueTruthTab = async () => {
      const diagP = loadDiagnosis();
      diagP.catch(() => { /* handled in loadAndRenderDiagnosis */ });
      const findP = loadFindings().catch(() => rtFindings || null);
      rtData = await loadRevenueTruth();
      rtFindings = await findP;
      renderAllSections();
      await loadAndRenderDiagnosis(diagP);
    };
    window.rtUploadBookingSheetOnly = rtUploadBookingSheetOnly;
  } catch (err) {
    const el = document.getElementById('rt-error-banner');
    if (el) el.innerHTML = '<div class="rt-error">' + err.message + '</div>';
  }

  document.getElementById('rt-upload-booking-btn')?.addEventListener('click', () => rtUploadBookingSheetOnly());

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (!t) return;
    if (t.id === 'rt-show-gp') { rtShowGp = t.checked; renderAllSections(); return; }
    if (t.name === 'rt-window' && t.checked) { rtWindowMode = t.value; renderAllSections(); return; }
    if (t.name === 'rt-cat-sort' && t.checked) { rtCategorySort = t.value; renderAllSections(); return; }
    if (t.id === 'rt-include-jlr') {
      rtIncludeJlr = t.checked;
      persistIncludeJlr(rtIncludeJlr);
      if (typeof window.rfFetchSummary === 'function') window.rfFetchSummary();
      applyGlobalJlrToggle().catch((err) => {
        const el = document.getElementById('rt-error-banner');
        if (el) el.innerHTML = '<div class="rt-error">' + err.message + '</div>';
      });
      return;
    }
    if (t.name === 'rt-findings-window' && t.checked) { rtFindingsWindow = t.value; renderFindingsSection(); return; }
    if (t.id === 'rt-diag-include-event') { rtDiagIncludeEvent = t.checked; rtDiagnosis = null; loadAndRenderDiagnosis(); return; }
    if (t.id === 'rt-diag-show-new') { rtDiagShowNewPages = t.checked; rtDiagnosis = null; rtDiagBreakdownCache.clear(); loadAndRenderDiagnosis(); return; }
    if (t.name === 'rt-diag-window' && t.checked) { rtDiagWindowMonths = Number(t.value) || 12; rtDiagnosis = null; rtDiagBreakdownCache.clear(); loadAndRenderDiagnosis(); return; }
    if (t.id === 'rt-product-tier-filter') { rtProdTierFilter = t.value; renderFindingsSection(); return; }
    if (t.id === 'rt-page-tier-filter') { rtPageTierFilter = t.value; renderFindingsSection(); return; }
    if (t.id === 'rt-exec-collapse') {
      const box = document.getElementById('rt-exec-summary');
      if (box) box.style.display = box.style.display === 'none' ? '' : 'none';
    }
  });

  document.addEventListener('input', (e) => {
    if (e.target?.id === 'rt-product-search') { rtProdSearch = e.target.value; renderFindingsSection(); }
    if (e.target?.id === 'rt-page-search') { rtPageSearch = e.target.value; renderFindingsSection(); }
  });

  document.addEventListener('click', (e) => {
    const tierHead = e.target?.closest?.('.rt-diag-tier-head');
    if (tierHead) {
      e.preventDefault();
      const tierKey = tierHead.getAttribute('data-tier-head');
      if (!tierKey) return;
      if (rtDiagExpandedTiers.has(tierKey)) rtDiagExpandedTiers.delete(tierKey);
      else rtDiagExpandedTiers.add(tierKey);
      renderDiagnosis();
      return;
    }
    const scrollLink = e.target?.closest?.('a[data-rt-scroll]');
    if (scrollLink) {
      e.preventDefault();
      document.getElementById(scrollLink.getAttribute('data-rt-scroll'))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const tierScroll = e.target?.closest?.('a[data-rt-tier-scroll]');
    if (tierScroll) {
      e.preventDefault();
      scrollToDiagTier(tierScroll.getAttribute('data-rt-tier-scroll'));
    }
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => initRevenueTruthTab());
else initRevenueTruthTab();

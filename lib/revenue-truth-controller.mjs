/**
 * Revenue Truth tab controller — browser entry (replaces inline IIFE).
 */
import { BAND_COLOURS, BAND_LABEL, basisBadge } from './revenue-truth-ui-core.mjs';
import { renderExecSummaryHtml } from './revenue-truth-exec-summary.mjs';
import { renderCurrentMonthPulseHtml } from './revenue-truth-current-month-pulse-ui.mjs';
import { renderSection9Html } from './revenue-truth-section9-ui.mjs';
import { bindRtTableSorting } from './revenue-truth-table-sort.mjs';
import {
  renderHeadlineForecastPanelHtml, headlineForecastSignals, renderMarketTable, renderCategoryTable,
  renderProductBreakdownTable, renderPageBreakdownTable, renderReconciliationPivotTable,
  renderFundingTable, renderMoversIntoGrid, visibleMonthKeys, renderFlagKeyHtml
} from './revenue-truth-tables-ui.mjs';
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
let rtIncludeJlr = false;
let rtFindingsWindow = '2024->2025';
let rtProdTierFilter = '';
let rtPageTierFilter = '';
let rtProdSearch = '';
let rtPageSearch = '';
let rtDiagnosis = null;
let rtDiagWindowMonths = 12;
let rtDiagIncludeEvent = false;
const rtDiagBreakdownCache = new Map();
const rtDiagExpandedTiers = new Set();

function monthKeys() {
  return visibleMonthKeys(rtData?.monthly, rtWindowMode, rtData?.config?.now);
}

function jlrQuery() {
  return rtIncludeJlr ? 'true' : 'false';
}

function basisNoteHtml() {
  return rtIncludeJlr ? basisBadge('jlr_incl') : basisBadge('nonjlr_net');
}

async function loadRevenueTruth() {
  const url = '/api/aigeo/revenue-truth-summary?propertyUrl=' + encodeURIComponent(PROPERTY_URL)
    + '&includeJlr=' + jlrQuery();
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('summary failed');
  return res.json();
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
    + '&includeEvent=' + (rtDiagIncludeEvent ? 'true' : 'false');
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
  } catch (err) {
    rtProgressLog(err?.message || String(err), 'err');
    rtProgressFinish('error', 'Upload failed — see log above.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📋 Upload Booking Sheet'; }
  }
}

function updateGlobalBasisBadge() {
  const el = document.getElementById('rt-global-basis-badge');
  if (el) el.innerHTML = basisNoteHtml();
}

function renderTierChart() {
  const canvas = document.getElementById('rt-tier-chart');
  if (!canvas || !rtData || typeof Chart === 'undefined') return;
  const keys = monthKeys();
  const monthly = rtData.monthly.filter((m) => keys.has(`${m.year}|${m.month}`));
  const labels = monthly.map((m) => new Date(Date.UTC(m.year, m.month - 1, 1)).toLocaleString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }));
  const headlineLabel = rtIncludeJlr ? 'Headline (12-category gross, JLR incl.)' : 'Headline (JLR excluded)';
  if (rtChart) { rtChart.destroy(); rtChart = null; }
  rtChart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: headlineLabel,
        data: monthly.map((m) => m.headlineRevenue),
        backgroundColor: monthly.map((m) => m.isPartial ? BAND_COLOURS.partial : (BAND_COLOURS[m.band] || '#64748b')),
        borderWidth: 0
      }, {
        label: 'Recurring baseline',
        data: monthly.map((m) => m.recurringBaseline ?? 0),
        backgroundColor: monthly.map((m) => m.isPartial ? 'rgba(100,116,139,0.35)' : (BAND_COLOURS[m.recurringBand] || '#475569')),
        borderWidth: 0
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { x: { ticks: { color: '#cbd5e1' } }, y: { ticks: { color: '#cbd5e1', callback: (v) => '£' + v }, beginAtZero: true } },
      plugins: { legend: { display: true, labels: { color: '#cbd5e1', boxWidth: 12 } } }
    }
  });
  const leg = document.getElementById('rt-tier-legend');
  if (leg) {
    leg.innerHTML = ['thrive', 'comfortable', 'survival', 'below_survival'].map((b) =>
      `<span><span class="swatch" style="background:${BAND_COLOURS[b]}"></span>${BAND_LABEL[b]}</span>`).join('')
      + `<span><span class="swatch" style="background:${BAND_COLOURS.partial}"></span>Month in progress</span>`
      + basisNoteHtml()
      + `<span class="rt-basis-badge" data-basis="recurring_baseline">Recurring baseline</span>`;
  }
  const sub = document.getElementById('rt-section-1-sub');
  if (sub) {
    sub.textContent = rtIncludeJlr
      ? 'Side-by-side bars: headline gross (12-category, JLR included) vs recurring baseline (non-JLR minus lumpy).'
      : 'Side-by-side bars: headline with JLR stripped vs recurring baseline (non-JLR minus lumpy). Toggle at top of tab to include JLR.';
  }
}

function renderCurrentMonthPulse() {
  const el = document.getElementById('rt-current-month-pulse-body');
  if (!el) return;
  el.innerHTML = renderCurrentMonthPulseHtml(rtData, rtDiagnosis);
}

function renderExecSummary() {
  const el = document.getElementById('rt-exec-body');
  if (!el) return;
  el.innerHTML = renderExecSummaryHtml({ summary: rtData, findings: rtFindings, diagnosis: rtDiagnosis, windowMonths: rtDiagWindowMonths });
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
  if (body) body.innerHTML = renderHeadlineForecastPanelHtml(rtData.headlineStrip, rtData.config, rtData.forecast, rtData.currentMonthPulse, rtData.recurringForecast);
}

function renderAllSections() {
  updateGlobalBasisBadge();
  const keys = monthKeys();
  applyHeadlineForecastPanel();
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
  listEl.innerHTML = '<div class="rt-diag-tier-list-header"><div>Tier</div><div>Revenue / Hub / Product</div><div></div><div>Page states</div></div>' + s9.tierRowsHtml;
  bindRtTableSorting(document.querySelector('section[data-panel="revenue-truth"]'));
}

async function loadAndRenderDiagnosis() {
  const listEl = document.getElementById('rt-diag-tier-list');
  if (listEl) listEl.innerHTML = '<div class="rt-loading">Loading diagnosis…</div>';
  try {
    rtDiagnosis = await loadDiagnosis();
    await renderDiagnosis();
    renderCurrentMonthPulse();
    renderExecSummary();
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
  try {
    rtData = await loadRevenueTruth();
    rtFindings = await loadFindings();
    renderAllSections();
    await loadAndRenderDiagnosis();
    window.renderRevenueTruthTab = async () => {
      rtData = await loadRevenueTruth();
      rtFindings = await loadFindings();
      renderAllSections();
      await loadAndRenderDiagnosis();
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
      applyGlobalJlrToggle().catch((err) => {
        const el = document.getElementById('rt-error-banner');
        if (el) el.innerHTML = '<div class="rt-error">' + err.message + '</div>';
      });
      return;
    }
    if (t.name === 'rt-findings-window' && t.checked) { rtFindingsWindow = t.value; renderFindingsSection(); return; }
    if (t.id === 'rt-diag-include-event') { rtDiagIncludeEvent = t.checked; rtDiagnosis = null; loadAndRenderDiagnosis(); return; }
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

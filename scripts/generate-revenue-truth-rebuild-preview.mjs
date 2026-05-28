// Full Revenue Truth rebuild preview — every section rendered with real API data.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import handlerSummary from '../api/aigeo/revenue-truth-summary.js';
import handlerFindings from '../api/aigeo/revenue-truth-findings.js';
import handlerDiagnosis from '../api/aigeo/revenue-funnel-diagnosis.js';
import handlerBreakdown from '../api/aigeo/revenue-funnel-product-breakdown.js';
import { renderExecSummaryHtml } from '../lib/revenue-truth-exec-summary.mjs';
import { buildExecSummary } from '../lib/revenue-truth-exec-summary.mjs';
import { renderCurrentMonthPulseHtml } from '../lib/revenue-truth-current-month-pulse-ui.mjs';
import { auditExecSummaryBullets, WORRY_MAX_BULLETS } from '../lib/revenue-truth-exec-filters.mjs';
import { renderSection9Html } from '../lib/revenue-truth-section9-ui.mjs';
import {
  renderHeadlineForecastPanelHtml, headlineForecastSignals, renderMarketTable, renderCategoryTable,
  renderProductBreakdownTable, renderPageBreakdownTable, renderReconciliationPivotTable,
  renderFundingTable, renderMoversHtml, renderTierChartTable, visibleMonthKeys
} from '../lib/revenue-truth-tables-ui.mjs';
import { channelSignals, clientsSignals } from '../lib/revenue-truth-key-signals.mjs';
import 'dotenv/config';

const PROPERTY_URL = 'https://www.alanranger.com';
const EXPAND_TIERS = new Set(['workshops_non_residential', 'courses_masterclasses']);
const WINDOW_MONTHS = 3;
const EXEC_WINDOW_CHECKS = [3, 6, 12, 18];
const GDRIVE_FOLDER = '1rSUO_IwO2No9waM25uF-p9jL99ZFoGxv';

const GSC_SPOT_CHECKS = [
  { hub: 'one-day-landscape-photography-workshops', titleRe: /BLUEBELL WOODLANDS/i, imp: 1902, clicks: 21, pos: 25.4 },
  { hub: 'landscape-photography-workshops', titleRe: /PEAK DISTRICT HEATHER/i, imp: 1104, clicks: 7, pos: 31.8 },
  { hub: 'beginners-photography-classes', titleRe: /Beginners Photography Course \| 3 Weekly/i, imp: 19900, clicks: 93, pos: 32.1 },
  { hub: 'photo-editing-course-coventry', titleRe: /Lightroom Courses for Beginners/i, imp: 9269, clicks: 65, pos: 16.7 }
];

function findProductGsc(hubProducts, hub, titleRe) {
  const payload = hubProducts.get(hub);
  const row = (payload?.products || []).find((p) => titleRe.test(p.product_title || ''));
  return row?.gsc || null;
}

function assertGscSpotChecks(hubProducts) {
  const failures = [];
  for (const check of GSC_SPOT_CHECKS) {
    const g = findProductGsc(hubProducts, check.hub, check.titleRe);
    if (!g || g.impressions !== check.imp || g.clicks !== check.clicks) {
      failures.push(`${check.hub} ${check.titleRe}: got ${g?.impressions ?? 0}/${g?.clicks ?? 0}, want ${check.imp}/${check.clicks}`);
      continue;
    }
    const pos = Number(g.best_avg_position);
    if (!Number.isFinite(pos) || Math.abs(pos - check.pos) > 0.5) {
      failures.push(`${check.hub} pos: got ${g.best_avg_position}, want ~${check.pos}`);
    }
  }
  if (failures.length) {
    throw new Error('GSC spot-check failed — fix join before preview:\n' + failures.join('\n'));
  }
  console.log('GSC spot-checks PASS (4/4 product rows)');
}

async function verifyExecSummaryWindows(callHandler, summary, findings) {
  const failures = [];
  for (const wm of EXEC_WINDOW_CHECKS) {
    const diagnosis = await callHandler(handlerDiagnosis, { windowMonths: String(wm) });
    const { bullets } = buildExecSummary({ summary, findings, diagnosis, windowMonths: wm });
    const audit = auditExecSummaryBullets(bullets, wm);
    if ((bullets.worry || []).length > WORRY_MAX_BULLETS) {
      failures.push(`${wm}mo: ${bullets.worry.length} worry bullets (max ${WORRY_MAX_BULLETS})`);
    }
    if (!audit.ok) failures.push(...audit.issues.map((i) => `${wm}mo: ${i}`));
    console.log(`Exec ${wm}mo: worry=${bullets.worry.length} investigate=${bullets.investigate.length}`);
  }
  if (failures.length) {
    throw new Error('Exec summary filter verification failed:\n' + failures.join('\n'));
  }
  console.log('Exec summary window checks PASS (' + EXEC_WINDOW_CHECKS.join('/') + 'mo)');
}

const envFile = path.resolve('.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

async function callHandler(handler, query = {}) {
  const req = { method: 'GET', query: { propertyUrl: PROPERTY_URL, ...query } };
  const res = { status() { return this; }, setHeader() { return this; }, json(body) { this._body = body; } };
  await handler(req, res);
  return res._body;
}

const [summary, findings, diagnosis] = await Promise.all([
  callHandler(handlerSummary),
  callHandler(handlerFindings),
  callHandler(handlerDiagnosis, { windowMonths: String(WINDOW_MONTHS) })
]);

const hubProducts = new Map();
for (const tierKey of EXPAND_TIERS) {
  const pages = (diagnosis.diagnostics || []).filter((d) => d.tier_key === tierKey);
  for (const p of pages) {
    try {
      hubProducts.set(p.page_slug, await callHandler(handlerBreakdown, {
        page: p.page_slug, includeJlr: 'false', windowMonths: String(WINDOW_MONTHS)
      }));
    } catch (_) { /* skip */ }
  }
}

assertGscSpotChecks(hubProducts);
await verifyExecSummaryWindows(callHandler, summary, findings);

const pulseHtml = renderCurrentMonthPulseHtml(summary, diagnosis);
if (!pulseHtml.includes('May 2026') || !/£8\d{2}|£900|£7\d{2}/.test(pulseHtml)) {
  console.warn('Pulse preview check: May amount may differ from ~£800 — verify manually');
}
console.log('Pulse booked so far:', summary.currentMonthPulse?.booked_nonjlr_so_far);
console.log('Pulse blended projected:', summary.currentMonthPulse?.projection?.blended_month_end);
console.log('DEFCON:', summary.currentMonthPulse?.defcon?.level, summary.currentMonthPulse?.defcon?.status);
console.log('Pulse worst in history:', summary.currentMonthPulse?.projection?.is_worst_in_history);

const keys = visibleMonthKeys(summary.monthly, 'rolling13', summary.config.now);
const section9 = renderSection9Html(diagnosis, { expandTiers: EXPAND_TIERS, windowMonths: WINDOW_MONTHS, hubProducts });
const execHtml = renderExecSummaryHtml({ summary, findings, diagnosis, windowMonths: WINDOW_MONTHS });
const cssParts = [
  fs.readFileSync(path.resolve('scripts/revenue-truth-full-page-snapshot-styles.css'), 'utf8'),
  fs.readFileSync(path.resolve('assets/revenue-truth-tab.css'), 'utf8')
];
const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');

const html = `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Revenue Truth rebuild preview</title>
<style>${cssParts.join('\n')}</style>
</head>
<body>
<div class="wrap">
<div class="banner"><strong>REVENUE TRUTH REBUILD PREVIEW</strong> — ${ts} UTC · <strong>NOT DEPLOYED</strong><br>
<span class="muted">Window ${WINDOW_MONTHS}mo · §9 expanded: ${section9.expandedLabels}</span></div>

<div id="rt-current-month-pulse" class="rt-current-month-pulse"><div class="rt-pulse-head-bar"><h3>Current Month Pulse</h3><span class="rt-basis-badge">Non-JLR / Net · PARTIAL</span></div>${pulseHtml}</div>

<div id="rt-exec-summary" class="rt-exec-summary"><div class="rt-exec-head"><h3>Exec Summary — Revenue Truth</h3><span class="rt-basis-badge">Non-JLR / Net · ${WINDOW_MONTHS}mo</span></div>${execHtml}</div>

<div class="rt-section rt-headline-forecast" id="rt-headline-forecast"><div style="display:flex;gap:0.6rem;align-items:baseline;flex-wrap:wrap;"><h3 style="display:inline;">2. Headline &amp; full-year forecast</h3><span class="rt-basis-badge">Headline (12-category gross)</span><span class="rt-forecast-pill">PROJECTION</span></div><div id="rt-headline-forecast-signals">${headlineForecastSignals(summary.headlineStrip, summary.config, summary.forecast, summary.currentMonthPulse)}</div><div id="rt-headline-forecast-body">${renderHeadlineForecastPanelHtml(summary.headlineStrip, summary.config, summary.forecast, summary.currentMonthPulse)}</div></div>

<div class="rt-section" id="rt-tier-chart-section"><h3>1. Monthly revenue against tier bands</h3>${renderTierChartTable(summary.monthly, keys)}</div>

<div class="rt-section rt-movers" id="rt-movers"><h3>Top declines &amp; growth</h3><div class="rt-findings-grid">${renderMoversHtml(findings, '2024->2025', false)}</div></div>

<div class="rt-section rt-diag-section" id="rt-diag-section"><h3>9. Revenue Funnel Diagnosis</h3>${section9.windowBar}<div class="rt-diag-status">${section9.statusLine}</div><div class="rt-diag-tier-list">${section9.tierRowsHtml}</div></div>

<div class="rt-section" id="rt-category"><h3>4 + 5. Category breakdown</h3><div class="rt-table-scroll">${renderCategoryTable(summary.categoryBreakdown, keys, 'market')}</div></div>

<div class="rt-section" id="rt-product-breakdown"><h3>4b. Product breakdown</h3><div class="rt-table-scroll">${renderProductBreakdownTable(findings, { includeJlr: false })}</div></div>

<div class="rt-section" id="rt-page-breakdown"><h3>4c. Page breakdown</h3><div class="rt-table-scroll">${renderPageBreakdownTable(findings, { includeJlr: false })}</div></div>

<details class="rt-section rt-collapsible" id="rt-market"><summary><h3 style="display:inline;">3. Market split</h3></summary><div class="rt-table-scroll">${renderMarketTable(summary.monthly, keys)}</div></details>

<details class="rt-section rt-collapsible" id="rt-channel-section"><summary><h3 style="display:inline;">6. Channel mix</h3></summary><div id="rt-channel-signals">${channelSignals(summary.channelMix)}</div><div class="rt-table-scroll">${renderReconciliationPivotTable(summary.channelMix, 'Channel', (r) => r.label, keys)}</div></details>

<details class="rt-section rt-collapsible" id="rt-clients-section"><summary><h3 style="display:inline;">7. New vs Existing</h3></summary><div id="rt-clients-signals">${clientsSignals(summary.newVsExisting)}</div><div class="rt-table-scroll">${renderReconciliationPivotTable(summary.newVsExisting, 'Client type', (r) => r.label, keys)}</div></details>

<details class="rt-section rt-collapsible" id="rt-funding-section"><summary><h3 style="display:inline;">8. Funding source &amp; fees</h3></summary><div class="rt-table-scroll">${renderFundingTable(summary.fundingFees, keys)}</div></details>

</div></body></html>`;

const hash = crypto.createHash('sha256').update(html).digest('hex').slice(0, 8);
const fileName = `REVENUE-TRUTH-REBUILD-PREVIEW-${hash}.html`;
const outPath = path.resolve('Docs', fileName);
fs.writeFileSync(outPath, html);
console.log('Wrote', outPath);
console.log('Hash:', hash);

try {
  const { execSync } = await import('node:child_process');
  execSync(`rclone copy "${outPath}" "gdrive:${GDRIVE_FOLDER}/"`, { stdio: 'inherit' });
  console.log('Uploaded to Google Drive as', fileName);
} catch (err) {
  console.warn('Drive upload skipped:', err.message);
  console.warn('Manual upload:', outPath, '→ folder', GDRIVE_FOLDER);
}

/** Standalone Current Month Pulse / DEFCON snapshot for PDF export. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import handlerSummary from '../api/aigeo/revenue-truth-summary.js';
import handlerDiagnosis from '../api/aigeo/revenue-funnel-diagnosis.js';
import { renderCurrentMonthPulseHtml } from '../lib/revenue-truth-current-month-pulse-ui.mjs';
import 'dotenv/config';

const PROPERTY_URL = 'https://www.alanranger.com';
const WINDOW_MONTHS = 3;

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

const [summary, diagnosis] = await Promise.all([
  callHandler(handlerSummary),
  callHandler(handlerDiagnosis, { windowMonths: String(WINDOW_MONTHS) })
]);

const pulse = summary.currentMonthPulse;
const pulseHtml = renderCurrentMonthPulseHtml(summary, diagnosis);
const css = fs.readFileSync(path.resolve('assets/revenue-truth-tab.css'), 'utf8');
const ts = new Date().toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
const defcon = pulse?.defcon;
const meta = [
  pulse?.month_label,
  defcon?.active ? `DEFCON ${defcon.level} ${defcon.status}` : 'Insufficient data',
  pulse ? `Booked ${pulse.booked_nonjlr_so_far} · Worst ${defcon?.projected_month_end ?? '-'}` : ''
].filter(Boolean).join(' · ');

const printCss = `
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: #050a12; color: #e2e8f0; line-height: 1.45; }
.wrap { max-width: 1100px; margin: 0 auto; padding: 1.25rem 1rem 2rem; }
.doc-header { margin-bottom: 1rem; padding-bottom: 0.75rem; border-bottom: 1px solid #334155; }
.doc-header h1 { margin: 0 0 0.35rem; font-size: 1.25rem; color: #fde68a; }
.doc-header .sub { font-size: 0.82rem; color: #94a3b8; }
.doc-header .meta { font-size: 0.9rem; color: #fecaca; margin-top: 0.35rem; font-weight: 600; }
.rt-current-month-pulse { position: static !important; }
.rt-table { width: 100%; border-collapse: collapse; }
.rt-table th, .rt-table td { border-bottom: 1px solid #1e293b; text-align: center; vertical-align: middle; }
.is-negative { color: #fca5a5; }
.is-positive { color: #86efac; }
.rt-pill { display: inline-block; padding: 0.1rem 0.45rem; border-radius: 999px; font-size: 0.68rem; font-weight: 700; background: #334155; color: #cbd5e1; }
.rt-basis-badge { display: inline-block; font-size: 0.62rem; padding: 0.12rem 0.4rem; border-radius: 4px; background: #1e293b; color: #94a3b8; border: 1px solid #334155; }
.rt-slug-link { color: #93c5fd; text-decoration: none; }
.rt-grand-total { font-weight: 800; }
.rt-grand-total-label { font-weight: 800; }
@media print {
  body { background: #fff; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .wrap { max-width: none; padding: 0.5in; }
  .no-print { display: none !important; }
  .rt-current-month-pulse { border: 2px solid #333 !important; page-break-inside: avoid; }
  .rt-pulse-verdict, .rt-pulse-insight, .rt-pulse-action-chip { page-break-inside: avoid; }
  .rt-pulse-numbers-body, .rt-pulse-glance { page-break-inside: avoid; }
  .rt-slug-link { color: #1d4ed8; }
  .is-negative { color: #b91c1c; }
}
`;

const html = `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DEFCON Pulse — ${pulse?.month_label || 'Current month'} — Alan Ranger Photography</title>
<style>${printCss}\n${css}</style>
</head>
<body>
<div class="wrap">
<header class="doc-header">
  <h1>Current Month Pulse — DEFCON</h1>
  <p class="sub">Alan Ranger Photography · Revenue Truth · Generated ${ts}</p>
  <p class="meta">${meta}</p>
  <p class="sub no-print">Open in browser → Print → Save as PDF (enable background graphics for colours).</p>
</header>
<div id="rt-current-month-pulse" class="rt-current-month-pulse">
  <div class="rt-pulse-head-bar"><h3 style="margin:0;font-size:1rem;color:#fecaca;">Current Month Pulse</h3><span class="rt-basis-badge">Non-JLR / Net · PARTIAL</span></div>
  ${pulseHtml}
</div>
<footer class="doc-header" style="margin-top:1.5rem;border-bottom:none;border-top:1px solid #334155;padding-top:0.75rem;">
  <p class="sub">Recurring baseline excludes residential workshops, voucher tiers, and event-bound products. Headline non-JLR net otherwise.</p>
  <p class="sub">Source: booking_sheet_transactions + GSC via ai-geo-audit Revenue Truth tab.</p>
</footer>
</div>
</body>
</html>`;

const hash = crypto.createHash('sha256').update(html).digest('hex').slice(0, 8);
const fileName = `DEFCON-PULSE-SNAPSHOT-${hash}.html`;
const outPath = path.resolve('Docs', fileName);
fs.writeFileSync(outPath, html);
console.log('Wrote', outPath);
console.log('Hash:', hash);
console.log('DEFCON:', defcon?.level, defcon?.status, 'worst', defcon?.projected_month_end);

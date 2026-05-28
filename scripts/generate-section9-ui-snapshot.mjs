// Generates Docs/SECTION9-FULL-UI-SNAPSHOT.html from live diagnosis API.
// §9 only — for sharing the diagnosis UI structure.

import fs from 'node:fs';
import path from 'node:path';
import handler from '../api/aigeo/revenue-funnel-diagnosis.js';
import { escapeHtml } from './lib/snapshot-utils.mjs';
import { renderSection9Html } from './lib/section9-snapshot-render.mjs';
import 'dotenv/config';

const EXPAND_TIERS = new Set([
  'workshops_non_residential',
  'courses_masterclasses'
]);

const envFile = path.resolve('.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const req = { method: 'GET', query: { propertyUrl: 'https://www.alanranger.com' } };
const res = { status() { return this; }, setHeader() { return this; }, json(b) { this._body = b; } };
await handler(req, res);
const payload = res._body;

let breakdownSample = null;
try {
  const bRes = await fetch('https://ai-geo-audit.vercel.app/api/aigeo/revenue-funnel-product-breakdown?page=landscape-photography-workshops&includeJlr=false&windowMonths=17');
  if (bRes.ok) breakdownSample = await bRes.json();
} catch (_) { /* optional */ }

const section9 = renderSection9Html(payload, { expandTiers: EXPAND_TIERS, breakdownSample });
const css = fs.readFileSync(path.resolve('scripts/section9-snapshot-styles.css'), 'utf8');
const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');

const html = `<!DOCTYPE html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>§9 Revenue Funnel Diagnosis — UI snapshot</title><style>${css}</style></head><body><div class="wrap"><div class="banner"><strong>§9 UI snapshot</strong> — generated ${ts} UTC · live diagnosis API<br><span class="muted">Expanded tiers: ${escapeHtml(section9.expandedLabels)} · collapsed: all others · Sparklines shown as placeholders · For the full Revenue Truth tab see Docs/REVENUE-TRUTH-FULL-PAGE-SNAPSHOT.html</span></div><div class="rt-diag-section"><div class="rt-diag-header"><h3>9. Revenue Funnel Diagnosis <span class="rt-diag-pill">TIER → PAGE → PRODUCT</span></h3><p class="rt-sub">Level 1 tier row (revenue + Hub|Product GSC) · expand → slug tables + page cards · mixed pages → Level 3 revenue breakdown. GSC overlay Jan 2025+ only.</p></div><div class="rt-diag-status">${escapeHtml(section9.statusLine)}</div><div class="rt-diag-tier-list-header"><div>Tier</div><div>Revenue trend</div><div>GSC by page role</div><div style="text-align:right;">Page states</div></div><div class="rt-diag-tier-list">${section9.tierRowsHtml}</div></div></div></body></html>`;

const outPath = path.resolve('Docs/SECTION9-FULL-UI-SNAPSHOT.html');
fs.writeFileSync(outPath, html);
console.log('Wrote', outPath);

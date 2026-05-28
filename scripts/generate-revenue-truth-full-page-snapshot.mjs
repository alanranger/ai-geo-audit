// Generates Docs/REVENUE-TRUTH-FULL-PAGE-SNAPSHOT.html — entire Revenue Truth tab.
// §9 expanded: workshops_non_residential + courses_masterclasses only.

import fs from 'node:fs';
import path from 'node:path';
import handlerSummary from '../api/aigeo/revenue-truth-summary.js';
import handlerFindings from '../api/aigeo/revenue-truth-findings.js';
import handlerDiagnosis from '../api/aigeo/revenue-funnel-diagnosis.js';
import { renderFullPageHtml } from './lib/revenue-truth-full-page-render.mjs';
import 'dotenv/config';

const PROPERTY_URL = 'https://www.alanranger.com';
const EXPAND_TIERS = new Set(['workshops_non_residential', 'courses_masterclasses']);

const envFile = path.resolve('.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

async function callHandler(handler, query = {}) {
  const req = { method: 'GET', query: { propertyUrl: PROPERTY_URL, ...query } };
  const res = {
    status() { return this; },
    setHeader() { return this; },
    json(body) { this._body = body; }
  };
  await handler(req, res);
  return res._body;
}

const [summary, findings, diagnosis] = await Promise.all([
  callHandler(handlerSummary),
  callHandler(handlerFindings),
  callHandler(handlerDiagnosis)
]);

let breakdownSample = null;
try {
  const bRes = await fetch('https://ai-geo-audit.vercel.app/api/aigeo/revenue-funnel-product-breakdown?page=landscape-photography-workshops&includeJlr=false&windowMonths=17');
  if (bRes.ok) breakdownSample = await bRes.json();
} catch (_) { /* optional L3 sample */ }

const css = fs.readFileSync(path.resolve('scripts/revenue-truth-full-page-snapshot-styles.css'), 'utf8');
const generatedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
const html = renderFullPageHtml({
  summary,
  findings,
  diagnosis,
  breakdownSample,
  expandTiers: EXPAND_TIERS,
  generatedAt,
  css
});

const outPath = path.resolve('Docs/REVENUE-TRUTH-FULL-PAGE-SNAPSHOT.html');
fs.writeFileSync(outPath, html);
console.log('Wrote', outPath);
console.log('§9 expanded tiers:', [...EXPAND_TIERS].join(', '));

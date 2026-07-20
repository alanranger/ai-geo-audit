/**
 * Server-side Full refresh job — calls production APIs in sequence.
 * Equivalent to Dashboard ▶ Full refresh + revenue/GA4/DFS (no Booking Sheet file).
 *
 * Usage:
 *   node scripts/run-full-refresh-job.mjs
 *   node scripts/run-full-refresh-job.mjs --base https://ai-geo-audit.vercel.app
 *
 * Logs: scripts/output/full-refresh-job-<timestamp>.log
 */

import { mkdirSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const PROPERTY = 'https://www.alanranger.com';
const BASE = process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : (process.env.CRON_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://ai-geo-audit.vercel.app');

for (const envFile of ['.env.local', '.env']) {
  const p = join(ROOT, envFile);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) {
      process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}

const CRON_SECRET = process.env.CRON_SECRET || '';
const outDir = join(__dir, 'output');
mkdirSync(outDir, { recursive: true });
const logPath = join(outDir, `full-refresh-job-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);

const log = (msg) => {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  appendFileSync(logPath, line + '\n', 'utf8');
};

const cronHeaders = () => {
  const h = { Accept: 'application/json' };
  if (CRON_SECRET) h['x-cron-secret'] = CRON_SECRET;
  return h;
};

const revenueWindow13mo = () => {
  const today = new Date();
  const end = today.toISOString().slice(0, 10);
  const startDt = new Date(today.getFullYear(), today.getMonth() - 12, 1);
  return { start: startDt.toISOString().slice(0, 10), end };
};

async function callStep(label, url, options = {}, timeoutMs = 600000) {
  log(`START ${label}`);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* plain text */ }
    const summary = json?.status || json?.ok || json?.message || text.slice(0, 200);
    if (!res.ok) {
      log(`FAIL ${label} HTTP ${res.status}: ${summary}`);
      return { ok: false, status: res.status, json, text };
    }
    log(`OK ${label}: ${summary}`);
    return { ok: true, status: res.status, json, text };
  } catch (err) {
    log(`FAIL ${label}: ${err?.message || err}`);
    return { ok: false, error: err?.message || String(err) };
  } finally {
    clearTimeout(t);
  }
}

const steps = [];
const run = async (label, url, options, timeoutMs) => {
  const r = await callStep(label, url, options, timeoutMs);
  steps.push({ label, ok: r.ok });
  return r;
};

log(`Full refresh job → ${BASE}`);
log(`Property: ${PROPERTY}`);
log(`Log file: ${logPath}`);
if (!CRON_SECRET) log('WARN: CRON_SECRET not set — cron endpoints may return 401');

const q = encodeURIComponent(PROPERTY);
const secretQ = CRON_SECRET ? `&secret=${encodeURIComponent(CRON_SECRET)}` : '';
const { start: revStart, end: revEnd } = revenueWindow13mo();

await run('1/10 Sync CSV', `${BASE}/api/sync-csv`, { method: 'GET', headers: cronHeaders() }, 120000);

await run(
  '2/10 GSC + schema full audit (daily-gsc-backlink cron)',
  `${BASE}/api/cron/daily-gsc-backlink?force=1&propertyUrl=${q}${secretQ}`,
  { method: 'GET', headers: cronHeaders() },
  600000
);

await run(
  '3/10 Ranking & AI (keyword-ranking-ai cron)',
  `${BASE}/api/cron/keyword-ranking-ai?force=1&propertyUrl=${q}${secretQ}`,
  { method: 'GET', headers: cronHeaders() },
  600000
);

await run(
  '4/10 Squarespace revenue (13mo)',
  `${BASE}/api/aigeo/squarespace-revenue-sync`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...cronHeaders() },
    body: JSON.stringify({ propertyUrl: PROPERTY, period_start: revStart, period_end: revEnd })
  },
  600000
);

await run(
  '5/10 Stripe revenue (13mo)',
  `${BASE}/api/aigeo/stripe-revenue-sync`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...cronHeaders() },
    body: JSON.stringify({ propertyUrl: PROPERTY, period_start: revStart, period_end: revEnd })
  },
  600000
);

await run(
  '6/10 GA4 enquiry metrics (28d)',
  `${BASE}/api/aigeo/ga4-metrics`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ propertyUrl: PROPERTY, refresh: true })
  },
  180000
);

await run(
  '7/10 DFS backlink full index',
  `${BASE}/api/aigeo/dataforseo-backlink-domain`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'full', domain: 'alanranger.com' })
  },
  600000
);

await run(
  '8/10 Domain Strength snapshot',
  `${BASE}/api/domain-strength/snapshot`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'run', includePending: true })
  },
  600000
);

await run(
  '9/10 Optimisation bulk task update',
  `${BASE}/api/optimisation/bulk-update?propertyUrl=${q}`,
  { method: 'POST', headers: { 'Content-Type': 'application/json', ...cronHeaders() } },
  300000
);

await run(
  '10/10 Revenue sync status probe',
  `${BASE}/api/aigeo/revenue-sync-status?propertyUrl=${q}`,
  { method: 'GET' },
  60000
);

const ok = steps.filter((s) => s.ok).length;
const fail = steps.length - ok;
log(`DONE ${ok}/${steps.length} steps succeeded, ${fail} failed`);
log('Skipped manually: Booking Sheet (.xlsm), csv_metadata tier import (no dashboard API)');
process.exit(fail > 0 ? 1 : 0);

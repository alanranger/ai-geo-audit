// Phase C / Sub-phase C0: backfill GSC per-(date, page) rows into the
// EXISTING gsc_page_timeseries table, idempotently, weekly-chunked, with
// run logging in gsc_backfill_runs.
//
// PURPOSE: Page-level GSC data with NO query-dimension click anonymisation.
// The page+query backfill (gsc-c0-backfill-page-query-daily.mjs) drops
// ~61% of clicks on alanranger; this page-only backfill preserves the true
// per-page totals for the Phase C funnel diagnosis (E1, E2, UI1, UI2).
//
// FORMAT COMPATIBILITY: matches the existing gsc_page_timeseries writers
// (api/cron/backfill-money-page-timeseries.js):
//   - page_url stored as slug only (no protocol, no domain, no leading
//     slash, lowercased, query+fragment stripped) via the same
//     normalizeUrl() implementation as the existing populator
//   - ctr stored as percentage (0..100) -- multiplied by 100 from API
//   - position stored as null when GSC returns null (no impressions day)
//   - one row per (property_url, page_url, date); idempotent upsert on
//     the existing UNIQUE (property_url, page_url, date) constraint
//
// SCOPE DIFFERENCE FROM EXISTING POPULATOR: the existing job filters to a
// curated "money pages" allowlist. This backfill writes ALL pages returned
// by GSC for the property -- it is therefore additive, never destructive,
// even on dates the money-pages job has already touched.
//
// SKIP-COVERED BEHAVIOUR: by default, weeks that already have any row in
// gsc_page_timeseries for the property are SKIPPED (per user instruction
// "skip dates already populated"). Use --force to re-pull those weeks
// (recommended after initial backfill to fill the page-coverage gap left
// by the money-pages filter -- this is surfaced in the C0.5 verification).
//
// Usage:
//   node scripts/gsc-c0-backfill-page-daily.mjs
//   node scripts/gsc-c0-backfill-page-daily.mjs --from 2025-06-01 --to 2025-06-30
//   node scripts/gsc-c0-backfill-page-daily.mjs --force
//   node scripts/gsc-c0-backfill-page-daily.mjs --dry-run

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });
dotenvConfig({ path: '.env' });

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const PROPERTY = 'https://www.alanranger.com';
const ROW_LIMIT = 25000;
const REQUEST_PAUSE_MS = 120;
const UPSERT_BATCH = 1000;
const DEFAULT_FROM = '2025-01-13';
const DEFAULT_TO = isoDateOffset(-2);

const supabase = createClient(
  requireEnv('SUPABASE_URL'),
  requireEnv('SUPABASE_SERVICE_ROLE_KEY')
);

const ARGS = parseArgs(process.argv.slice(2));

try {
  await main();
} catch (e) {
  console.error('FATAL:', e);
  process.exit(1);
}

async function main() {
  const fromDate = ARGS.from || DEFAULT_FROM;
  const toDate = ARGS.to || DEFAULT_TO;
  console.log(`Phase C0 page-only backfill: ${fromDate} .. ${toDate} (force=${!!ARGS.force} dry=${!!ARGS['dry-run']})`);

  const chunks = weeklyChunks(fromDate, toDate);
  console.log(`Planned chunks: ${chunks.length} (weekly)`);

  const token = ARGS['dry-run'] ? 'DRY' : await getAccessToken();
  const totals = { runs: 0, skipped: 0, completed: 0, failed: 0, rowsUpserted: 0, apiCalls: 0 };

  for (const [i, { start, end }] of chunks.entries()) {
    const label = `[${i + 1}/${chunks.length}] ${start}..${end}`;
    if (!ARGS.force && (await alreadyPopulated(start, end))) {
      console.log(`${label} SKIP (gsc_page_timeseries has rows in this range)`);
      totals.skipped += 1;
      continue;
    }
    const runId = `c0-pd-${start}-${end}-${randomUUID().slice(0, 8)}`;
    const result = await runChunk({ token, runId, start, end, label });
    totals.runs += 1;
    totals[result.status === 'completed' ? 'completed' : 'failed'] += 1;
    totals.rowsUpserted += result.rowsUpserted;
    totals.apiCalls += result.apiCalls;
  }

  console.log('\n--- PAGE-DAILY BACKFILL SUMMARY ---');
  console.log(JSON.stringify(totals, null, 2));
}

async function runChunk({ token, runId, start, end, label }) {
  if (ARGS['dry-run']) {
    console.log(`${label} DRY-RUN (would fetch and upsert)`);
    return { status: 'completed', rowsUpserted: 0, apiCalls: 0 };
  }

  await supabase.from('gsc_backfill_runs').insert({
    run_id: runId, status: 'running',
    date_range_start: start, date_range_end: end,
    notes: 'page-daily backfill into gsc_page_timeseries',
  });

  let apiCalls = 0;
  let rowsUpserted = 0;
  try {
    const rows = await fetchAllRows({ token, start, end, onCall: () => { apiCalls += 1; } });
    console.log(`${label} fetched ${rows.length} rows in ${apiCalls} call(s)`);
    rowsUpserted = await upsertRows(rows);
    await supabase.from('gsc_backfill_runs').update({
      status: 'completed', completed_at: new Date().toISOString(),
      rows_inserted: rows.length, rows_upserted: rowsUpserted, api_calls: apiCalls,
    }).eq('run_id', runId);
    return { status: 'completed', rowsUpserted, apiCalls };
  } catch (e) {
    const errorMsg = e.message || String(e);
    console.error(`${label} FAILED: ${errorMsg}`);
    await supabase.from('gsc_backfill_runs').update({
      status: 'failed', completed_at: new Date().toISOString(),
      api_calls: apiCalls, error_message: errorMsg,
    }).eq('run_id', runId);
    return { status: 'failed', rowsUpserted, apiCalls };
  }
}

async function fetchAllRows({ token, start, end, onCall }) {
  const all = [];
  let startRow = 0;
  for (;;) {
    const batch = await fetchOnePage({ token, start, end, startRow, onCall });
    if (!batch.length) break;
    all.push(...batch);
    if (batch.length < ROW_LIMIT) break;
    startRow += ROW_LIMIT;
    await sleep(REQUEST_PAUSE_MS);
  }
  return all;
}

async function fetchOnePage({ token, start, end, startRow, onCall }) {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(PROPERTY)}/searchAnalytics/query`;
  const body = {
    startDate: start, endDate: end,
    dimensions: ['date', 'page'],
    rowLimit: ROW_LIMIT, startRow,
    dataState: 'final',
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  onCall?.();
  if (!r.ok) {
    const errText = await r.text();
    throw new Error(`searchAnalytics ${r.status}: ${errText.slice(0, 400)}`);
  }
  const j = await r.json();
  return mapRows(j.rows || []);
}

function mapRows(apiRows) {
  const out = [];
  for (const row of apiRows) {
    const date = row.keys?.[0] || null;
    const pageRaw = row.keys?.[1] || null;
    if (!date || !pageRaw) continue;
    const pageUrl = normalizeUrl(pageRaw);
    if (!pageUrl) continue;
    out.push({
      property_url: PROPERTY,
      page_url: pageUrl,
      date,
      clicks: Math.trunc(row.clicks ?? 0),
      impressions: Math.trunc(row.impressions ?? 0),
      ctr: row.ctr ? Number(row.ctr) * 100 : 0,
      position: row.position == null ? null : Number(row.position),
      updated_at: new Date().toISOString(),
    });
  }
  return dedupeRecords(out);
}

function dedupeRecords(records) {
  const byKey = new Map();
  for (const r of records) {
    const key = `${r.property_url}|${r.page_url}|${r.date}`;
    const existing = byKey.get(key);
    if (!existing) { byKey.set(key, r); continue; }
    byKey.set(key, pickBetterRecord(existing, r));
  }
  return Array.from(byKey.values());
}

function pickBetterRecord(a, b) {
  if (a.clicks !== b.clicks) return a.clicks > b.clicks ? a : b;
  if (a.impressions !== b.impressions) return a.impressions > b.impressions ? a : b;
  return a;
}

async function upsertRows(rows) {
  if (!rows.length) return 0;
  let total = 0;
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH);
    const { error } = await supabase
      .from('gsc_page_timeseries')
      .upsert(batch, { onConflict: 'property_url,page_url,date', ignoreDuplicates: false });
    if (error) throw new Error(`upsert batch [${i}..${i + batch.length}]: ${error.message}`);
    total += batch.length;
  }
  return total;
}

async function alreadyPopulated(start, end) {
  const { count, error } = await supabase
    .from('gsc_page_timeseries')
    .select('property_url', { count: 'exact', head: true })
    .eq('property_url', PROPERTY)
    .gte('date', start)
    .lte('date', end);
  if (error) throw new Error(`alreadyPopulated probe: ${error.message}`);
  return (count ?? 0) > 0;
}

async function getAccessToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: requireEnv('GOOGLE_CLIENT_ID'),
      client_secret: requireEnv('GOOGLE_CLIENT_SECRET'),
      refresh_token: requireEnv('GOOGLE_REFRESH_TOKEN'),
      grant_type: 'refresh_token',
    }),
  });
  if (!r.ok) throw new Error(`token ${r.status}: ${await r.text()}`);
  return (await r.json()).access_token;
}

// Exact same normalisation as api/cron/backfill-money-page-timeseries.js
// (lines 10-21). Required so new rows share the page_url slug format with
// existing rows -- otherwise the UNIQUE(property_url, page_url, date)
// constraint sees them as different rows and we'd get parallel slug + full-URL
// formats in the same table.
function normalizeUrl(url) {
  if (!url) return '';
  let normalized = String(url).toLowerCase().trim();
  normalized = normalized.replace(/^https?:\/\//, '');
  normalized = normalized.replace(/^www\./, '');
  normalized = normalized.split('?')[0].split('#')[0];
  const parts = normalized.split('/');
  if (parts.length > 1) {
    normalized = parts.slice(1).join('/');
  }
  return normalized.replace(/^\/+/, '').replace(/\/+$/, '');
}

function requireEnv(k) {
  const v = process.env[k];
  if (!v) throw new Error(`missing env var ${k} (check .env.local)`);
  return v;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force' || a === '--dry-run') { out[a.slice(2)] = true; continue; }
    if (a.startsWith('--')) { out[a.slice(2)] = argv[++i]; }
  }
  return out;
}

function isoDateOffset(daysFromToday) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

function weeklyChunks(fromIso, toIso) {
  const ONE_DAY_MS = 86_400_000;
  const out = [];
  const endTs = new Date(toIso + 'T00:00:00Z').getTime();
  let curTs = new Date(fromIso + 'T00:00:00Z').getTime();
  while (curTs <= endTs) {
    const chunkEndTs = Math.min(curTs + 6 * ONE_DAY_MS, endTs);
    out.push({
      start: new Date(curTs).toISOString().slice(0, 10),
      end: new Date(chunkEndTs).toISOString().slice(0, 10),
    });
    curTs += 7 * ONE_DAY_MS;
  }
  return out;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

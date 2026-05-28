// Phase C / Sub-phase C0: backfill GSC per-(date, page, query) rows into
// gsc_page_query_daily, idempotently, weekly-chunked, with run logging in
// gsc_backfill_runs.
//
// Reuses OAuth2 refresh-token auth from api/aigeo/utils.js (same env vars as
// every other GSC ingest in this repo). Property: https://www.alanranger.com
// (URL-prefix form). Window: 2025-01-13 (GSC retention floor at run-time of
// 2026-05-27) .. yesterday minus 2 days (GSC reporting lag).
//
// Usage:
//   node scripts/gsc-c0-backfill-page-query-daily.mjs
//   node scripts/gsc-c0-backfill-page-query-daily.mjs --from 2025-06-01 --to 2025-06-30
//   node scripts/gsc-c0-backfill-page-query-daily.mjs --force   (re-run completed chunks)
//   node scripts/gsc-c0-backfill-page-query-daily.mjs --dry-run (no API or DB writes)

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });
dotenvConfig({ path: '.env' });

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const PROPERTY = 'https://www.alanranger.com';
const ROW_LIMIT = 25000;            // GSC API maximum per call
const REQUEST_PAUSE_MS = 120;        // ~8 QPS, well under 1200/min cap
const UPSERT_BATCH = 500;            // Supabase upsert payload size
const DEFAULT_FROM = '2025-01-13';   // empirically-verified retention floor
const DEFAULT_TO   = isoDateOffset(-2); // GSC has ~2-day reporting lag

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
  const toDate   = ARGS.to   || DEFAULT_TO;
  console.log(`Phase C0 backfill: ${fromDate} .. ${toDate} (force=${!!ARGS.force} dry=${!!ARGS['dry-run']})`);

  const chunks = weeklyChunks(fromDate, toDate);
  console.log(`Planned chunks: ${chunks.length} (weekly)`);

  const token = ARGS['dry-run'] ? 'DRY' : await getAccessToken();
  const totals = { runs: 0, skipped: 0, completed: 0, failed: 0, rowsUpserted: 0, apiCalls: 0 };

  for (const [i, { start, end }] of chunks.entries()) {
    const label = `[${i + 1}/${chunks.length}] ${start}..${end}`;
    if (!ARGS.force && (await alreadyCompleted(start, end))) {
      console.log(`${label} SKIP (already completed)`);
      totals.skipped += 1;
      continue;
    }
    const runId = `c0-${start}-${end}-${randomUUID().slice(0, 8)}`;
    const result = await runChunk({ token, runId, start, end, label });
    totals.runs += 1;
    totals[result.status === 'completed' ? 'completed' : 'failed'] += 1;
    totals.rowsUpserted += result.rowsUpserted;
    totals.apiCalls += result.apiCalls;
  }

  console.log('\n--- BACKFILL SUMMARY ---');
  console.log(JSON.stringify(totals, null, 2));
}

// --- core chunk runner ------------------------------------------------------

async function runChunk({ token, runId, start, end, label }) {
  if (ARGS['dry-run']) {
    console.log(`${label} DRY-RUN (would fetch and upsert)`);
    return { status: 'completed', rowsUpserted: 0, apiCalls: 0 };
  }

  await supabase.from('gsc_backfill_runs').insert({
    run_id: runId, status: 'running',
    date_range_start: start, date_range_end: end,
  });

  let apiCalls = 0, rowsUpserted = 0, errorMsg = null;
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
    errorMsg = e.message || String(e);
    console.error(`${label} FAILED: ${errorMsg}`);
    await supabase.from('gsc_backfill_runs').update({
      status: 'failed', completed_at: new Date().toISOString(),
      api_calls: apiCalls, error_message: errorMsg,
    }).eq('run_id', runId);
    return { status: 'failed', rowsUpserted, apiCalls };
  }
}

// --- GSC API fetch (paginated) ---------------------------------------------

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
    dimensions: ['date', 'page', 'query'],
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
  return (j.rows || []).map((row) => ({
    property_url: PROPERTY,
    date: row.keys[0],
    page_url: row.keys[1],
    query: row.keys[2],
    clicks: Math.trunc(row.clicks ?? 0),
    impressions: Math.trunc(row.impressions ?? 0),
    ctr: Number(row.ctr) || 0,
    position: row.position == null ? null : Number(row.position),
  }));
}

// --- Supabase upsert (batched) ---------------------------------------------

async function upsertRows(rows) {
  if (!rows.length) return 0;
  let total = 0;
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH);
    const { error } = await supabase
      .from('gsc_page_query_daily')
      .upsert(batch, { onConflict: 'property_url,date,page_url,query', ignoreDuplicates: false });
    if (error) throw new Error(`upsert batch [${i}..${i + batch.length}]: ${error.message}`);
    total += batch.length;
  }
  return total;
}

// --- idempotency check -----------------------------------------------------

async function alreadyCompleted(start, end) {
  const { data, error } = await supabase
    .from('gsc_backfill_runs')
    .select('run_id')
    .eq('date_range_start', start).eq('date_range_end', end).eq('status', 'completed')
    .limit(1);
  if (error) throw new Error(`alreadyCompleted check: ${error.message}`);
  return Boolean(data?.length);
}

// --- OAuth --------------------------------------------------------------------

async function getAccessToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     requireEnv('GOOGLE_CLIENT_ID'),
      client_secret: requireEnv('GOOGLE_CLIENT_SECRET'),
      refresh_token: requireEnv('GOOGLE_REFRESH_TOKEN'),
      grant_type: 'refresh_token',
    }),
  });
  if (!r.ok) throw new Error(`token ${r.status}: ${await r.text()}`);
  return (await r.json()).access_token;
}

// --- utils -------------------------------------------------------------------

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
  let curTs  = new Date(fromIso + 'T00:00:00Z').getTime();
  while (curTs <= endTs) {
    const chunkEndTs = Math.min(curTs + 6 * ONE_DAY_MS, endTs);
    out.push({
      start: new Date(curTs).toISOString().slice(0, 10),
      end:   new Date(chunkEndTs).toISOString().slice(0, 10),
    });
    curTs += 7 * ONE_DAY_MS;
  }
  return out;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

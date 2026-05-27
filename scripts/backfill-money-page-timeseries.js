// CLI mirror of api/cron/backfill-money-page-timeseries.js so the same fetch+
// upsert path can be exercised locally (for ad-hoc backfills and for the
// regression-check against the C0 backfill).
//
// 2026-05-27 rewrite -- now writes ALL pages returned by GSC for the property
// (no money-pages allowlist). See the cron file header for the full rewrite
// rationale and history.
//
// Usage:
//   node scripts/backfill-money-page-timeseries.js
//   node scripts/backfill-money-page-timeseries.js --startDate 2026-05-19 --endDate 2026-05-25
//   node scripts/backfill-money-page-timeseries.js --daysBack 7
//   node scripts/backfill-money-page-timeseries.js --propertyUrl https://www.alanranger.com

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });
dotenvConfig({ path: '.env' });

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { getGSCAccessToken, normalizePropertyUrl, getGscDateRange } from '../api/aigeo/utils.js';

const TAG = '[Cron mirror]';
const ROW_LIMIT = 25000;
const REQUEST_PAUSE_MS = 120;
const UPSERT_BATCH = 1000;

const need = (k) => {
  const v = process.env[k];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${k}`);
  return v;
};

function getArg(name, def = null) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return def;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return def;
  return v;
}

const normalizeUrl = (url) => {
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
};

function resolveDateRange() {
  const startDate = getArg('startDate');
  const endDate = getArg('endDate');
  if (startDate && endDate) return { startDate, endDate };
  const parsedDays = Number.parseInt(getArg('daysBack'), 10);
  const days = Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : 7;
  return getGscDateRange({ daysBack: days, endOffsetDays: 1 });
}

async function fetchGscPage(siteUrl, startDate, endDate, startRow, accessToken) {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      startDate,
      endDate,
      dimensions: ['date', 'page'],
      rowLimit: ROW_LIMIT,
      startRow,
      dataState: 'final'
    })
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`gsc_api_error:${response.status}:${errorText.slice(0, 400)}`);
  }
  const data = await response.json().catch(() => ({}));
  return Array.isArray(data.rows) ? data.rows : [];
}

async function fetchAllGscRows(siteUrl, startDate, endDate) {
  const accessToken = await getGSCAccessToken();
  const all = [];
  let startRow = 0;
  let apiCalls = 0;
  for (;;) {
    const batch = await fetchGscPage(siteUrl, startDate, endDate, startRow, accessToken);
    apiCalls += 1;
    if (batch.length === 0) break;
    all.push(...batch);
    if (batch.length < ROW_LIMIT) break;
    startRow += ROW_LIMIT;
    await new Promise((resolve) => setTimeout(resolve, REQUEST_PAUSE_MS));
  }
  return { rows: all, apiCalls };
}

function mapGscRowsToRecords(rows, siteUrl) {
  const result = [];
  for (const row of rows) {
    const date = row.keys?.[0] || null;
    const page = row.keys?.[1] || null;
    if (!date || !page) continue;
    const pageUrl = normalizeUrl(page);
    if (!pageUrl) continue;
    result.push({
      property_url: siteUrl,
      page_url: pageUrl,
      date,
      clicks: Number(row.clicks || 0),
      impressions: Number(row.impressions || 0),
      ctr: Number(row.ctr ? row.ctr * 100 : 0),
      position: row.position != null ? Number(row.position) : null,
      updated_at: new Date().toISOString()
    });
  }
  return result;
}

function pickBetterRecord(a, b) {
  if (a.clicks !== b.clicks) return a.clicks > b.clicks ? a : b;
  if (a.impressions !== b.impressions) return a.impressions > b.impressions ? a : b;
  return a;
}

function dedupeRecords(records) {
  const byKey = new Map();
  let collisions = 0;
  for (const r of records) {
    const key = `${r.property_url}|${r.page_url}|${r.date}`;
    const existing = byKey.get(key);
    if (existing) {
      collisions += 1;
      byKey.set(key, pickBetterRecord(existing, r));
    } else {
      byKey.set(key, r);
    }
  }
  return { records: Array.from(byKey.values()), collisions };
}

async function upsertInBatches(supabase, records) {
  let inserted = 0;
  let errors = 0;
  for (let i = 0; i < records.length; i += UPSERT_BATCH) {
    const batch = records.slice(i, i + UPSERT_BATCH);
    const { error } = await supabase
      .from('gsc_page_timeseries')
      .upsert(batch, { onConflict: 'property_url,page_url,date', ignoreDuplicates: false });
    if (error) {
      errors += 1;
      console.warn(`${TAG} Batch ${i / UPSERT_BATCH + 1} error: ${error.message}`);
    } else {
      inserted += batch.length;
    }
  }
  return { inserted, errors };
}

async function main() {
  const propertyUrl = getArg('propertyUrl', 'https://www.alanranger.com');
  const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
  const siteUrl = normalizePropertyUrl(propertyUrl);
  const { startDate, endDate } = resolveDateRange();

  console.log(`${TAG} property=${siteUrl} range=${startDate}..${endDate}`);

  const runId = `nightly-cli-${startDate}-${endDate}-${randomUUID().slice(0, 8)}`;
  await supabase.from('gsc_backfill_runs').insert({
    run_id: runId,
    status: 'running',
    date_range_start: startDate,
    date_range_end: endDate,
    notes: 'nightly all-pages cron (CLI invocation)'
  });

  try {
    const { rows, apiCalls } = await fetchAllGscRows(siteUrl, startDate, endDate);
    console.log(`${TAG} fetched ${rows.length} rows in ${apiCalls} GSC call(s)`);
    const { records, collisions } = dedupeRecords(mapGscRowsToRecords(rows, siteUrl));
    console.log(`${TAG} deduped to ${records.length} unique records (${collisions} collisions)`);
    const { inserted, errors } = await upsertInBatches(supabase, records);
    await supabase.from('gsc_backfill_runs').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      rows_inserted: records.length,
      rows_upserted: inserted,
      api_calls: apiCalls,
      error_message: errors > 0 ? `${errors} batch errors` : null
    }).eq('run_id', runId);
    console.log(`${TAG} done: saved=${inserted} errors=${errors} runId=${runId}`);
  } catch (error) {
    await supabase.from('gsc_backfill_runs').update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message: error?.message || String(error)
    }).eq('run_id', runId);
    throw error;
  }
}

main().catch((e) => {
  console.error(`${TAG} fatal:`, e?.message || e);
  process.exit(1);
});

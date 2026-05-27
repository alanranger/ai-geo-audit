// Nightly GSC page-timeseries cron.
//
// ─── 2026-05-27 fix: all-pages scope + rolling-7-day window ─────────────────
// PRIOR STATE (broken). This file lived as `backfill-money-page-timeseries`
// and filtered every fetched GSC row to a ~233-entry "money pages" allowlist
// (audit_results.money_pages_metrics.rows[*].url + STRATEGIC_PAGES). At
// alanranger volume the money-pages subset only earned ~12-29% of property
// total clicks (per C0 SQL on 2026-05-27), so the cron could never write rows
// matching property-level GSC numbers. Combined with three other defects --
// (a) no pagination + 28-day window in a single call, (b) no `dataState:
// 'final'` (mixed fresh + final data), (c) a duplicate-key bug in upsert
// batches that was patched on 2026-05-19 (commit f2b90b3) -- it produced the
// 94-99% click gap user observed for Jan-Apr 2026. See Docs/CHANGELOG.md
// 2026-05-27 entry and Phase C0 verification log.
//
// FIXED STATE (this file).
//  * Writes ALL pages returned by GSC (no allowlist filter) -- matches the
//    Phase C0 page-daily backfill scope so cron and C0 are interchangeable.
//  * Rolling 7-day window (default `daysBack=7`, `endOffsetDays=1`) instead
//    of 28-day -- bounded API surface, fits the cron's idempotent nightly
//    model, matches C0's weekly chunk size.
//  * Paginates GSC responses with `startRow` so we don't silently lose rows
//    if the 25k rowLimit is hit on a busy day.
//  * Sends `dataState: 'final'` so we don't store unstable "fresh" rows that
//    GSC will revise downward later.
//  * Optional query params (`startDate`, `endDate`, `daysBack`) for ad-hoc
//    manual backfills covering older windows without code changes.
//  * Logs every run to `gsc_backfill_runs` with `notes='nightly all-pages
//    cron'` so future operators can see when it ran without rummaging in
//    Vercel function logs.
//
// REGRESSION CHECK / VERIFICATION APPROACH. After any change to this file,
// re-run `scripts/gsc-c0-backfill-page-daily.mjs --from <start> --to <end>
// --force` for the same window and confirm `gsc_page_timeseries` row counts
// and totals are unchanged (cron + C0 share the same upsert path + on-conflict
// key, so re-runs are idempotent and the rowset must be byte-identical).
//
// RELATED TICKET (out of scope here). `api/cron/daily-gsc-backlink.js` still
// contains a `buildMoneyPageGridRows` zero-fill pattern that overwrites good
// gsc_page_timeseries data with `clicks=0` for any (page, date) missing from
// `audit.moneyPagesTimeseries`. That cron was removed from `vercel.json` on
// 2026-04-22 (commit e081fc6), so it is dormant -- but the bug is still in
// the source and will regress data again if anyone re-enables it. A separate
// ticket has been filed to fix that helper before any re-schedule.

import { getGSCAccessToken, normalizePropertyUrl, getGscDateRange } from '../aigeo/utils.js';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const ROW_LIMIT = 25000;
const REQUEST_PAUSE_MS = 120;
const UPSERT_BATCH = 1000;

const need = (k) => {
  const v = process.env[k];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${k}`);
  return v;
};

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

function jsonResponse(res, status, body) {
  const baseMeta = body.meta || null;
  const meta = baseMeta
    ? { ...baseMeta, generatedAt: new Date().toISOString() }
    : { generatedAt: new Date().toISOString() };
  return res.status(status).json({ ...body, meta });
}

function checkAuth(req) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return { ok: true };
  const requestSecret = req.headers['x-cron-secret'] || req.query.secret;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  if (isVercelCron || requestSecret === cronSecret) return { ok: true };
  return { ok: false };
}

function resolveDateRange(req) {
  const { startDate, endDate, daysBack } = req.query || {};
  if (startDate && endDate) return { startDate, endDate };
  const parsedDays = Number.parseInt(daysBack, 10);
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
    const err = new Error(`gsc_api_error:${response.status}`);
    err.status = response.status;
    err.details = errorText;
    throw err;
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
    } else {
      inserted += batch.length;
    }
  }
  return { inserted, errors };
}

async function startRunLog(supabase, runId, startDate, endDate) {
  await supabase.from('gsc_backfill_runs').insert({
    run_id: runId,
    status: 'running',
    date_range_start: startDate,
    date_range_end: endDate,
    notes: 'nightly all-pages cron'
  });
}

async function finishRunLog(supabase, runId, status, payload) {
  await supabase.from('gsc_backfill_runs').update({
    status,
    completed_at: new Date().toISOString(),
    ...payload
  }).eq('run_id', runId);
}

async function runBackfill(req) {
  const propertyUrl = req.query.propertyUrl || process.env.CRON_PROPERTY_URL || 'https://www.alanranger.com';
  const siteUrl = normalizePropertyUrl(propertyUrl);
  const { startDate, endDate } = resolveDateRange(req);
  const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
  const runId = `nightly-${startDate}-${endDate}-${randomUUID().slice(0, 8)}`;
  await startRunLog(supabase, runId, startDate, endDate);
  try {
    const { rows, apiCalls } = await fetchAllGscRows(siteUrl, startDate, endDate);
    const { records, collisions } = dedupeRecords(mapGscRowsToRecords(rows, siteUrl));
    const { inserted, errors } = await upsertInBatches(supabase, records);
    await finishRunLog(supabase, runId, 'completed', {
      rows_inserted: records.length,
      rows_upserted: inserted,
      api_calls: apiCalls,
      error_message: errors > 0 ? `${errors} batch errors` : null
    });
    return buildOkResponse({ siteUrl, startDate, endDate, runId, records, inserted, errors, collisions, apiCalls });
  } catch (error) {
    await finishRunLog(supabase, runId, 'failed', { error_message: error?.message || String(error) });
    throw error;
  }
}

function buildOkResponse({ siteUrl, startDate, endDate, runId, records, inserted, errors, collisions, apiCalls }) {
  return {
    status: 200,
    body: {
      status: 'ok',
      message: `Saved ${inserted} all-pages timeseries rows (${errors} batch errors, ${collisions} dedupe collisions, ${apiCalls} GSC api calls)`,
      data: {
        run_id: runId,
        property_url: siteUrl,
        saved: inserted,
        unique_records: records.length,
        dedupe_collisions: collisions,
        api_calls: apiCalls,
        errors
      },
      meta: { startDate, endDate }
    }
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Cron-Secret');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'GET') {
    return jsonResponse(res, 405, { status: 'error', message: 'Method not allowed. Use GET.' });
  }
  if (!checkAuth(req).ok) {
    return jsonResponse(res, 401, { status: 'error', message: 'Unauthorized cron request' });
  }

  try {
    const { status, body } = await runBackfill(req);
    return jsonResponse(res, status, body);
  } catch (error) {
    const status = error?.status || 500;
    return jsonResponse(res, status, {
      status: 'error',
      message: error?.message || 'Unknown error',
      details: error?.details
    });
  }
}

// 6-month commercial-intent gap-check: queries NOT in tracked 98, impressions >= 300.
// Auth: same GOOGLE_* refresh token as gsc-brand-6month-monthly.mjs.
//
// Usage:
//   node scripts/gsc-commercial-gapcheck-6month.mjs
//   node scripts/gsc-commercial-gapcheck-6month.mjs --persist   (upsert gsc_page_query_daily weekly chunks)

import { config as dotenvConfig } from 'dotenv';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

dotenvConfig({ path: '.env.local' });
dotenvConfig({ path: '.env' });

import { createClient } from '@supabase/supabase-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROPERTY = 'https://www.alanranger.com';
const ROW_LIMIT = 25000;
const PAUSE_MS = 150;
const MIN_IMPRESSIONS = 300;
const PERSIST = process.argv.includes('--persist');

const COMMERCIAL_PATTERNS = [
  'course', 'workshop', 'class', 'lesson', 'tuition', 'tutor', 'hire',
  'photographer', 'near me', 'gift voucher', 'mentoring', 'mentor',
  'training', 'academy', 'experience gift',
];

const INFO_EXCLUDES = [
  'for photographers', 'tips', 'how to', 'what is', 'raw vs jpeg', 'backup',
];

function requireEnv(k) {
  const v = process.env[k];
  if (!v) throw new Error(`missing env var ${k}`);
  return v;
}

function isoDateUTC(d) {
  return d.toISOString().slice(0, 10);
}

function sixMonthWindow() {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 2);
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 5, 1));
  return { start: isoDateUTC(start), end: isoDateUTC(end) };
}

function parseCsvKeywords(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  const out = [];
  let started = false;
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (!started) {
      started = true;
      const low = t.toLowerCase();
      if (low === 'keyword' || low.startsWith('keyword,')) continue;
    }
    const m = t.match(/^"([^"]+)"|^([^,]+)/);
    const kw = (m?.[1] || m?.[2] || '').trim();
    if (kw) out.push(kw);
  }
  return out;
}

function loadTrackedKeywords() {
  const paths = [
    join(root, 'config/keyword-tracking-locations-and-class-LOCKED-v3.csv'),
    join(root, 'config/Keywords.csv'),
    'C:/Users/alan/Google Drive/Claude shared resources/07 Data & Exports/Keywords.csv',
  ];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    const keywords = parseCsvKeywords(readFileSync(p, 'utf8'));
    if (keywords.length) return { source: p, keywords };
  }
  const jPath = join(root, 'keyword-tracking-class-LOCKED.json');
  if (existsSync(jPath)) {
    const j = JSON.parse(readFileSync(jPath, 'utf8'));
    const keywords = Object.values(j.by_keyword || {}).map((r) => r.keyword).filter(Boolean);
    return { source: jPath, keywords };
  }
  throw new Error('no tracked keyword list found');
}

function isCommercialQuery(q) {
  const low = q.toLowerCase();
  if (INFO_EXCLUDES.some((x) => low.includes(x))) return false;
  return COMMERCIAL_PATTERNS.some((p) => low.includes(p));
}

function normQuery(q) {
  return String(q || '').trim().toLowerCase();
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

async function fetchQueryRows(token, start, end) {
  const all = [];
  let startRow = 0;
  for (;;) {
    const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(PROPERTY)}/searchAnalytics/query`;
    const body = {
      startDate: start,
      endDate: end,
      dimensions: ['query'],
      rowLimit: ROW_LIMIT,
      startRow,
      dataState: 'final',
    };
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`searchAnalytics ${r.status}: ${(await r.text()).slice(0, 400)}`);
    const j = await r.json();
    const batch = j.rows || [];
    for (const row of batch) {
      all.push({
        query: row.keys[0],
        clicks: Math.trunc(row.clicks ?? 0),
        impressions: Math.trunc(row.impressions ?? 0),
        position: row.position == null ? null : Number(row.position),
      });
    }
    if (batch.length < ROW_LIMIT) break;
    startRow += ROW_LIMIT;
    await new Promise((res) => setTimeout(res, PAUSE_MS));
  }
  return all;
}

async function fetchTopPageForQuery(token, query, start, end) {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(PROPERTY)}/searchAnalytics/query`;
  const body = {
    startDate: start,
    endDate: end,
    dimensions: ['page'],
    dimensionFilterGroups: [{
      filters: [{ dimension: 'query', operator: 'equals', expression: query }],
    }],
    rowLimit: 5,
    dataState: 'final',
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) return null;
  const j = await r.json();
  const top = (j.rows || [])[0];
  return top ? { page: top.keys[0], clicks: top.clicks, impressions: top.impressions } : null;
}

async function main() {
  const { start, end } = sixMonthWindow();
  const tracked = loadTrackedKeywords();
  const trackedSet = new Set(tracked.keywords.map(normQuery));
  console.error(`Tracked keywords: ${tracked.keywords.length} from ${tracked.source}`);
  console.error(`Window: ${start} .. ${end}`);

  const token = await getAccessToken();
  const rows = await fetchQueryRows(token, start, end);
  console.error(`GSC query rows fetched: ${rows.length}`);

  const candidates = [];
  for (const row of rows) {
    const qNorm = normQuery(row.query);
    if (trackedSet.has(qNorm)) continue;
    if (row.impressions < MIN_IMPRESSIONS) continue;
    if (!isCommercialQuery(row.query)) continue;
    candidates.push(row);
  }
  candidates.sort((a, b) => b.impressions - a.impressions);

  const enriched = [];
  for (const c of candidates.slice(0, 30)) {
    const page = await fetchTopPageForQuery(token, c.query, start, end);
    enriched.push({ ...c, top_page: page?.page || null, top_page_clicks: page?.clicks ?? null });
    await new Promise((res) => setTimeout(res, PAUSE_MS));
  }

  const out = {
    property: PROPERTY,
    window: { start, end, months: 6 },
    data_source: 'GSC Search Analytics API, query dimension (live fetch; not from gsc_page_query_daily)',
    tracked_keyword_count: tracked.keywords.length,
    tracked_source: tracked.source,
    min_impressions: MIN_IMPRESSIONS,
    commercial_patterns: COMMERCIAL_PATTERNS,
    info_excludes: INFO_EXCLUDES,
    gsc_query_rows_fetched: rows.length,
    candidate_count: candidates.length,
    candidates: enriched.length ? enriched : candidates.slice(0, 30),
    storage_note: PERSIST
      ? 'Not implemented in this script — use gsc-c0-backfill-page-query-daily.mjs for gsc_page_query_daily persistence.'
      : 'Report-only fetch. To persist query+page daily rows, extend gsc_page_query_daily via scripts/gsc-c0-backfill-page-query-daily.mjs (existing table; no new silo needed).',
    money_set_complete: candidates.length === 0,
  };

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});

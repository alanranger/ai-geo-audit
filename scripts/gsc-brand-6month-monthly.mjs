// One-off: 6-month monthly BRANDED vs TOTAL GSC (query dimension only).
// Auth: same GOOGLE_* refresh token as nightly GSC ingest.
// Brand filter: matches lib/audit/brandOverlay.js BRAND_TERMS.
//
// Usage: node scripts/gsc-brand-6month-monthly.mjs

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });
dotenvConfig({ path: '.env' });

import { createClient } from '@supabase/supabase-js';

const PROPERTY = 'https://www.alanranger.com';
const PERSIST = process.argv.includes('--persist');
const ROW_LIMIT = 25000;
const PAUSE_MS = 150;
const BRAND_TERMS = ['alan ranger', 'alanranger', 'alan ranger photography'];

function isBrandQuery(query) {
  if (!query || typeof query !== 'string') return false;
  const q = query.toLowerCase();
  return BRAND_TERMS.some((term) => q.includes(term));
}

function requireEnv(k) {
  const v = process.env[k];
  if (!v) throw new Error(`missing env var ${k}`);
  return v;
}

function isoDateUTC(d) {
  return d.toISOString().slice(0, 10);
}

function monthKey(iso) {
  return iso.slice(0, 7);
}

function lastSixMonthWindows() {
  // End = yesterday minus 2 days (GSC lag). Six calendar months inclusive.
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 2);
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 5, 1));
  const windows = [];
  for (let i = 0; i < 6; i++) {
    const mStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const mEndExclusive = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i + 1, 1));
    const mEnd = new Date(mEndExclusive.getTime() - 86400000);
    const endClip = mEnd > end ? end : mEnd;
    if (mStart > end) break;
    windows.push({
      month: monthKey(isoDateUTC(mStart)),
      start: isoDateUTC(mStart),
      end: isoDateUTC(endClip),
    });
  }
  return windows;
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
    if (!r.ok) {
      const errText = await r.text();
      throw new Error(`searchAnalytics ${r.status}: ${errText.slice(0, 400)}`);
    }
    const j = await r.json();
    const batch = j.rows || [];
    for (const row of batch) {
      all.push({
        query: row.keys[0],
        clicks: Math.trunc(row.clicks ?? 0),
        impressions: Math.trunc(row.impressions ?? 0),
        ctr: Number(row.ctr) || 0,
        position: row.position == null ? null : Number(row.position),
      });
    }
    if (batch.length < ROW_LIMIT) break;
    startRow += ROW_LIMIT;
    await new Promise((res) => setTimeout(res, PAUSE_MS));
  }
  return all;
}

function summariseMonth(rows) {
  let totalImp = 0;
  let totalClicks = 0;
  let brandImp = 0;
  let brandClicks = 0;
  let brandPosWeighted = 0;
  const brandQueries = [];

  for (const row of rows) {
    totalImp += row.impressions;
    totalClicks += row.clicks;
    if (!isBrandQuery(row.query)) continue;
    brandImp += row.impressions;
    brandClicks += row.clicks;
    if (row.position != null) brandPosWeighted += row.position * row.impressions;
    brandQueries.push(row);
  }

  brandQueries.sort((a, b) => b.impressions - a.impressions);

  return {
    total_impressions: totalImp,
    total_clicks: totalClicks,
    brand_impressions: brandImp,
    brand_clicks: brandClicks,
    brand_ctr: brandImp > 0 ? brandClicks / brandImp : 0,
    brand_avg_position: brandImp > 0 ? brandPosWeighted / brandImp : null,
    brand_share_of_impressions: totalImp > 0 ? brandImp / totalImp : 0,
    distinct_brand_queries: brandQueries.length,
    top_brand_queries: brandQueries.slice(0, 15).map((q) => ({
      query: q.query,
      impressions: q.impressions,
      clicks: q.clicks,
      ctr: q.impressions > 0 ? q.clicks / q.impressions : 0,
      position: q.position,
    })),
    query_rows_returned: rows.length,
  };
}

async function main() {
  const windows = lastSixMonthWindows();
  console.error('Windows:', JSON.stringify(windows, null, 2));
  const token = await getAccessToken();
  const months = [];

  for (const w of windows) {
    console.error(`Fetching ${w.month} ${w.start}..${w.end}`);
    const rows = await fetchQueryRows(token, w.start, w.end);
    const stats = summariseMonth(rows);
    months.push({ ...w, ...stats });
    await new Promise((res) => setTimeout(res, PAUSE_MS));
  }

  if (PERSIST) {
    const supabase = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'));
    const rows = months.map((m) => ({
      property_url: PROPERTY,
      month: `${m.month}-01`,
      brand_impressions: m.brand_impressions,
      brand_clicks: m.brand_clicks,
      brand_ctr: m.brand_ctr,
      brand_avg_position: m.brand_avg_position,
      total_query_impressions: m.total_impressions,
      brand_share: m.brand_share_of_impressions,
      distinct_brand_queries: m.distinct_brand_queries,
      top_brand_queries: m.top_brand_queries,
      fetched_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from('gsc_brand_query_monthly').upsert(rows, {
      onConflict: 'property_url,month',
    });
    if (error) throw new Error(`upsert gsc_brand_query_monthly: ${error.message}`);
    console.error(`Persisted ${rows.length} rows to gsc_brand_query_monthly`);
  }

  const out = {
    property: PROPERTY,
    brand_terms: BRAND_TERMS,
    persisted: PERSIST,
    note: 'Query-dimension Search Analytics (privacy threshold applies). Brand filter = substring match on BRAND_TERMS.',
    months,
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});

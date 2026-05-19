/**
 * Backfill: populate gsc_page_timeseries for money pages (last 28 days).
 *
 * Usage:
 *   node scripts/backfill-money-page-timeseries.js --propertyUrl "https://www.alanranger.com"
 *
 * Requires env:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 * - GOOGLE_CLIENT_ID
 * - GOOGLE_CLIENT_SECRET
 * - GOOGLE_REFRESH_TOKEN
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { getGSCAccessToken, normalizePropertyUrl, getGscDateRange } from '../api/aigeo/utils.js';

const TAG = '[Backfill Money Page Timeseries]';

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

// Keep in sync with api/cron/backfill-money-page-timeseries.js — strategic pages
// that must be synced even when the audit's "money pages" classifier excludes
// them (Academy funnel entry points).
// See Docs/ACADEMY_FUNNEL_INVESTIGATION_2026-05.md.
const STRATEGIC_PAGES = [
  'academy/login',
  'academy/trial-expired',
  'academy/upgrade',
  'trial-expired',
  'free-online-photography-course',
  'free-photography-course',
  'free-online-photography-academy',
  'online-photography-course'
];

function parseMoneyPagesMetrics(rawValue) {
  if (typeof rawValue === 'string') {
    try { return JSON.parse(rawValue); } catch { return null; }
  }
  return rawValue;
}

function buildPageSet(auditMoneyPages, strategicPages) {
  const combinedSet = new Set();
  for (const url of auditMoneyPages) {
    const norm = normalizeUrl(url);
    if (norm) combinedSet.add(norm);
  }
  for (const slug of strategicPages) {
    const norm = normalizeUrl(slug);
    if (norm) combinedSet.add(norm);
  }
  return combinedSet;
}

async function fetchLatestMoneyPages(supabase, siteUrl) {
  const { data, error } = await supabase
    .from('audit_results')
    .select('audit_date, money_pages_metrics')
    .eq('property_url', siteUrl)
    .order('audit_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) {
    throw new Error(`latest_audit_missing:${error?.message || 'no_audit'}`);
  }
  const metrics = parseMoneyPagesMetrics(data.money_pages_metrics);
  return Array.isArray(metrics?.rows) ? metrics.rows.map((row) => row.url).filter(Boolean) : [];
}

async function fetchGscRows(siteUrl, startDate, endDate) {
  const accessToken = await getGSCAccessToken();
  const searchConsoleUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const response = await fetch(searchConsoleUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ startDate, endDate, dimensions: ['date', 'page'], rowLimit: 25000 })
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`gsc_api_error:${response.status}:${errorText.slice(0, 400)}`);
  }
  const data = await response.json().catch(() => ({}));
  return Array.isArray(data.rows) ? data.rows : [];
}

function mapGscRowsToRecords(rows, siteUrl, pageSet) {
  const result = [];
  for (const row of rows) {
    const date = row.keys?.[0] || null;
    const page = row.keys?.[1] || null;
    if (!date || !page) continue;
    const pageUrl = normalizeUrl(page);
    if (!pageSet.has(pageUrl)) continue;
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

async function upsertInBatches(supabase, records, batchSize = 1000) {
  let inserted = 0;
  let errors = 0;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const { error } = await supabase
      .from('gsc_page_timeseries')
      .upsert(batch, { onConflict: 'property_url,page_url,date', ignoreDuplicates: false });
    if (error) {
      errors += 1;
      console.warn(`${TAG} Batch ${i / batchSize + 1} error: ${error.message}`);
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
  const { startDate, endDate } = getGscDateRange({ daysBack: 28, endOffsetDays: 1 });

  console.log(`${TAG} property=${siteUrl} range=${startDate}..${endDate}`);

  const auditMoneyPages = await fetchLatestMoneyPages(supabase, siteUrl);
  const pageSet = buildPageSet(auditMoneyPages, STRATEGIC_PAGES);

  if (pageSet.size === 0) {
    console.log(`${TAG} No money pages or strategic pages configured.`);
    return;
  }
  console.log(`${TAG} Pages: audit=${auditMoneyPages.length} strategic=${STRATEGIC_PAGES.length} combined=${pageSet.size}`);

  const rows = await fetchGscRows(siteUrl, startDate, endDate);
  const rawRecords = mapGscRowsToRecords(rows, siteUrl, pageSet);
  const { records, collisions } = dedupeRecords(rawRecords);

  if (collisions > 0) {
    console.log(`${TAG} Deduped ${collisions} collision(s) before upsert`);
  }
  if (records.length === 0) {
    console.log(`${TAG} No matching rows to save.`);
    return;
  }

  console.log(`${TAG} Saving ${records.length} rows...`);
  const { inserted, errors } = await upsertInBatches(supabase, records);
  console.log(`${TAG} done: saved=${inserted} errors=${errors}`);
}

main().catch((e) => {
  console.error(`${TAG} fatal:`, e?.message || e);
  process.exit(1);
});

/**
 * One-off backfill: create monthly portfolio_segment_metrics_28d rows for the "academy" segment
 * (single URL: /free-online-photography-course) so the Portfolio Monthly KPI Tracker has history.
 *
 * Writes rows with run_id=YYYY-MM (one per month), segment=academy, scope=all_pages.
 *
 * Usage:
 *   node scripts/backfill-portfolio-academy-monthly.js
 *   SITE_URL=https://www.alanranger.com FROM_MONTH=2024-12 TO_MONTH=2025-12 node scripts/backfill-portfolio-academy-monthly.js
 *
 * Requires env:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env (.env.local / .env)');
  process.exit(1);
}

const SITE_URL = process.env.SITE_URL || 'https://www.alanranger.com';
const FROM_MONTH = process.env.FROM_MONTH || '2024-12';
const TO_MONTH = process.env.TO_MONTH || '2025-12';
const ACADEMY_PATH = '/free-online-photography-course';

const supabase = createClient(supabaseUrl, supabaseKey);

function parseMonthKey(monthKey) {
  const m = String(monthKey || '').trim().match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (!y || !mm || mm < 1 || mm > 12) return null;
  return { y, m: mm };
}

function monthKey(y, m) {
  return `${String(y)}-${String(m).padStart(2, '0')}`;
}

function dateOnlyUTC(d) {
  return d.toISOString().slice(0, 10);
}

function monthStartEndUTC(y, m) {
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0)); // last day of month
  return { start: dateOnlyUTC(start), end: dateOnlyUTC(end) };
}

function monthKeysBetween(fromKey, toKey) {
  const a = parseMonthKey(fromKey);
  const b = parseMonthKey(toKey);
  if (!a || !b) return [];
  const out = [];
  let y = a.y;
  let m = a.m;
  while (y < b.y || (y === b.y && m <= b.m)) {
    out.push(monthKey(y, m));
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

async function fetchBestSnapshotForMonth(siteUrl, monthKeyStr) {
  const p = parseMonthKey(monthKeyStr);
  if (!p) return null;
  const { start, end } = monthStartEndUTC(p.y, p.m);

  const { data, error } = await supabase
    .from('gsc_page_metrics_28d')
    .select('site_url, run_id, date_start, date_end, page_url, clicks_28d, impressions_28d, position_28d')
    .eq('site_url', siteUrl)
    .ilike('page_url', `%${ACADEMY_PATH}%`)
    .gte('date_end', start)
    .lte('date_end', end)
    .order('date_end', { ascending: false })
    .limit(1);

  if (error) throw error;
  return (data && data[0]) ? data[0] : null;
}

function toNumberOrZero(v) {
  const n = typeof v === 'string' ? parseFloat(v) : (typeof v === 'number' ? v : 0);
  return isFinite(n) ? n : 0;
}

function toNumberOrNull(v) {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'string' ? parseFloat(v) : (typeof v === 'number' ? v : NaN);
  return isFinite(n) ? n : null;
}

async function upsertAcademyMonth(siteUrl, monthKeyStr, snap) {
  const clicks = toNumberOrZero(snap?.clicks_28d);
  const impressions = toNumberOrZero(snap?.impressions_28d);
  const ctr = impressions > 0 ? (clicks / impressions) : 0;
  const position = toNumberOrNull(snap?.position_28d);

  const row = {
    run_id: monthKeyStr, // monthly snapshot id (YYYY-MM)
    site_url: siteUrl,
    segment: 'academy',
    scope: 'all_pages',
    date_start: snap?.date_start || null,
    date_end: snap?.date_end || null,
    pages_count: 1,
    clicks_28d: clicks,
    impressions_28d: impressions,
    ctr_28d: ctr,
    position_28d: position,
    ai_citations_28d: 0,
    ai_overview_present_count: 0
  };

  const { error } = await supabase
    .from('portfolio_segment_metrics_28d')
    .upsert([row], { onConflict: 'run_id,site_url,segment,scope', ignoreDuplicates: false });

  if (error) throw error;
}

async function main() {
  console.log(`✅ Supabase URL: ${String(supabaseUrl).slice(0, 32)}...`);
  console.log(`📌 Site: ${SITE_URL}`);
  console.log(`📅 Months: ${FROM_MONTH} → ${TO_MONTH}`);
  console.log(`🎯 Academy path: ${ACADEMY_PATH}`);

  const months = monthKeysBetween(FROM_MONTH, TO_MONTH);
  if (months.length === 0) {
    console.error('❌ Invalid FROM_MONTH / TO_MONTH. Expected YYYY-MM.');
    process.exit(1);
  }

  let upserted = 0;
  let missing = 0;

  for (const m of months) {
    process.stdout.write(`\n🔎 ${m}: `);
    const snap = await fetchBestSnapshotForMonth(SITE_URL, m);
    if (!snap) {
      console.log('no gsc_page_metrics_28d snapshot found (skipping)');
      missing += 1;
      continue;
    }
    await upsertAcademyMonth(SITE_URL, m, snap);
    console.log(`upserted (date_end=${String(snap.date_end).slice(0, 10)}, clicks=${toNumberOrZero(snap.clicks_28d)}, impr=${toNumberOrZero(snap.impressions_28d)})`);
    upserted += 1;
  }

  console.log('\n—');
  console.log(`✅ Done. Upserted: ${upserted}, missing months: ${missing}`);
  console.log('💡 Next: load the Portfolio panel and select Segment → Academy to see the new row.');
}

main().catch((err) => {
  console.error('\n❌ Backfill failed:', err?.message || err);
  process.exit(1);
});



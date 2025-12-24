/**
 * One-off backfill: create monthly portfolio_segment_metrics_28d rows for the "other" segment
 * (everything NOT money pages, NOT blog posts, and NOT the Academy signup page).
 *
 * Writes rows with run_id=YYYY-MM (one per month), segment=other, scope=all_pages.
 *
 * Usage:
 *   node scripts/backfill-portfolio-other-monthly.js
 *   SITE_URL=https://www.alanranger.com FROM_MONTH=2024-12 TO_MONTH=2025-12 node scripts/backfill-portfolio-other-monthly.js
 *
 * Requires env:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { classifyPageSegment as classifySitePageSegment, PageSegment } from '../api/aigeo/pageSegment.js';

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

function normalizeUrl(u) {
  if (!u) return '';
  let s = String(u).toLowerCase();
  s = s.split('?')[0];
  s = s.split('#')[0];
  s = s.replace(/\/$/, '');
  return s;
}

function isBlogUrl(u) {
  return normalizeUrl(u).includes('/blog-on-photography/');
}

function isAcademyUrl(u) {
  return normalizeUrl(u).includes(ACADEMY_PATH);
}

function classifyMoneySubSegment(pageUrl) {
  if (!pageUrl || typeof pageUrl !== 'string') return null;
  const main = classifySitePageSegment(pageUrl);
  if (main !== PageSegment.MONEY) return null;
  const urlLower = normalizeUrl(pageUrl);
  if (urlLower.includes('/beginners-photography-lessons') || urlLower.includes('/photographic-workshops-near-me')) {
    return 'event';
  }
  if (urlLower.includes('/photo-workshops-uk') || urlLower.includes('/photography-services-near-me')) {
    return 'product';
  }
  return 'landing';
}

async function fetchBestRunForMonth(siteUrl, monthKeyStr) {
  const p = parseMonthKey(monthKeyStr);
  if (!p) return null;
  const { start, end } = monthStartEndUTC(p.y, p.m);

  // Prefer a snapshot that ends at the month end; otherwise take latest in the month (for partial current month)
  const { data: exact, error: exactErr } = await supabase
    .from('gsc_page_metrics_28d')
    .select('run_id, date_start, date_end')
    .eq('site_url', siteUrl)
    .eq('date_end', end)
    .order('run_id', { ascending: false })
    .limit(1);
  if (exactErr) throw exactErr;
  if (exact && exact[0]) return exact[0];

  const { data: latest, error: latestErr } = await supabase
    .from('gsc_page_metrics_28d')
    .select('run_id, date_start, date_end')
    .eq('site_url', siteUrl)
    .gte('date_end', start)
    .lte('date_end', end)
    .order('date_end', { ascending: false })
    .limit(1);
  if (latestErr) throw latestErr;
  return (latest && latest[0]) ? latest[0] : null;
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

async function fetchPagesForRun(siteUrl, runId) {
  const { data, error } = await supabase
    .from('gsc_page_metrics_28d')
    .select('page_url, clicks_28d, impressions_28d, position_28d')
    .eq('site_url', siteUrl)
    .eq('run_id', runId);
  if (error) throw error;
  return data || [];
}

function aggregateOther(pages) {
  let clicks = 0;
  let impressions = 0;
  let posWeight = 0;
  let posImpr = 0;
  let pagesCount = 0;

  pages.forEach(p => {
    const url = p.page_url;
    if (!url) return;
    if (isBlogUrl(url)) return;
    if (isAcademyUrl(url)) return;
    const moneySub = classifyMoneySubSegment(url);
    if (moneySub) return;

    const c = toNumberOrZero(p.clicks_28d);
    const i = toNumberOrZero(p.impressions_28d);
    clicks += c;
    impressions += i;
    pagesCount += 1;

    const pos = toNumberOrNull(p.position_28d);
    if (pos !== null && i > 0) {
      posWeight += pos * i;
      posImpr += i;
    }
  });

  const ctr = impressions > 0 ? (clicks / impressions) : 0;
  const position = posImpr > 0 ? (posWeight / posImpr) : null;
  return { pagesCount, clicks, impressions, ctr, position };
}

async function upsertOtherMonth(siteUrl, monthKeyStr, runMeta, agg) {
  const row = {
    run_id: monthKeyStr, // monthly snapshot id (YYYY-MM)
    site_url: siteUrl,
    segment: 'other',
    scope: 'all_pages',
    date_start: runMeta?.date_start || null,
    date_end: runMeta?.date_end || null,
    pages_count: agg.pagesCount,
    clicks_28d: agg.clicks,
    impressions_28d: agg.impressions,
    ctr_28d: agg.ctr,
    position_28d: agg.position,
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
  console.log(`🧩 Segment: other (non-money, non-blog, non-academy)`);

  const months = monthKeysBetween(FROM_MONTH, TO_MONTH);
  if (months.length === 0) {
    console.error('❌ Invalid FROM_MONTH / TO_MONTH. Expected YYYY-MM.');
    process.exit(1);
  }

  let upserted = 0;
  let missing = 0;

  for (const m of months) {
    process.stdout.write(`\n🔎 ${m}: `);
    const run = await fetchBestRunForMonth(SITE_URL, m);
    if (!run || !run.run_id) {
      console.log('no gsc_page_metrics_28d snapshot found (skipping)');
      missing += 1;
      continue;
    }
    const pages = await fetchPagesForRun(SITE_URL, run.run_id);
    const agg = aggregateOther(pages);
    await upsertOtherMonth(SITE_URL, m, run, agg);
    console.log(`upserted (source_run=${run.run_id}, date_end=${String(run.date_end).slice(0, 10)}, pages=${agg.pagesCount}, impr=${Math.round(agg.impressions)})`);
    upserted += 1;
  }

  console.log('\n—');
  console.log(`✅ Done. Upserted: ${upserted}, missing months: ${missing}`);
  console.log('💡 Next: refresh Portfolio and pick Segment → Other (non-money).');
}

main().catch((err) => {
  console.error('\n❌ Backfill failed:', err?.message || err);
  process.exit(1);
});



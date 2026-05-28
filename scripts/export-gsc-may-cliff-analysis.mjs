// Read-only GSC export for May 2026 cliff analysis. No UI changes.
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { EXEC_SUMMARY_TIER_KEYS } from '../lib/revenue-truth-exec-filters.mjs';
import handlerDiag from '../api/aigeo/revenue-funnel-diagnosis.js';

const envFile = path.resolve('.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

const PROPERTY = 'https://www.alanranger.com';
const SLUGS = [
  'landscape-photography-workshops',
  'one-day-landscape-photography-workshops',
  'private-photography-lessons',
  'photography-lessons-online-121',
  'beginners-photography-classes',
  'photography-courses-coventry',
  'photo-editing-course-coventry',
  'professional-commercial-photographer-coventry',
  'hire-a-professional-photographer-in-coventry',
  'professional-photographer-near-me',
  'corporate-photography-training',
  'rps-courses-mentoring-distinctions',
  'photography-mentoring-online-assignments'
];

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function normSlug(s) {
  return String(s || '').replace(/^\/+/, '').replace(/\/+$/, '').toLowerCase();
}

function slugPath(slug) {
  return '/' + slug;
}

async function fetchRows(from, to, slugs) {
  const pageSize = 1000;
  let fromRow = 0;
  const out = [];
  while (true) {
    const { data, error } = await sb.from('gsc_page_timeseries')
      .select('date,page_url,impressions,clicks,ctr,position')
      .eq('property_url', PROPERTY)
      .gte('date', from)
      .lte('date', to)
      .in('page_url', slugs)
      .order('date', { ascending: true })
      .range(fromRow, fromRow + pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;
    out.push(...data);
    if (data.length < pageSize) break;
    fromRow += pageSize;
  }
  return out;
}

function monthStart(iso) {
  return iso.slice(0, 7) + '-01';
}

function aggregateMonthly(rows) {
  const map = new Map();
  for (const r of rows) {
    const ms = monthStart(r.date);
    const k = `${ms}|${r.page_url}`;
    const cur = map.get(k) || { month_start: ms, slug: slugPath(r.page_url), impressions: 0, clicks: 0, posImp: 0 };
    const imp = Number(r.impressions) || 0;
    const clk = Number(r.clicks) || 0;
    cur.impressions += imp;
    cur.clicks += clk;
    if (r.position != null && imp > 0) cur.posImp += Number(r.position) * imp;
    map.set(k, cur);
  }
  return [...map.values()].map((r) => ({
    month_start: r.month_start,
    slug: r.slug,
    impressions: r.impressions,
    clicks: r.clicks,
    ctr: r.impressions > 0 ? round4((r.clicks / r.impressions) * 100) : 0,
    avg_position: r.impressions > 0 && r.posImp > 0 ? round2(r.posImp / r.impressions) : null
  })).sort((a, b) => a.month_start.localeCompare(b.month_start) || a.slug.localeCompare(b.slug));
}

function round2(n) { return Number((Number(n) || 0).toFixed(2)); }
function round4(n) { return Number((Number(n) || 0).toFixed(4)); }

function toCsv(rows, cols) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

function toMdTable(rows, cols) {
  const head = '| ' + cols.join(' | ') + ' |';
  const sep = '| ' + cols.map(() => '---').join(' | ') + ' |';
  const body = rows.map((r) => '| ' + cols.map((c) => (r[c] == null ? '' : r[c])).join(' | ') + ' |').join('\n');
  return [head, sep, body].join('\n');
}

async function recurringTierSlugs() {
  const res = { statusCode: 200, body: null };
  await handlerDiag({ method: 'GET', query: { propertyUrl: PROPERTY, windowMonths: '12' } }, {
    setHeader() {},
    status(c) { res.statusCode = c; return this; },
    json(b) { res.body = b; return this; }
  });
  const slugs = new Set();
  for (const d of res.body?.diagnostics || []) {
    if (!EXEC_SUMMARY_TIER_KEYS.has(d.tier_key)) continue;
    slugs.add(normSlug(d.page_slug));
  }
  return [...slugs];
}

async function fetchAllDaily(from, to, pageSlugs) {
  const chunk = 50;
  const pageSize = 1000;
  const out = [];
  for (let i = 0; i < pageSlugs.length; i += chunk) {
    const part = pageSlugs.slice(i, i + chunk);
    let fromRow = 0;
    while (true) {
      const { data, error } = await sb.from('gsc_page_timeseries')
        .select('date,page_url,impressions,clicks')
        .eq('property_url', PROPERTY)
        .gte('date', from)
        .lte('date', to)
        .in('page_url', part)
        .order('date', { ascending: true })
        .range(fromRow, fromRow + pageSize - 1);
      if (error) throw error;
      if (!data?.length) break;
      out.push(...data);
      if (data.length < pageSize) break;
      fromRow += pageSize;
    }
  }
  return out;
}

function request3Rows(allRows) {
  const bySlugMonth = new Map();
  for (const r of allRows) {
    const slug = normSlug(r.page_url);
    const ym = r.date.slice(0, 7);
    const k = `${slug}|${ym}`;
    const cur = bySlugMonth.get(k) || { impressions: 0, clicks: 0 };
    cur.impressions += Number(r.impressions) || 0;
    cur.clicks += Number(r.clicks) || 0;
    bySlugMonth.set(k, cur);
  }
  const slugSet = new Set([...bySlugMonth.keys()].map((k) => k.split('|')[0]));
  const rows = [];
  for (const slug of slugSet) {
    let janAprSum = 0;
    let janAprMonths = 0;
    for (const m of ['2026-01', '2026-02', '2026-03', '2026-04']) {
      const cell = bySlugMonth.get(`${slug}|${m}`);
      if (cell) { janAprSum += cell.impressions; janAprMonths += 1; }
    }
    const may = bySlugMonth.get(`${slug}|2026-05`)?.impressions || 0;
    const janAprAvg = janAprMonths > 0 ? janAprSum / janAprMonths : 0;
    if (janAprAvg <= 0 && may <= 0) continue;
    const deltaPct = janAprAvg > 0 ? round2(((may - janAprAvg) / janAprAvg) * 100) : null;
    rows.push({
      slug: slugPath(slug),
      jan_apr_avg_imp_per_month: round2(janAprAvg),
      may_2026_imp_so_far: may,
      delta_pct: deltaPct
    });
  }
  return rows
    .filter((r) => r.delta_pct != null && r.delta_pct < 0)
    .sort((a, b) => a.delta_pct - b.delta_pct)
    .slice(0, 10);
}

const normSlugs = SLUGS.map(normSlug);
const dailyAll = await fetchRows('2025-01-01', '2026-05-31', normSlugs);
const monthly = aggregateMonthly(dailyAll.filter((r) => r.date >= '2025-01-01'));
const mayDaily = dailyAll
  .filter((r) => r.date.startsWith('2026-05'))
  .map((r) => ({ date: r.date, slug: slugPath(r.page_url), impressions: Number(r.impressions) || 0, clicks: Number(r.clicks) || 0 }))
  .sort((a, b) => a.date.localeCompare(b.date) || a.slug.localeCompare(b.slug));

const recurringSlugs = await recurringTierSlugs();
const r3Daily = await fetchAllDaily('2026-01-01', '2026-05-31', recurringSlugs);
const req3 = request3Rows(r3Daily);

const cols1 = ['month_start', 'slug', 'impressions', 'clicks', 'ctr', 'avg_position'];
const cols2 = ['date', 'slug', 'impressions', 'clicks'];
const cols3 = ['slug', 'jan_apr_avg_imp_per_month', 'may_2026_imp_so_far', 'delta_pct'];

const out = [
  '# GSC Export — May 2026 Cliff Analysis',
  `Generated: ${new Date().toISOString()}`,
  `Source: public.gsc_page_timeseries (${PROPERTY})`,
  '',
  '## REQUEST 1 — Monthly GSC totals per URL (Jan 2025 → May 2026)',
  '',
  toMdTable(monthly, cols1),
  '',
  '```csv',
  toCsv(monthly, cols1),
  '```',
  '',
  '## REQUEST 2 — Daily GSC May 2026',
  '',
  toMdTable(mayDaily, cols2),
  '',
  '```csv',
  toCsv(mayDaily, cols2),
  '```',
  '',
  '## REQUEST 3 — Top 10 worst recurring-tier pages (Jan–Apr 2026 avg imp vs May 2026)',
  '',
  toMdTable(req3, cols3),
  '',
  '```csv',
  toCsv(req3, cols3),
  '```'
].join('\n');

const outPath = path.resolve('Docs/GSC-EXPORT-MAY-2026-CLIFF.md');
fs.writeFileSync(outPath, out);
console.log('Wrote', outPath);
console.log('R1 rows:', monthly.length, 'R2 rows:', mayDaily.length, 'R3 rows:', req3.length);

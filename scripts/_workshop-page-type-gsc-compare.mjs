// Analysis-only: workshop page-type GSC comparison. NOT for commit.
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });
dotenvConfig({ path: '.env' });

import { createClient } from '@supabase/supabase-js';

const PROPERTY = 'https://www.alanranger.com';
const GSC_FROM = '2025-01-13';
const GSC_TO = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);

const EXAMPLES = [
  {
    id: 'E1',
    label: 'EXAMPLE 1 — Hartland Quay (residential)',
    pages: [
      { role: 'event', path: '/photographic-workshops-near-me/hartland-quay-photography-devon-seascapes' },
      { role: 'product', path: '/photo-workshops-uk/landscape-photography-devon-hartland-quay' },
      { role: 'type-hub', path: '/photography-workshops-near-me' },
      { role: 'all-hub', path: '/photography-workshops' }
    ]
  },
  {
    id: 'E2',
    label: 'EXAMPLE 2 — Bluebells (half-day)',
    pages: [
      { role: 'event', path: '/photographic-workshops-near-me/bluebell-photography-photo-workshop-warwickshire-21' },
      { role: 'product', path: '/photo-workshops-uk/bluebell-woodlands-photography-workshops' },
      { role: 'type-hub', path: '/landscape-photography-workshops' },
      { role: 'all-hub', path: '/photography-workshops' }
    ]
  },
  {
    id: 'E3',
    label: 'EXAMPLE 3 — Peak District (one-day)',
    pages: [
      { role: 'event', path: '/photographic-workshops-near-me/peak-district-photography-workshops-autumn' },
      { role: 'product', path: '/photo-workshops-uk/landscape-peak-district-photography-workshops-derbyshire' },
      { role: 'type-hub', path: '/one-day-landscape-photography-workshops' },
      { role: 'all-hub', path: '/photography-workshops' }
    ]
  }
];

const MONTHLY_SQL = `
WITH page_defs AS (
  SELECT * FROM (VALUES
    ('E1', 'event', '/photographic-workshops-near-me/hartland-quay-photography-devon-seascapes'),
    ('E1', 'product', '/photo-workshops-uk/landscape-photography-devon-hartland-quay'),
    ('E1', 'type-hub', '/photography-workshops-near-me'),
    ('E1', 'all-hub', '/photography-workshops'),
    ('E2', 'event', '/photographic-workshops-near-me/bluebell-photography-photo-workshop-warwickshire-21'),
    ('E2', 'product', '/photo-workshops-uk/bluebell-woodlands-photography-workshops'),
    ('E2', 'type-hub', '/landscape-photography-workshops'),
    ('E2', 'all-hub', '/photography-workshops'),
    ('E3', 'event', '/photographic-workshops-near-me/peak-district-photography-workshops-autumn'),
    ('E3', 'product', '/photo-workshops-uk/landscape-peak-district-photography-workshops-derbyshire'),
    ('E3', 'type-hub', '/one-day-landscape-photography-workshops'),
    ('E3', 'all-hub', '/photography-workshops')
  ) AS t(example_id, page_role, path_raw)
),
pages AS (
  SELECT example_id, page_role, path_raw,
         normalize_gsc_page_slug(path_raw) AS page_slug
  FROM page_defs
),
months AS (
  SELECT y::int AS year, m::int AS month
  FROM generate_series(2025, 2026) y
  CROSS JOIN generate_series(1, 12) m
  WHERE make_date(y, m, 1) <= date_trunc('month', CURRENT_DATE)::date
    AND make_date(y, m, 1) >= '2025-01-01'::date
),
monthly_gsc AS (
  SELECT page_url,
         EXTRACT(YEAR FROM date)::int AS year,
         EXTRACT(MONTH FROM date)::int AS month,
         SUM(impressions)::bigint AS impressions,
         SUM(clicks)::bigint AS clicks,
         CASE WHEN SUM(impressions) > 0
           THEN ROUND(100.0 * SUM(clicks)::numeric / SUM(impressions), 2) ELSE 0 END AS ctr_pct,
         CASE WHEN SUM(impressions) > 0
           THEN ROUND(SUM(position * impressions)::numeric / SUM(impressions), 2) ELSE NULL END AS avg_position
  FROM gsc_page_timeseries
  WHERE property_url = 'https://www.alanranger.com' AND date >= '2025-01-13'
  GROUP BY page_url, EXTRACT(YEAR FROM date), EXTRACT(MONTH FROM date)
)
SELECT p.example_id, p.page_role, p.path_raw, p.page_slug,
       mo.year, mo.month,
       COALESCE(g.impressions, 0) AS impressions,
       COALESCE(g.clicks, 0) AS clicks,
       COALESCE(g.ctr_pct, 0) AS ctr_pct,
       g.avg_position
FROM pages p
CROSS JOIN months mo
LEFT JOIN monthly_gsc g ON g.page_url = p.page_slug AND g.year = mo.year AND g.month = mo.month
ORDER BY p.example_id, CASE p.page_role WHEN 'event' THEN 1 WHEN 'product' THEN 2 WHEN 'type-hub' THEN 3 ELSE 4 END,
         mo.year, mo.month;
`;

const SUMMARY_SQL = `
WITH page_defs AS (
  SELECT * FROM (VALUES
    ('E1', 'event', '/photographic-workshops-near-me/hartland-quay-photography-devon-seascapes'),
    ('E1', 'product', '/photo-workshops-uk/landscape-photography-devon-hartland-quay'),
    ('E1', 'type-hub', '/photography-workshops-near-me'),
    ('E1', 'all-hub', '/photography-workshops'),
    ('E2', 'event', '/photographic-workshops-near-me/bluebell-photography-photo-workshop-warwickshire-21'),
    ('E2', 'product', '/photo-workshops-uk/bluebell-woodlands-photography-workshops'),
    ('E2', 'type-hub', '/landscape-photography-workshops'),
    ('E2', 'all-hub', '/photography-workshops'),
    ('E3', 'event', '/photographic-workshops-near-me/peak-district-photography-workshops-autumn'),
    ('E3', 'product', '/photo-workshops-uk/landscape-peak-district-photography-workshops-derbyshire'),
    ('E3', 'type-hub', '/one-day-landscape-photography-workshops'),
    ('E3', 'all-hub', '/photography-workshops')
  ) AS t(example_id, page_role, path_raw)
),
pages AS (
  SELECT example_id, page_role, path_raw,
         normalize_gsc_page_slug(path_raw) AS page_slug
  FROM page_defs
),
monthly_gsc AS (
  SELECT page_url,
         EXTRACT(YEAR FROM date)::int AS year,
         EXTRACT(MONTH FROM date)::int AS month,
         SUM(impressions)::bigint AS impressions,
         SUM(clicks)::bigint AS clicks
  FROM gsc_page_timeseries
  WHERE property_url = 'https://www.alanranger.com' AND date >= '2025-01-13'
  GROUP BY page_url, EXTRACT(YEAR FROM date), EXTRACT(MONTH FROM date)
),
agg AS (
  SELECT p.example_id, p.page_role, p.path_raw, p.page_slug,
         COALESCE(SUM(g.impressions), 0) AS total_impressions,
         COALESCE(SUM(g.clicks), 0) AS total_clicks,
         COUNT(*) FILTER (WHERE g.impressions > 0) AS months_with_data
  FROM pages p
  LEFT JOIN monthly_gsc g ON g.page_url = p.page_slug
  GROUP BY p.example_id, p.page_role, p.path_raw, p.page_slug
)
SELECT example_id, page_role, path_raw, page_slug,
       total_impressions, total_clicks,
       CASE WHEN total_impressions > 0
         THEN ROUND(100.0 * total_clicks::numeric / total_impressions, 2) ELSE 0 END AS overall_ctr_pct,
       (SELECT ROUND(SUM(g2.position * g2.impressions)::numeric / NULLIF(SUM(g2.impressions), 0), 2)
        FROM gsc_page_timeseries g2
        WHERE g2.page_url = agg.page_slug
          AND g2.property_url = 'https://www.alanranger.com'
          AND g2.date >= '2025-01-13') AS avg_position_imp_weighted,
       months_with_data
FROM agg
ORDER BY example_id, CASE page_role WHEN 'event' THEN 1 WHEN 'product' THEN 2 WHEN 'type-hub' THEN 3 ELSE 4 END;
`;

function requireEnv(k) {
  const v = process.env[k];
  if (!v) throw new Error('Missing env ' + k);
  return v;
}

async function getToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });
  if (!r.ok) throw new Error('token ' + r.status + ': ' + (await r.text()));
  return (await r.json()).access_token;
}

async function saQuery(token, body) {
  const r = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(PROPERTY)}/searchAnalytics/query`,
    { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  if (!r.ok) throw new Error('sa ' + r.status + ': ' + (await r.text()));
  return r.json();
}

function pad(s, n) { s = String(s ?? ''); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function rpad(s, n) { s = String(s ?? ''); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }

function printMonthlyTable(rows, pageMeta) {
  console.log('\nPAGE: ' + pageMeta.role + ' | ' + pageMeta.path);
  console.log('normalized slug: ' + pageMeta.page_slug);
  console.log('year\tmonth\timpressions\tclicks\tctr\tavg_position');
  for (const r of rows) {
    const pos = r.avg_position == null ? '' : Number(r.avg_position).toFixed(2);
    console.log([r.year, r.month, r.impressions, r.clicks, r.ctr_pct, pos].join('\t'));
  }
}

function printSummaryBlock(exampleId, rows) {
  console.log('\n--- ' + exampleId + ' SUMMARY (2025-01-13 .. ' + GSC_TO + ') ---');
  console.log('role\tpath\tslug\ttotal_impressions\ttotal_clicks\toverall_ctr\tavg_position\tmonths_with_data');
  for (const r of rows) {
    console.log([
      r.page_role, r.path_raw, r.page_slug,
      r.total_impressions, r.total_clicks, r.overall_ctr_pct,
      r.avg_position_imp_weighted ?? '', r.months_with_data
    ].join('\t'));
  }
}

async function fetchTopQueries(token, fullPath) {
  const pageUrl = PROPERTY.replace(/\/$/, '') + fullPath;
  const body = {
    startDate: GSC_FROM,
    endDate: GSC_TO,
    dimensions: ['query'],
    dimensionFilterGroups: [{
      filters: [{ dimension: 'page', operator: 'equals', expression: pageUrl }]
    }],
    rowLimit: 25000,
    dataState: 'final'
  };
  const data = await saQuery(token, body);
  const rows = (data.rows || []).map((r) => ({
    query: r.keys[0],
    impressions: r.impressions,
    clicks: r.clicks,
    ctr: +(r.ctr * 100).toFixed(2),
    position: +r.position.toFixed(2)
  }));
  rows.sort((a, b) => (b.clicks - a.clicks) || (b.impressions - a.impressions));
  return { pageUrl, rowCount: rows.length, top: rows.slice(0, 10) };
}

const supabase = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'));

const slugMap = {
    '/photographic-workshops-near-me/hartland-quay-photography-devon-seascapes': 'photographic-workshops-near-me/hartland-quay-photography-devon-seascapes',
    '/photo-workshops-uk/landscape-photography-devon-hartland-quay': 'photo-workshops-uk/landscape-photography-devon-hartland-quay',
    '/photography-workshops-near-me': 'photography-workshops-near-me',
    '/photography-workshops': 'photography-workshops',
    '/photographic-workshops-near-me/bluebell-photography-photo-workshop-warwickshire-21': 'photographic-workshops-near-me/bluebell-photography-photo-workshop-warwickshire-21',
    '/photo-workshops-uk/bluebell-woodlands-photography-workshops': 'photo-workshops-uk/bluebell-woodlands-photography-workshops',
    '/landscape-photography-workshops': 'landscape-photography-workshops',
    '/photographic-workshops-near-me/peak-district-photography-workshops-autumn': 'photographic-workshops-near-me/peak-district-photography-workshops-autumn',
    '/photo-workshops-uk/landscape-peak-district-photography-workshops-derbyshire': 'photo-workshops-uk/landscape-peak-district-photography-workshops-derbyshire',
    '/one-day-landscape-photography-workshops': 'one-day-landscape-photography-workshops'
};

console.log('=== VERIFICATION: slug resolution (gsc_page_timeseries, date >= 2025-01-13) ===');
console.log('Source: public.gsc_page_timeseries + normalize_gsc_page_slug()');
console.log('GSC window end (API): ' + GSC_TO);

const months = [];
  for (let y = 2025; y <= 2026; y++) {
    for (let m = 1; m <= 12; m++) {
      if (y === 2026 && m > 5) break;
      months.push({ year: y, month: m });
    }
  }

const slugs = [...new Set(Object.values(slugMap))];
let from = 0;
const allRows = [];
while (true) {
  const { data: chunk, error } = await supabase
    .from('gsc_page_timeseries')
    .select('page_url,date,impressions,clicks,position')
    .eq('property_url', PROPERTY)
    .gte('date', '2025-01-13')
    .in('page_url', slugs)
    .range(from, from + 9999);
  if (error) throw error;
  allRows.push(...chunk);
  if (chunk.length < 10000) break;
  from += 10000;
}

const bucket = new Map();
for (const r of allRows) {
  const dt = new Date(r.date + 'T00:00:00Z');
  const y = dt.getUTCFullYear();
  const mo = dt.getUTCMonth() + 1;
  const k = r.page_url + '|' + y + '|' + mo;
  const b = bucket.get(k) || { impressions: 0, clicks: 0, posImp: 0 };
  b.impressions += r.impressions || 0;
  b.clicks += r.clicks || 0;
  b.posImp += (r.position || 0) * (r.impressions || 0);
  bucket.set(k, b);
}

console.log('\n=== DELIVERABLE 1 — Monthly GSC (gsc_page_timeseries aggregated) ===');
for (const ex of EXAMPLES) {
  console.log('\n######## ' + ex.label + ' ########');
  for (const p of ex.pages) {
    const slug = slugMap[p.path];
    const rows = months.map(({ year, month }) => {
      const b = bucket.get(slug + '|' + year + '|' + month) || { impressions: 0, clicks: 0, posImp: 0 };
      const ctr = b.impressions > 0 ? +(100 * b.clicks / b.impressions).toFixed(2) : 0;
      const avg = b.impressions > 0 ? +(b.posImp / b.impressions).toFixed(2) : null;
      return { year, month, impressions: b.impressions, clicks: b.clicks, ctr_pct: ctr, avg_position: avg };
    });
    printMonthlyTable(rows, { role: p.role, path: p.path, page_slug: slug });
  }
}

console.log('\n=== DELIVERABLE 2 — Summary comparison ===');
for (const ex of EXAMPLES) {
  const sumRows = ex.pages.map((p) => {
    const slug = slugMap[p.path];
    let ti = 0, tc = 0, posImp = 0, mwd = 0;
    for (const { year, month } of months) {
      const b = bucket.get(slug + '|' + year + '|' + month);
      if (b && b.impressions > 0) {
        ti += b.impressions; tc += b.clicks; posImp += b.posImp; mwd += 1;
      }
    }
    return {
      page_role: p.role,
      path_raw: p.path,
      page_slug: slug,
      total_impressions: ti,
      total_clicks: tc,
      overall_ctr_pct: ti > 0 ? +(100 * tc / ti).toFixed(2) : 0,
      avg_position_imp_weighted: ti > 0 ? +(posImp / ti).toFixed(2) : null,
      months_with_data: mwd
    };
  });
  printSummaryBlock(ex.id, sumRows);
}

console.log('\n=== DELIVERABLE 3 — Top queries (GSC Search Analytics API, dataState=final) ===');
console.log('Date range: ' + GSC_FROM + ' .. ' + GSC_TO);
const token = await getToken();
for (const ex of EXAMPLES) {
  console.log('\n######## ' + ex.label + ' ########');
  for (const p of ex.pages) {
    const q = await fetchTopQueries(token, p.path);
    console.log('\nPAGE: ' + p.role + ' | ' + p.path);
    console.log('GSC page filter: ' + q.pageUrl);
    console.log('query rows returned: ' + q.rowCount + (q.rowCount === 0 ? ' [ZERO ROWS — possible suppression or no queries]' : ''));
    console.log('query\timpressions\tclicks\tctr\tposition');
    for (const r of q.top) {
      console.log([r.query, r.impressions, r.clicks, r.ctr, r.position].join('\t'));
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}

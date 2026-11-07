/**
 * GSC cross-check for ranking-drop sample keywords from latest audit searchData.
 * Read-only.
 */
import fs from 'fs';

const BASE = 'https://ai-geo-audit.vercel.app';
const PROPERTY = 'https://www.alanranger.com';
const OUT = 'C:/Users/alan/Documents/Codex/2026-09-28/when/outputs';
const phase2 = JSON.parse(fs.readFileSync(`${OUT}/ranking-drop-phase2.json`, 'utf8'));

const samples = [
  ...phase2.tallies.lost_on_sep28.sample.map((s) => s.keyword),
  ...phase2.tallies.lost_on_sep21.sample.map((s) => s.keyword),
  ...phase2.tallies.declined_sep28.sample.map((s) => s.keyword),
  'photography courses',
  'online photography courses',
  'camera courses near me',
  'commercial photographer coventry',
  'beginner photography classes'
];

async function main() {
  const audit = await (await fetch(
    `${BASE}/api/supabase/get-latest-audit?propertyUrl=${encodeURIComponent(PROPERTY)}`
  )).json();
  const sd = audit?.data?.searchData || {};
  const dateRange = sd.dateRange || null;
  const topQueries = Array.isArray(sd.topQueries) ? sd.topQueries : [];
  const queryTotals = Array.isArray(sd.queryTotals) ? sd.queryTotals : [];
  const queryPages = Array.isArray(sd.queryPages) ? sd.queryPages : [];

  console.log(JSON.stringify({
    dateRange,
    topQueries_n: topQueries.length,
    queryTotals_n: queryTotals.length,
    queryPages_n: queryPages.length,
    topQuery0: topQueries[0] ? Object.keys(topQueries[0]) : null,
    queryTotals0: queryTotals[0] ? Object.keys(queryTotals[0]) : null,
    queryPages0: queryPages[0] ? Object.keys(queryPages[0]) : null
  }, null, 2));

  const index = new Map();
  for (const row of [...topQueries, ...queryTotals]) {
    const q = String(row.query || row.keyword || '').toLowerCase().trim();
    if (!q) continue;
    index.set(q, {
      clicks: row.clicks ?? null,
      impressions: row.impressions ?? null,
      position: row.position ?? row.avgPosition ?? null,
      ctr: row.ctr ?? null
    });
  }
  // queryPages may be query+page
  const pageIndex = new Map();
  for (const row of queryPages) {
    const q = String(row.query || row.keyword || '').toLowerCase().trim();
    if (!q) continue;
    const prev = pageIndex.get(q) || { clicks: 0, impressions: 0, positions: [], pages: [] };
    prev.clicks += Number(row.clicks || 0);
    prev.impressions += Number(row.impressions || 0);
    if (row.position != null) prev.positions.push(Number(row.position));
    if (row.page || row.url) prev.pages.push(row.page || row.url);
    pageIndex.set(q, prev);
  }

  const unique = [...new Set(samples.map((s) => s.toLowerCase()))];
  const cross = unique.map((kw) => {
    const q = index.get(kw) || null;
    const qp = pageIndex.get(kw) || null;
    const dfs = phase2.gscCrossLost.find((x) => x.keyword === kw)
      || phase2.tallies.declined_sep28.sample.find((x) => x.keyword === kw)
      || phase2.tallies.lost_on_sep28.sample.find((x) => x.keyword === kw);
    return {
      keyword: kw,
      dfs_path: dfs?.dfs_path || dfs?.path || null,
      local: dfs?.local ?? null,
      gsc_query: q,
      gsc_query_pages: qp
        ? {
            clicks: qp.clicks,
            impressions: qp.impressions,
            avg_position: qp.positions.length
              ? Math.round((qp.positions.reduce((a, b) => a + b, 0) / qp.positions.length) * 10) / 10
              : null,
            pages_n: qp.pages.length
          }
        : null,
      artifact_suspicion:
        q && Number(q.position) > 0 && Number(q.position) <= 20 && (!dfs || String(dfs.dfs_path || dfs.path || '').endsWith('→X'))
          ? 'HIGH: GSC still shows page-1/2 position but DFS unranked'
          : q && Number(q.impressions) > 50 && (!dfs || String(dfs.dfs_path || '').endsWith('→X'))
            ? 'MED: GSC still has impressions but DFS unranked'
            : 'low/unknown'
    };
  });

  // Also overall GSC average position trend if timeseries present
  const timeseries = Array.isArray(sd.timeseries) ? sd.timeseries.slice(-8) : [];
  const overview = sd.overview || {
    totalClicks: sd.totalClicks,
    totalImpressions: sd.totalImpressions,
    averagePosition: sd.averagePosition,
    ctr: sd.ctr
  };

  const out = {
    generatedAt: new Date().toISOString(),
    gsc_dateRange: dateRange,
    overview,
    timeseries_tail: timeseries,
    cross,
    high_suspicion: cross.filter((c) => String(c.artifact_suspicion).startsWith('HIGH')),
    med_suspicion: cross.filter((c) => String(c.artifact_suspicion).startsWith('MED'))
  };
  fs.writeFileSync(`${OUT}/ranking-drop-gsc-cross.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({
    overview,
    dateRange,
    high: out.high_suspicion.length,
    med: out.med_suspicion.length,
    high_sample: out.high_suspicion.slice(0, 12),
    med_sample: out.med_suspicion.slice(0, 8),
    cross_sample: cross.filter((c) => c.gsc_query || c.gsc_query_pages).slice(0, 15)
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

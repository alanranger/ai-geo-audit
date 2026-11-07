/**
 * Phase 2: classify losses by week and local/national; GSC overlap from latest audit.
 * Read-only production GETs.
 */
import fs from 'fs';
import path from 'path';

const OUT = 'C:/Users/alan/Documents/Codex/2026-09-28/when/outputs';
const BASE = 'https://ai-geo-audit.vercel.app';
const PROPERTY = 'https://www.alanranger.com';
const DATES = ['2026-09-14', '2026-09-21', '2026-09-28', '2026-08-31'];

async function fetchDate(date) {
  const res = await fetch(
    `${BASE}/api/supabase/get-keyword-rankings?propertyUrl=${encodeURIComponent(PROPERTY)}&auditDate=${date}`
  );
  const j = await res.json();
  return j?.data?.keywords || [];
}

function mapByKw(rows) {
  const m = new Map();
  for (const r of rows) m.set(String(r.keyword || '').trim().toLowerCase(), r);
  return m;
}

function g(row) {
  if (!row || row.best_rank_group == null || row.best_rank_group === '') return null;
  return Number(row.best_rank_group);
}

function isLocalRow(row) {
  if (!row) return false;
  const cls = String(row.keyword_class || '').toUpperCase();
  if (cls === 'L' || cls === 'LOCAL') return true;
  const loc = String(row.location_name || '').toLowerCase();
  if (loc.includes('coventry') || loc.includes('gloucester') || loc.includes('solihull')) return true;
  if (row.location_coordinate) return true;
  if (Number(row.location_code) === 9215523) return true;
  return false;
}

async function main() {
  const packs = {};
  for (const d of DATES) packs[d] = mapByKw(await fetchDate(d));

  const cohort = [...packs['2026-08-31'].keys()].filter((k) => packs['2026-09-28'].has(k));

  const buckets = {
    lost_on_sep21: [],
    lost_on_sep28: [],
    declined_sep21: [],
    declined_sep28: [],
    recovered_sep28: [],
    still_ranked: []
  };

  for (const k of cohort) {
    const a31 = g(packs['2026-08-31'].get(k));
    const s14 = g(packs['2026-09-14'].get(k));
    const s21 = g(packs['2026-09-21'].get(k));
    const s28 = g(packs['2026-09-28'].get(k));
    const row28 = packs['2026-09-28'].get(k);
    const row21 = packs['2026-09-21'].get(k);
    const local = isLocalRow(packs['2026-08-31'].get(k)) || isLocalRow(row21) || isLocalRow(row28);
    const rec = {
      keyword: k,
      local,
      a31, s14, s21, s28,
      coord_a31: !!packs['2026-08-31'].get(k)?.location_coordinate,
      coord_s21: !!row21?.location_coordinate,
      coord_s28: !!row28?.location_coordinate,
      loc_s21: row21?.location_name || null,
      loc_s28: row28?.location_name || null,
      url_s21: (row21?.best_url || '').split('?')[0] || null,
      url_s28: (row28?.best_url || '').split('?')[0] || null,
      err_s28: row28?.error || null,
      class: packs['2026-08-31'].get(k)?.keyword_class || row28?.keyword_class || null
    };

    if (s14 != null && s21 == null) buckets.lost_on_sep21.push(rec);
    else if (s21 != null && s28 == null) buckets.lost_on_sep28.push(rec);
    else if (s14 != null && s21 != null && s21 - s14 >= 5) buckets.declined_sep21.push(rec);
    else if (s21 != null && s28 != null && s28 - s21 >= 5) buckets.declined_sep28.push(rec);

    if (s21 == null && s28 != null) buckets.recovered_sep28.push(rec);
    if (s28 != null) buckets.still_ranked.push(rec);
  }

  const tally = (arr) => ({
    n: arr.length,
    local: arr.filter((x) => x.local).length,
    national: arr.filter((x) => !x.local).length,
    sample: arr.slice(0, 12).map((x) => ({
      keyword: x.keyword,
      local: x.local,
      path: `${x.a31 ?? 'X'}→${x.s14 ?? 'X'}→${x.s21 ?? 'X'}→${x.s28 ?? 'X'}`,
      coords: `${x.coord_a31 ? 1 : 0}/${x.coord_s21 ? 1 : 0}/${x.coord_s28 ? 1 : 0}`,
      locs: `${x.loc_s21 || ''} => ${x.loc_s28 || ''}`
    }))
  });

  // GSC: pull query page metrics from latest audit if available
  const audit = await (await fetch(
    `${BASE}/api/supabase/get-latest-audit?propertyUrl=${encodeURIComponent(PROPERTY)}`
  )).json();
  const data = audit?.data || {};
  const keys = Object.keys(data).sort();

  // Find GSC-like arrays
  const gscHints = {};
  for (const k of keys) {
    const v = data[k];
    if (Array.isArray(v) && v.length && v[0] && typeof v[0] === 'object') {
      const sampleKeys = Object.keys(v[0]).slice(0, 12);
      if (sampleKeys.some((sk) => /query|clicks|impressions|position|keyword/i.test(sk))) {
        gscHints[k] = { n: v.length, sampleKeys };
      }
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sk = Object.keys(v);
      if (sk.some((x) => /gsc|query|impression/i.test(x))) {
        gscHints[k] = { type: 'object', keys: sk.slice(0, 30) };
      }
    }
  }

  // Try common fields
  let queryRows = null;
  for (const candidate of [
    'gsc_queries', 'gscQueries', 'queryPageMetrics', 'gsc_query_page', 'csv40d',
    'search_analytics', 'gscSearchAnalytics', 'money_segment_metrics'
  ]) {
    if (Array.isArray(data[candidate])) {
      queryRows = data[candidate];
      gscHints.used = candidate;
      break;
    }
  }

  // ranking_ai_data may embed previous
  const rankingAi = typeof data.ranking_ai_data === 'string'
    ? JSON.parse(data.ranking_ai_data)
    : data.ranking_ai_data;

  // Build GSC lookup from any array with query+position
  let gscByQuery = new Map();
  const scanArrays = [];
  for (const [k, meta] of Object.entries(gscHints)) {
    if (meta.n && Array.isArray(data[k])) scanArrays.push([k, data[k]]);
  }
  // Also dig into scores / nested
  if (data.scores?.authority?.bySegment?.all?.topPages) {
    scanArrays.push(['authority.topPages', data.scores.authority.bySegment.all.topPages]);
  }

  for (const [name, arr] of scanArrays) {
    for (const row of arr.slice(0, 5000)) {
      const q = String(row.query || row.keyword || row.keys || '').toLowerCase().trim();
      if (!q) continue;
      if (!gscByQuery.has(q)) {
        gscByQuery.set(q, {
          source: name,
          clicks: row.clicks ?? row.clicks_28d ?? null,
          impressions: row.impressions ?? row.impressions_28d ?? null,
          position: row.position ?? row.avgPosition ?? row.weighted_position ?? null
        });
      }
    }
  }

  // Cross-check lost keywords vs GSC position if available
  const lostAll = [...buckets.lost_on_sep21, ...buckets.lost_on_sep28];
  const gscCrossLost = lostAll.map((x) => {
    const gsc = gscByQuery.get(x.keyword) || null;
    return {
      keyword: x.keyword,
      local: x.local,
      dfs_path: `${x.a31 ?? 'X'}→${x.s14 ?? 'X'}→${x.s21 ?? 'X'}→${x.s28 ?? 'X'}`,
      gsc
    };
  });

  const out = {
    generatedAt: new Date().toISOString(),
    tallies: {
      lost_on_sep21: tally(buckets.lost_on_sep21),
      lost_on_sep28: tally(buckets.lost_on_sep28),
      declined_sep21: tally(buckets.declined_sep21),
      declined_sep28: tally(buckets.declined_sep28),
      recovered_sep28: tally(buckets.recovered_sep28)
    },
    gscHints,
    gscLookupSize: gscByQuery.size,
    gscCrossLost: gscCrossLost.slice(0, 40),
    ranking_ai_summary: rankingAi?.summary || rankingAi?.totals || null,
    audit_keys: keys
  };

  fs.writeFileSync(path.join(OUT, 'ranking-drop-phase2.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({
    tallies: out.tallies,
    gscHints: out.gscHints,
    gscLookupSize: out.gscLookupSize,
    gscCrossSample: out.gscCrossLost.slice(0, 8),
    ranking_ai_summary: out.ranking_ai_summary
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

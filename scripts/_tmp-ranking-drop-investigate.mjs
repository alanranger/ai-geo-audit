/**
 * Ranking drop investigation — read-only via production GET APIs.
 */
import fs from 'fs';
import path from 'path';

const OUT = 'C:/Users/alan/Documents/Codex/2026-09-28/when/outputs';
const BASE = 'https://ai-geo-audit.vercel.app';
const PROPERTY = 'https://www.alanranger.com';
const DATES = [
  '2026-07-13',
  '2026-07-27',
  '2026-08-31',
  '2026-09-07',
  '2026-09-14',
  '2026-09-21',
  '2026-09-28'
];

async function getJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch {
    throw new Error(`bad json ${res.status} ${url} ${text.slice(0, 180)}`);
  }
  if (!res.ok) throw new Error(`${res.status} ${url} ${text.slice(0, 180)}`);
  return json;
}

function rankOf(row) {
  const g = row?.best_rank_group;
  const a = row?.best_rank_absolute;
  return {
    group: g == null || g === '' ? null : Number(g),
    absolute: a == null || a === '' ? null : Number(a)
  };
}

function summarize(rows) {
  const ranked = rows.filter((r) => Number.isFinite(rankOf(r).group));
  const groups = ranked.map((r) => rankOf(r).group);
  const abs = ranked.map((r) => rankOf(r).absolute).filter(Number.isFinite);
  const sortG = [...groups].sort((a, b) => a - b);
  const avg = (arr) => (arr.length ? arr.reduce((s, n) => s + n, 0) / arr.length : null);
  const loc = {};
  const device = {};
  let withCoord = 0;
  let withoutCoord = 0;
  let crawlIncomplete = 0;
  let withError = 0;
  let depthVals = {};
  let organicCounts = [];
  for (const r of rows) {
    const locKey = `${r.location_name || 'null'}|${r.location_code ?? 'null'}`;
    loc[locKey] = (loc[locKey] || 0) + 1;
    const d = String(r.device || 'null');
    device[d] = (device[d] || 0) + 1;
    if (r.location_coordinate) withCoord += 1;
    else withoutCoord += 1;
    if (r.crawl_incomplete === true) crawlIncomplete += 1;
    if (r.error) withError += 1;
    const depth = r.serp_depth ?? r.depth ?? null;
    if (depth != null) depthVals[String(depth)] = (depthVals[String(depth)] || 0) + 1;
    if (Number.isFinite(Number(r.organic_count))) organicCounts.push(Number(r.organic_count));
  }
  return {
    n: rows.length,
    ranked: ranked.length,
    unranked: rows.length - ranked.length,
    top3: groups.filter((g) => g <= 3).length,
    top10: groups.filter((g) => g <= 10).length,
    top20: groups.filter((g) => g <= 20).length,
    avg_group: avg(groups) == null ? null : Math.round(avg(groups) * 10) / 10,
    median_group: sortG.length ? sortG[Math.floor(sortG.length / 2)] : null,
    avg_absolute: avg(abs) == null ? null : Math.round(avg(abs) * 10) / 10,
    locations: loc,
    devices: device,
    with_coord: withCoord,
    without_coord: withoutCoord,
    crawl_incomplete: crawlIncomplete,
    with_error: withError,
    depths: depthVals,
    organic_count_avg: organicCounts.length
      ? Math.round((avg(organicCounts)) * 10) / 10
      : null,
    organic_count_min: organicCounts.length ? Math.min(...organicCounts) : null,
    sample_error: rows.find((r) => r.error)?.error || null
  };
}

function mapByKw(rows) {
  const m = new Map();
  for (const r of rows) m.set(String(r.keyword || '').trim().toLowerCase(), r);
  return m;
}

function compareDates(oldRows, newRows, oldDate, newDate) {
  const oldMap = mapByKw(oldRows);
  const newMap = mapByKw(newRows);
  const cohort = [...oldMap.keys()].filter((k) => newMap.has(k));
  const movers = [];
  for (const k of cohort) {
    const o = rankOf(oldMap.get(k));
    const n = rankOf(newMap.get(k));
    let kind = 'stable';
    let delta = null;
    if (o.group == null && n.group == null) kind = 'unranked_both';
    else if (o.group != null && n.group == null) kind = 'lost';
    else if (o.group == null && n.group != null) kind = 'gained';
    else {
      delta = n.group - o.group;
      if (delta >= 5) kind = 'declined';
      else if (delta <= -5) kind = 'improved';
    }
    movers.push({
      keyword: k,
      kind,
      old_date: oldDate,
      new_date: newDate,
      old_group: o.group,
      new_group: n.group,
      delta_group: delta,
      old_abs: o.absolute,
      new_abs: n.absolute,
      old_url: oldMap.get(k)?.best_url || null,
      new_url: newMap.get(k)?.best_url || null,
      old_loc: oldMap.get(k)?.location_name || null,
      new_loc: newMap.get(k)?.location_name || null,
      old_code: oldMap.get(k)?.location_code ?? null,
      new_code: newMap.get(k)?.location_code ?? null,
      old_coord: Boolean(oldMap.get(k)?.location_coordinate),
      new_coord: Boolean(newMap.get(k)?.location_coordinate),
      old_device: oldMap.get(k)?.device || null,
      new_device: newMap.get(k)?.device || null,
      old_class: oldMap.get(k)?.keyword_class || oldMap.get(k)?.tier || null,
      new_class: newMap.get(k)?.keyword_class || newMap.get(k)?.tier || null,
      new_error: newMap.get(k)?.error || null,
      old_error: oldMap.get(k)?.error || null,
      new_organic_count: newMap.get(k)?.organic_count ?? null,
      old_organic_count: oldMap.get(k)?.organic_count ?? null,
      new_crawl_incomplete: newMap.get(k)?.crawl_incomplete ?? null,
      new_depth: newMap.get(k)?.serp_depth ?? null,
      old_depth: oldMap.get(k)?.serp_depth ?? null
    });
  }
  const oldCohortRows = cohort.map((k) => oldMap.get(k));
  const newCohortRows = cohort.map((k) => newMap.get(k));
  return {
    old_date: oldDate,
    new_date: newDate,
    cohort_n: cohort.length,
    old_only: [...oldMap.keys()].filter((k) => !newMap.has(k)).length,
    new_only: [...newMap.keys()].filter((k) => !oldMap.has(k)).length,
    old: summarize(oldCohortRows),
    new: summarize(newCohortRows),
    lost: movers.filter((m) => m.kind === 'lost').length,
    gained: movers.filter((m) => m.kind === 'gained').length,
    declined_ge5: movers.filter((m) => m.kind === 'declined').length,
    improved_ge5: movers.filter((m) => m.kind === 'improved').length,
    movers
  };
}

async function fetchDate(date) {
  const j = await getJson(
    `${BASE}/api/supabase/get-keyword-rankings?propertyUrl=${encodeURIComponent(PROPERTY)}&auditDate=${date}`
  );
  return j?.data?.keywords || [];
}

async function main() {
  const byDate = {};
  for (const date of DATES) {
    const rows = await fetchDate(date);
    byDate[date] = rows;
    console.log(date, rows.length, summarize(rows));
  }

  const weekly = DATES.map((date) => ({ date, ...summarize(byDate[date]) }));

  // Week-over-week among 155-row era
  const era = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28'];
  const wow = [];
  for (let i = 1; i < era.length; i++) {
    wow.push(compareDates(byDate[era[i - 1]], byDate[era[i]], era[i - 1], era[i]));
  }
  const long = compareDates(byDate['2026-08-31'], byDate['2026-09-28'], '2026-08-31', '2026-09-28');
  const jul = compareDates(byDate['2026-07-27'], byDate['2026-09-28'], '2026-07-27', '2026-09-28');

  // Biggest multi-week declines from Aug 31 → Sep 28
  const topLost = long.movers.filter((m) => m.kind === 'lost').slice(0, 25);
  const topDeclined = long.movers
    .filter((m) => m.kind === 'declined')
    .sort((a, b) => (b.delta_group || 0) - (a.delta_group || 0))
    .slice(0, 30);

  // Track sample keywords across all weeks
  const sampleKws = [
    ...topLost.slice(0, 8).map((m) => m.keyword),
    ...topDeclined.slice(0, 12).map((m) => m.keyword)
  ];
  const uniqueSamples = [...new Set(sampleKws)];
  const trajectories = uniqueSamples.map((kw) => {
    const points = DATES.map((date) => {
      const row = mapByKw(byDate[date]).get(kw);
      if (!row) return { date, missing: true };
      const r = rankOf(row);
      return {
        date,
        group: r.group,
        absolute: r.absolute,
        url: row.best_url || null,
        loc: row.location_name || null,
        code: row.location_code ?? null,
        coord: Boolean(row.location_coordinate),
        device: row.device || null,
        error: row.error || null,
        organic_count: row.organic_count ?? null,
        crawl_incomplete: row.crawl_incomplete ?? null,
        depth: row.serp_depth ?? null,
        class: row.keyword_class || null
      };
    });
    return { keyword: kw, points };
  });

  // Location/coord shift detail for local keywords
  const locShift = era.map((date) => {
    const rows = byDate[date];
    const localish = rows.filter((r) =>
      /coventry|near me|local/i.test(String(r.keyword || ''))
      || String(r.keyword_class || '').toUpperCase() === 'L'
      || String(r.location_name || '').toLowerCase().includes('coventry')
    );
    return {
      date,
      localish_n: localish.length,
      with_coord: localish.filter((r) => r.location_coordinate).length,
      locations: summarize(localish).locations,
      ranked: summarize(localish).ranked,
      unranked: summarize(localish).unranked,
      top10: summarize(localish).top10,
      avg_group: summarize(localish).avg_group
    };
  });

  // citation-movement snapshots (no paid call)
  let citationMovement = null;
  try {
    citationMovement = await getJson(
      `${BASE}/api/aigeo/citation-movement?propertyUrl=${encodeURIComponent(PROPERTY)}`
    );
  } catch (e) {
    citationMovement = { error: String(e.message || e) };
  }

  // GSC cross-check from latest audit (already public via API) — extract keyword/page query totals if present
  let gscCross = null;
  try {
    const audit = await getJson(
      `${BASE}/api/supabase/get-latest-audit?propertyUrl=${encodeURIComponent(PROPERTY)}`
    );
    const data = audit?.data || {};
    // Prefer ranking_ai_data summary + any gsc query blobs without dumping huge content
    const rankingAi = data.ranking_ai_data || data.rankingAiData || null;
    const scores = data.scores || null;
    gscCross = {
      audit_date: data.audit_date || data.auditDate || null,
      timestamp: data.timestamp || null,
      authority_ranking_score: scores?.authority?.score ?? scores?.authority?.bySegment?.all?.ranking ?? null,
      ranking_ai_keys: rankingAi && typeof rankingAi === 'object' ? Object.keys(rankingAi).slice(0, 40) : null,
      ranking_ai_summary: rankingAi?.summary || rankingAi?.totals || null,
      combinedRows_n: Array.isArray(rankingAi?.combinedRows) ? rankingAi.combinedRows.length : null
    };

    // Try to pull GSC query performance for overlapping keywords if present on audit
    const gscCandidates = [
      data.gsc_query_page,
      data.gscQueryPage,
      data.money_page_keywords,
      data.gsc_data,
      data.csv40d
    ].filter(Boolean);
    gscCross.gsc_blob_types = gscCandidates.map((c) => Array.isArray(c) ? `array:${c.length}` : typeof c);
  } catch (e) {
    gscCross = { error: String(e.message || e) };
  }

  // Slim GSC: use keywords/get? no — try known endpoint
  let gscQueries = null;
  try {
    // Some dashboards expose query totals via get-latest-audit nested fields; scan keys only
    const audit = await getJson(
      `${BASE}/api/supabase/get-latest-audit?propertyUrl=${encodeURIComponent(PROPERTY)}`
    );
    const topKeys = Object.keys(audit?.data || {}).sort();
    gscQueries = { audit_data_keys: topKeys };
  } catch (e) {
    gscQueries = { error: String(e.message || e) };
  }

  const out = {
    generatedAt: new Date().toISOString(),
    property: PROPERTY,
    method: 'production GET /api/supabase/get-keyword-rankings (read-only); no DFS spend; no DB writes',
    deeper_search_commit: {
      sha: '3326f8e5fdf811dd750e0606b92d74850a221caf',
      date: '2026-09-28 12:05:56 +0100',
      title: 'fix: reject thin DFS SERP crawls and use Coventry city for local ranks',
      notes: [
        'depth remains 50 (not increased)',
        'added thin-crawl detection + up to 2 retries; incomplete crawls clear best_rank_* instead of false unranked',
        'REMOVED GBP location_coordinate pin for Local tier — Coventry location_code only',
        'Affects snapshots from 2026-09-28 onward; prior weeks used GBP pin for Local'
      ]
    },
    prior_related_commits: [
      { sha: 'c539a13', note: 'depth 100→50 (2026-06)' },
      { sha: 'f784473', note: 'Hyperlocal Local-tier SERP from GBP centroid' },
      { sha: 'fc78435', note: 'persist Coventry GBP pin on Local-tier Ranking saves' }
    ],
    weekly,
    wow: wow.map((w) => ({
      old_date: w.old_date,
      new_date: w.new_date,
      cohort_n: w.cohort_n,
      old_only: w.old_only,
      new_only: w.new_only,
      lost: w.lost,
      gained: w.gained,
      declined_ge5: w.declined_ge5,
      improved_ge5: w.improved_ge5,
      old: w.old,
      new: w.new
    })),
    long_aug31_to_sep28: {
      ...long,
      movers: undefined,
      top_lost: topLost,
      top_declined: topDeclined
    },
    long_jul27_to_sep28: {
      old_date: jul.old_date,
      new_date: jul.new_date,
      cohort_n: jul.cohort_n,
      lost: jul.lost,
      gained: jul.gained,
      declined_ge5: jul.declined_ge5,
      improved_ge5: jul.improved_ge5,
      old: jul.old,
      new: jul.new
    },
    trajectories,
    locShift,
    citationMovement: citationMovement?.data
      ? {
          current: citationMovement.data.current?.audit_date || citationMovement.data.current_date,
          last_audit: citationMovement.data.last_audit?.audit_date || citationMovement.data.last_audit_date,
          seven_days: citationMovement.data.seven_days?.audit_date || citationMovement.data.seven_days_date,
          keys: Object.keys(citationMovement.data)
        }
      : citationMovement,
    gscCross,
    gscQueries
  };

  // Persist full movers CSV
  const allMovers = long.movers;
  const csvHeader = [
    'keyword', 'kind', 'old_group', 'new_group', 'delta_group', 'old_abs', 'new_abs',
    'old_loc', 'new_loc', 'old_coord', 'new_coord', 'old_device', 'new_device',
    'old_class', 'new_class', 'old_url', 'new_url', 'new_error'
  ].join(',') + '\n';
  const csv = csvHeader + allMovers.map((m) => [
    JSON.stringify(m.keyword), m.kind,
    m.old_group ?? '', m.new_group ?? '', m.delta_group ?? '',
    m.old_abs ?? '', m.new_abs ?? '',
    JSON.stringify(m.old_loc || ''), JSON.stringify(m.new_loc || ''),
    m.old_coord, m.new_coord,
    JSON.stringify(m.old_device || ''), JSON.stringify(m.new_device || ''),
    JSON.stringify(m.old_class || ''), JSON.stringify(m.new_class || ''),
    JSON.stringify(m.old_url || ''), JSON.stringify(m.new_url || ''),
    JSON.stringify(m.new_error || '')
  ].join(',')).join('\n');

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'ranking-drop-investigation.json'), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT, 'ranking-drop-movers-aug31-sep28.csv'), csv);
  fs.writeFileSync(
    path.join(OUT, 'ranking-drop-weekly.csv'),
    'date,n,ranked,unranked,top3,top10,top20,avg_group,median_group,avg_absolute,with_coord,without_coord,crawl_incomplete,with_error\n'
      + weekly.map((w) => [
        w.date, w.n, w.ranked, w.unranked, w.top3, w.top10, w.top20,
        w.avg_group ?? '', w.median_group ?? '', w.avg_absolute ?? '',
        w.with_coord, w.without_coord, w.crawl_incomplete, w.with_error
      ].join(',')).join('\n')
  );

  // Save raw sample rows for top movers on old+new dates (evidence)
  const evidence = {};
  for (const m of [...topLost.slice(0, 10), ...topDeclined.slice(0, 10)]) {
    evidence[m.keyword] = {
      aug31: mapByKw(byDate['2026-08-31']).get(m.keyword) || null,
      sep21: mapByKw(byDate['2026-09-21']).get(m.keyword) || null,
      sep28: mapByKw(byDate['2026-09-28']).get(m.keyword) || null
    };
  }
  // Strip potentially huge serp stacks to keep file manageable
  const slimEvidence = {};
  for (const [kw, pack] of Object.entries(evidence)) {
    slimEvidence[kw] = {};
    for (const [label, row] of Object.entries(pack)) {
      if (!row) { slimEvidence[kw][label] = null; continue; }
      const copy = { ...row };
      if (copy.serp_surface_stack) {
        copy.serp_surface_stack_n = Array.isArray(copy.serp_surface_stack)
          ? copy.serp_surface_stack.length
          : null;
        delete copy.serp_surface_stack;
      }
      if (copy.ai_overview_citations) {
        copy.ai_overview_citations_n = Array.isArray(copy.ai_overview_citations)
          ? copy.ai_overview_citations.length
          : null;
        delete copy.ai_overview_citations;
      }
      slimEvidence[kw][label] = copy;
    }
  }
  fs.writeFileSync(path.join(OUT, 'ranking-drop-mover-evidence.json'), JSON.stringify(slimEvidence, null, 2));

  console.log(JSON.stringify({
    weekly: weekly.map((w) => ({
      date: w.date, ranked: w.ranked, unranked: w.unranked, top10: w.top10,
      avg: w.avg_group, med: w.median_group, coord: w.with_coord
    })),
    wow: out.wow.map((w) => ({
      span: `${w.old_date}→${w.new_date}`,
      lost: w.lost, declined: w.declined_ge5, gained: w.gained, improved: w.improved_ge5,
      ranked: `${w.old.ranked}→${w.new.ranked}`, top10: `${w.old.top10}→${w.new.top10}`
    })),
    long_lost: long.lost,
    long_declined: long.declined_ge5,
    sample_lost: topLost.slice(0, 5).map((m) => m.keyword),
    sample_declined: topDeclined.slice(0, 5).map((m) => `${m.keyword} ${m.old_group}→${m.new_group}`)
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

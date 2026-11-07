import pg from 'pg';
import {
  computeTopOfPageRollup,
  TOP_OF_PAGE_SCHEMA_VERSION,
  meetsTopOfPageDemandPool,
} from '../lib/audit/topOfPage.js';

const url = process.env.SUPABASE_PG_RO_URL;
if (!url) {
  console.error('SUPABASE_PG_RO_URL missing');
  process.exit(1);
}

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
const { rows } = await client.query(`
  select keyword, keyword_class, search_volume, best_rank_group, kp_ours, serp_surface_stack
  from keyword_rankings
  where updated_at >= timestamptz '2026-10-19'
    and updated_at < timestamptz '2026-10-20'
`);
await client.end();

const normalised = rows.map((r) => ({
  ...r,
  serp_surface_stack: Array.isArray(r.serp_surface_stack)
    ? r.serp_surface_stack
    : (typeof r.serp_surface_stack === 'string' ? JSON.parse(r.serp_surface_stack) : r.serp_surface_stack),
}));

const rollupV4 = computeTopOfPageRollup(normalised);

// Legacy-ish: all measurable money with fake vol=10 (approx old behaviour)
function legacyOverall(list) {
  let wSum = 0;
  let sSum = 0;
  let n = 0;
  for (const row of list) {
    const cls = row.keyword_class || 'national-money';
    if (cls !== 'local-money' && cls !== 'national-money') continue;
    const top = rollupV4.perKeyword; // placeholder
    n += 1;
  }
  return n;
}

// Recompute old-style mean using same keyword scores but without floor filter
import { computeKeywordTopOfPageScore } from '../lib/audit/topOfPage.js';

let oldW = 0;
let oldS = 0;
let oldN = 0;
let newW = 0;
let newS = 0;
for (const row of normalised) {
  const cls = row.keyword_class || 'national-money';
  if (cls !== 'local-money' && cls !== 'national-money') continue;
  const top = computeKeywordTopOfPageScore(row);
  const vol = Number(row.search_volume);
  const oldWeight = (!Number.isFinite(vol) || vol <= 0) ? 10 : vol;
  oldW += oldWeight;
  oldS += oldWeight * top.score;
  oldN += 1;
  if (meetsTopOfPageDemandPool(row, cls)) {
    newW += vol;
    newS += vol * top.score;
  }
}

console.log(JSON.stringify({
  schema: TOP_OF_PAGE_SCHEMA_VERSION,
  rows: normalised.length,
  withStack: normalised.filter((r) => Array.isArray(r.serp_surface_stack) && r.serp_surface_stack.length).length,
  v4: {
    overall: rollupV4.overall,
    poolKeywords: (rollupV4.perKeyword || []).length,
    byClass: Object.fromEntries(
      Object.entries(rollupV4.byClass || {}).map(([k, v]) => [k, { score: v.score, count: v.count }]),
    ),
  },
  approxOldNoFloor: {
    overall: oldW > 0 ? Math.round(oldS / oldW) : 0,
    moneyKeywords: oldN,
  },
  approxNewFloorOnlyMoney: {
    overall: newW > 0 ? Math.round(newS / newW) : 0,
  },
}, null, 2));

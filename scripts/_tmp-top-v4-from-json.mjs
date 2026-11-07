import { readFileSync, writeFileSync } from 'fs';
import {
  computeTopOfPageRollup,
  TOP_OF_PAGE_SCHEMA_VERSION,
  meetsTopOfPageDemandPool,
  computeKeywordTopOfPageScore,
} from '../lib/audit/topOfPage.js';

const src = process.argv[2];
const raw = readFileSync(src, 'utf8');
const match = raw.match(/<untrusted-data-[^>]*>([\s\S]*?)<\/untrusted-data-[^>]*>/);
const payload = JSON.parse(match ? match[1].trim() : raw);
const rows = Array.isArray(payload)
  ? (payload[0]?.rows || payload)
  : (payload.rows || payload);

const list = (rows || []).map((r) => ({
  ...r,
  serp_surface_stack: typeof r.serp_surface_stack === 'string'
    ? JSON.parse(r.serp_surface_stack)
    : r.serp_surface_stack,
}));

const v4 = computeTopOfPageRollup(list);

let oldW = 0;
let oldS = 0;
let oldN = 0;
for (const row of list) {
  const cls = row.keyword_class || 'national-money';
  if (cls !== 'local-money' && cls !== 'national-money') continue;
  const top = computeKeywordTopOfPageScore(row);
  const vol = Number(row.search_volume);
  const w = (!Number.isFinite(vol) || vol <= 0) ? 10 : vol;
  oldW += w;
  oldS += w * top.score;
  oldN += 1;
}

const out = {
  schema: TOP_OF_PAGE_SCHEMA_VERSION,
  rows: list.length,
  withStack: list.filter((r) => Array.isArray(r.serp_surface_stack) && r.serp_surface_stack.length).length,
  v4Overall: v4.overall,
  v4PoolKeywords: (v4.perKeyword || []).length,
  v4ByClass: Object.fromEntries(
    Object.entries(v4.byClass || {}).map(([k, v]) => [k, { score: v.score, count: v.count }]),
  ),
  approxOldOverall: oldW > 0 ? Math.round(oldS / oldW) : 0,
  oldMoneyKeywords: oldN,
  poolGateCount: list.filter((r) => meetsTopOfPageDemandPool(r, r.keyword_class || 'national-money')).length,
};
console.log(JSON.stringify(out, null, 2));
writeFileSync('scripts/output/_tmp-top-v4-check.json', JSON.stringify(out, null, 2));

import { readFileSync, writeFileSync } from 'fs';
import {
  computeTopOfPageRollup,
  TOP_OF_PAGE_SCHEMA_VERSION,
  meetsTopOfPageDemandPool,
  computeKeywordTopOfPageScore,
} from '../lib/audit/topOfPage.js';

const t = readFileSync(process.argv[2], 'utf8');
const outer = JSON.parse(t);
const resultText = String(outer.result || '');
const start = resultText.indexOf('[{');
const end = resultText.lastIndexOf(']');
if (start < 0 || end < start) {
  throw new Error('could not find JSON array in MCP result');
}
const inner = JSON.parse(resultText.slice(start, end + 1));
const rows = inner[0]?.rows || inner.rows || inner;

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
writeFileSync('scripts/output/_tmp-top-v4-check.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));

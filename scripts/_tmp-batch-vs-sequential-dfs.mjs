/**
 * Reproduce batch vs sequential for the 6 false-negative keywords.
 * Calls the same fetchSerpForKeyword used by /api/aigeo/serp-rank-test,
 * once with Promise.all concurrency=5 (batch path), once sequential.
 * No DB writes.
 */
import { config as dotenvConfig } from 'dotenv';
import { fetchSerpForKeyword } from '../api/aigeo/serp-rank-test.js';
import { resolveTrackingLocation } from '../lib/keyword-ranking/tracking-location.js';

dotenvConfig({ path: '.env.local' });

const TARGET = 'alanranger.com';
const FALSE_NEGATIVES = [
  'beginners photography classes coventry',
  'beginners photography courses coventry',
  'commercial photographer near me',
  'free photography classes near me',
  'photography classes near me',
  'photography gift card',
];
const TRUE_MISSES = [
  'best photography classes',
  'landscape photography workshop',
  'landscape workshops',
  'photography classes',
];

const login = process.env.DATAFORSEO_API_LOGIN || process.env.DATAFORSEO_LOGIN;
const password = process.env.DATAFORSEO_API_PASSWORD || process.env.DATAFORSEO_PASSWORD;
if (!login || !password) throw new Error('Missing DFS credentials');
const auth = Buffer.from(`${login}:${password}`).toString('base64');

function optsFor(keyword) {
  const loc = resolveTrackingLocation(keyword);
  return {
    expandAiOverview: false,
    location_name: loc.location_name,
    location_code: loc.location_code,
    tier: loc.tier,
  };
}

function summarise(keyword, serp) {
  const stackLen = Array.isArray(serp?.serp_surface_stack) ? serp.serp_surface_stack.length : 0;
  return {
    keyword,
    rank: serp?.best_rank_group ?? null,
    abs: serp?.best_rank_absolute ?? null,
    stackLen,
    error: serp?.error || null,
    url: serp?.best_url ? String(serp.best_url).slice(0, 70) : null,
  };
}

async function fetchOne(keyword) {
  const opts = optsFor(keyword);
  let result = await fetchSerpForKeyword(keyword, auth, TARGET, 50, opts);
  const emptyMiss = result?.error
    || !Array.isArray(result?.serp_surface_stack)
    || result.serp_surface_stack.length === 0;
  if (emptyMiss && !result?.fatal) {
    result = await fetchSerpForKeyword(keyword, auth, TARGET, 50, opts);
  }
  return summarise(keyword, result);
}

async function runConcurrent(keywords, limit = 5) {
  const out = [];
  for (let i = 0; i < keywords.length; i += limit) {
    const slice = keywords.slice(i, i + limit);
    const batch = await Promise.all(slice.map((kw) => fetchOne(kw)));
    out.push(...batch);
  }
  return out;
}

async function runSequential(keywords) {
  const out = [];
  for (const kw of keywords) out.push(await fetchOne(kw));
  return out;
}

const all = [...FALSE_NEGATIVES, ...TRUE_MISSES];
console.log('=== PASS 1: concurrent (limit 5) — mirrors batch Ranking ===');
const concurrent = await runConcurrent(all, 5);
console.log(JSON.stringify(concurrent, null, 2));

console.log('\n=== PASS 2: sequential — mirrors direct verify ===');
const sequential = await runSequential(all);
console.log(JSON.stringify(sequential, null, 2));

console.log('\n=== DIFF (false negatives) ===');
for (const kw of FALSE_NEGATIVES) {
  const c = concurrent.find((r) => r.keyword === kw);
  const s = sequential.find((r) => r.keyword === kw);
  console.log(JSON.stringify({
    keyword: kw,
    concurrent_rank: c?.rank ?? null,
    sequential_rank: s?.rank ?? null,
    concurrent_stack: c?.stackLen,
    sequential_stack: s?.stackLen,
    concurrent_error: c?.error,
    sequential_error: s?.error,
    mismatch: (c?.rank ?? null) !== (s?.rank ?? null),
  }));
}

console.log('\n=== DIFF (true misses) ===');
for (const kw of TRUE_MISSES) {
  const c = concurrent.find((r) => r.keyword === kw);
  const s = sequential.find((r) => r.keyword === kw);
  console.log(JSON.stringify({
    keyword: kw,
    concurrent_rank: c?.rank ?? null,
    sequential_rank: s?.rank ?? null,
    both_null: c?.rank == null && s?.rank == null,
  }));
}

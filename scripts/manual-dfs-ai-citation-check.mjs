#!/usr/bin/env node
/**
 * Manual DataForSEO AI citation probe for tracked keywords.
 * Usage: node scripts/manual-dfs-ai-citation-check.mjs [--limit N] [--keyword "foo"]
 */
import dotenv from 'dotenv';
import { extractCitationsFromDfsResult } from '../lib/ai-citation-extract.js';

dotenv.config({ path: '.env.local' });

const login = process.env.DATAFORSEO_API_LOGIN || process.env.DATAFORSEO_LOGIN;
const password = process.env.DATAFORSEO_API_PASSWORD || process.env.DATAFORSEO_PASSWORD;
if (!login || !password) {
  console.error('Missing DATAFORSEO_API_LOGIN / DATAFORSEO_API_PASSWORD in .env.local');
  process.exit(1);
}

const auth = Buffer.from(`${login}:${password}`).toString('base64');
const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 20;
const kwIdx = args.indexOf('--keyword');
const singleKw = kwIdx >= 0 ? args[kwIdx + 1] : null;

const DEFAULT_KEYWORDS = [
  'Landscape Photography Workshops', 'commercial photographer', 'commercial photography services',
  'corporate photography', 'free online photography course', 'hire a photographer',
  'hire a professional photographer', 'landscape photography courses', 'landscape photography workshop',
  'landscape photography workshops uk', 'landscape workshops', 'lightroom courses',
  'one day photography workshops', 'online photography courses', 'online photography lesson',
  'photo editing course', 'photo workshops', 'photographer coventry', 'photographer in coventry',
  'photographic workshops',
];

const keywords = singleKw ? [singleKw] : DEFAULT_KEYWORDS.slice(0, limit);

async function dfsPost(endpoint, payload) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify([payload]),
  });
  const data = await res.json();
  const task = data?.tasks?.[0];
  const result = task?.result?.[0];
  return { ok: res.ok && String(data.status_code).startsWith('200'), task, result, data };
}

async function probeKeyword(keyword) {
  const [aiMode, serpNoExpand, serpExpand] = await Promise.all([
    dfsPost('https://api.dataforseo.com/v3/serp/google/ai_mode/live/advanced', {
      keyword, language_name: 'English', location_name: 'United Kingdom', device: 'desktop', os: 'windows',
    }),
    dfsPost('https://api.dataforseo.com/v3/serp/google/organic/live/advanced', {
      keyword, language_code: 'en', location_code: 2826, device: 'desktop', os: 'windows', depth: 100,
      load_async_ai_overview: false, expand_ai_overview: false,
    }),
    dfsPost('https://api.dataforseo.com/v3/serp/google/organic/live/advanced', {
      keyword, language_code: 'en', location_code: 2826, device: 'desktop', os: 'windows', depth: 100,
      load_async_ai_overview: true, expand_ai_overview: true,
    }),
  ]);

  const aiModeSlot = extractCitationsFromDfsResult(aiMode.result);
  const serpNoSlot = extractCitationsFromDfsResult(serpNoExpand.result);
  const serpExpSlot = extractCitationsFromDfsResult(serpExpand.result);
  const serpHasAioFlag = (serpNoExpand.result?.item_types || []).includes('ai_overview');

  return {
    keyword,
    ai_mode: {
      present: aiModeSlot.present,
      alan: aiModeSlot.alan_citations_count,
      total: aiModeSlot.total_citations,
      urls: aiModeSlot.alan_citations.map((c) => c.url),
      err: aiMode.task?.status_message,
    },
    serp_no_expand: {
      aio_flag: serpHasAioFlag,
      alan: serpNoSlot.alan_citations_count,
      total: serpNoSlot.total_citations,
    },
    serp_expand: {
      present: serpExpSlot.present,
      alan: serpExpSlot.alan_citations_count,
      total: serpExpSlot.total_citations,
      urls: serpExpSlot.alan_citations.map((c) => c.url),
    },
  };
}

const results = [];
for (const kw of keywords) {
  process.stderr.write(`Probing: ${kw}...\n`);
  results.push(await probeKeyword(kw));
  await new Promise((r) => setTimeout(r, 300));
}

let aiModeAlanKw = 0;
let aiModeAlanTotal = 0;
let serpExpAlanKw = 0;
let serpExpAlanTotal = 0;
let unionAlanKw = 0;

for (const r of results) {
  if (r.ai_mode.alan > 0) { aiModeAlanKw++; aiModeAlanTotal += r.ai_mode.alan; }
  if (r.serp_expand.alan > 0) { serpExpAlanKw++; serpExpAlanTotal += r.serp_expand.alan; }
  if (r.ai_mode.alan > 0 || r.serp_expand.alan > 0) unionAlanKw++;
}

console.log(JSON.stringify({
  checked_at: new Date().toISOString(),
  keywords_checked: results.length,
  summary: {
    ai_mode_keywords_with_alan_citations: aiModeAlanKw,
    ai_mode_total_alan_citations: aiModeAlanTotal,
    serp_aio_expand_keywords_with_alan_citations: serpExpAlanKw,
    serp_aio_expand_total_alan_citations: serpExpAlanTotal,
    union_keywords_with_any_alan_citation: unionAlanKw,
  },
  per_keyword: results,
}, null, 2));

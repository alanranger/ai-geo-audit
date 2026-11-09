/**
 * Live check of flipped keywords (x-dfs-context: test): one DataForSEO organic live/advanced capture per
 * keyword with the production payload (GBP pin for Local, depth 50, AI Overview on), then
 *   - new matcher (parseSerpResult) vs
 *   - a manual check written independently: breadcrumb / website_name host for organic, cid or title for
 *     the local pack, source / domain for AI-overview references.
 * Spend gate: refuses over $1 unless --dfs_approval=QUESTION-… is given. Raw responses saved locally.
 *
 *   node scripts/live-check-flipped-keywords.mjs --keywords="photographer in coventry|property photographer"
 */
import fs from 'node:fs';
import { config as dotenvConfig } from 'dotenv';
import { parseSerpResult } from '../lib/keyword-ranking/parse-serp-result.js';
import { loadRedirectLookups } from '../lib/keyword-ranking/redirect-lookups.js';
import { resolveLocalCaptureFields } from '../lib/keyword-ranking/local-capture-preflight.js';
import { getBusinessCid, getBusinessDevice } from '../lib/keyword-ranking/business-location.js';
import { batchEstimateUsd, dfsApprovalGate } from '../lib/keyword-ranking/dfs-approval-gate.js';

dotenvConfig({ path: '.env.local', quiet: true });

const ROOT = 'alanranger.com';
const OUT_DIR = 'outputs/_serp-instability/live';
const arg = (name, dflt) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=') || dflt;
const auth = () => Buffer.from(`${process.env.DATAFORSEO_API_LOGIN || process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_API_PASSWORD || process.env.DATAFORSEO_PASSWORD}`).toString('base64');

function payload(keyword) {
  const cap = resolveLocalCaptureFields(keyword);
  const local = cap.tier === 'L';
  const device = local ? getBusinessDevice() : 'desktop';
  const p = { keyword, language_code: 'en', device, os: device === 'desktop' ? 'windows' : 'android', depth: 50,
    load_async_ai_overview: true, expand_ai_overview: true, tag: 'live-check-test' };
  if (cap.location_code != null) p.location_code = cap.location_code;
  else p.location_name = cap.location_name;
  if (cap.location_coordinate) p.location_coordinate = cap.location_coordinate;
  return p;
}

/** Independent of the matcher: read our site straight off the fields Google shows. */
function manualCheck(items) {
  const ourHost = (s) => /(^|[/.])alanranger\.com\b/i.test(String(s || ''));
  const organic = items.filter((i) => i.type === 'organic' && (ourHost(i.breadcrumb) || /^alan ranger/i.test(i.website_name || '')));
  const pack = items.filter((i) => i.type === 'local_pack' && (String(i.cid || '') === getBusinessCid() || /^alan ranger/i.test(i.title || '')));
  const aio = items.find((i) => i.type === 'ai_overview');
  const refs = (aio?.references || []).filter((r) => /^alan ranger/i.test(r.source || '') || ourHost(r.domain));
  return {
    organic_rank: organic.length ? Math.min(...organic.map((i) => i.rank_group)) : null,
    pack_position: pack.length ? pack[0].rank_group : null,
    aio_citations: refs.length,
    goto_share: `${items.filter((i) => /google\.com\/goto/.test(String(i.url || ''))).length}/${items.length}`,
  };
}

async function capture(keyword) {
  const r = await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/advanced', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth()}` }, body: JSON.stringify([payload(keyword)]),
  });
  const data = await r.json();
  fs.writeFileSync(`${OUT_DIR}/${keyword.replace(/\W+/g, '-')}.json`, JSON.stringify(data));
  return data;
}

function checkRow(kw, data, lookups) {
  const result = data?.tasks?.[0]?.result?.[0];
  if (!result) return { keyword: kw, error: data?.tasks?.[0]?.status_message || data?.status_message };
  const p = parseSerpResult(result, ROOT, lookups);
  return { keyword: kw, checked_at: result.datetime, manual: manualCheck(result.items || []),
    matcher: { organic_rank: p.best_rank_group, best_url: p.best_url, pack_position: p.surfaces.local_pack_position, aio_citations: p.ai_overview_citations.alan_citations_count } };
}

async function main() {
  const keywords = arg('keywords', '').split('|').map((k) => k.trim()).filter(Boolean);
  const gate = dfsApprovalGate({ estimateUsd: batchEstimateUsd({ keywordCount: keywords.length, aiOverview: true }), context: 'test', approval: arg('dfs_approval', '') });
  console.log('dfs gate:', JSON.stringify(gate));
  if (!gate.ok) process.exit(2);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const lookups = await loadRedirectLookups(ROOT);
  const rows = [];
  let cost = 0;
  for (const kw of keywords) {
    const data = await capture(kw);
    cost += Number(data?.cost || 0);
    rows.push(checkRow(kw, data, lookups));
  }
  fs.writeFileSync(`${OUT_DIR}/summary.json`, JSON.stringify({ cost_usd: cost, rows }, null, 2));
  console.log(JSON.stringify({ cost_usd: Math.round(cost * 10000) / 10000, rows }, null, 2));
}

await main();

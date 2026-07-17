/**
 * Capture one tracked keyword into keyword_rankings for an audit date.
 * Usage: node scripts/capture-single-keyword-rank.mjs "best photography workshops uk" [--date=2026-07-17]
 */
import { config as dotenvConfig } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { fetchSerpForKeyword } from '../api/aigeo/serp-rank-test.js';
import { resolveTrackingLocation } from '../lib/keyword-ranking/tracking-location.js';
import { loadExistingLockedByKeyword } from '../lib/keyword-ranking/locked-config-persist.js';
import { normalizeTrackingKey } from '../lib/keyword-ranking/locked-config-merge.js';

dotenvConfig({ path: '.env.local' });

const PROPERTY = 'https://www.alanranger.com';
const keyword = process.argv[2];
const dateArg = process.argv.find((a) => a.startsWith('--date='));
const auditDate = dateArg ? dateArg.slice('--date='.length) : '2026-07-17';
if (!keyword) throw new Error('keyword required');

const login = process.env.DATAFORSEO_API_LOGIN || process.env.DATAFORSEO_LOGIN;
const password = process.env.DATAFORSEO_API_PASSWORD || process.env.DATAFORSEO_PASSWORD;
if (!login || !password) throw new Error('Missing DFS creds');
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing Supabase');

const byKeyword = loadExistingLockedByKeyword();
const rowCfg = byKeyword[normalizeTrackingKey(keyword)];
if (!rowCfg) throw new Error(`Keyword not in locked config: ${keyword}`);

const auth = Buffer.from(`${login}:${password}`).toString('base64');
const loc = resolveTrackingLocation(keyword);
const serp = await fetchSerpForKeyword(keyword, {
  auth,
  depth: 50,
  ai_overview: true,
  location_name: loc.location_name,
});

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
if (serp?.error || serp?.fatal) {
  console.error(JSON.stringify({ ok: false, serpError: serp.error || serp.fatal || serp.msg, serp }, null, 2));
  process.exit(1);
}

const payload = {
  property_url: PROPERTY,
  audit_date: auditDate,
  keyword,
  keyword_class: rowCfg.keyword_class,
  location_name: loc.location_name,
  best_rank_group: serp.best_rank_group ?? null,
  best_rank_absolute: serp.best_rank_absolute ?? null,
  best_url: serp.best_url ?? null,
  best_title: serp.best_title ?? null,
  has_ai_overview: !!serp.has_ai_overview,
  ai_overview_present_any: !!serp.ai_overview_present_any,
  serp_features: serp.serp_features ?? null,
  serp_surface_stack: serp.serp_surface_stack ?? null,
  ai_alan_citations: serp.ai_alan_citations ?? null,
  ai_alan_citations_count: Array.isArray(serp.ai_alan_citations) ? serp.ai_alan_citations.length : 0,
  location_coordinate: serp.location_coordinate ?? null,
  last_refreshed_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const { data, error } = await sb
  .from('keyword_rankings')
  .upsert(payload, { onConflict: 'property_url,audit_date,keyword' })
  .select('keyword,best_rank_group,best_rank_absolute,best_url,has_ai_overview,ai_alan_citations_count')
  .single();
if (error) throw new Error(error.message);

console.log(JSON.stringify({
  ok: true,
  auditDate,
  cost_estimate_usd: 0.002,
  dfs_cost: serp.cost ?? null,
  saved: data,
  aio: {
    present: !!serp.has_ai_overview || !!serp.ai_overview_present_any,
    citations: Array.isArray(serp.ai_alan_citations) ? serp.ai_alan_citations.length : 0,
  },
}, null, 2));

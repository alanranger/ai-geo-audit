/**
 * Resume null-stack re-fetch for remaining 2026-10-05 keywords (batch size 3).
 *   node scripts/rerun-null-stack-keywords-resume.mjs
 */
import { config as dotenvConfig } from 'dotenv';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

dotenvConfig({ path: '.env.local' });

const BASE = process.env.AIGEO_BASE_URL || 'https://ai-geo-audit.vercel.app';
const PROPERTY = 'https://www.alanranger.com';
const AUDIT_DATE = '2026-10-05';
const BATCH = 3;
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'output/rerun-null-stack-resume.json');

const KEYWORDS = [
  'lightroom courses','lightroom courses coventry','linkedin headshots','local photographer',
  'macro photography workshops','online photography classes','online photography course',
  'online photography courses uk','packshot photography','photographer coventry',
  'photographer in coventry','photographer near me','photography classes',
  'photography classes online','photography course online','photography courses',
  'photography courses for beginners','photography courses gloucestershire',
  'photography courses online free','photography courses solihull','photography experience gifts',
  'photography gift card','photography gift voucher','photography gift vouchers',
  'photography holidays uk','photography lessons','photography lessons online',
  'photography mentor','photography presents','photography tutor','photography workshop',
  'photography workshops','photography workshops near me','portrait photographer',
  'portrait photography course','portrait photography workshop','product photographer',
  'product photographer near me','product photography','product photography near me',
  'professional commercial photography','professional headshots','professional headshots near me',
  'professional photographer','professional photographer coventry','professional photographer near me',
  'property photographer','property photographer near me','property photography',
  'real estate photographer','real estate photographer near me','residential photography workshops',
  'rps courses','rps distinctions','still life photographer','team headshots','uk photography workshops'
];

async function postJson(path, body, timeoutMs = 280000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
    if (!r.ok) throw new Error(`${path} ${r.status}: ${text.slice(0, 400)}`);
    return json;
  } finally {
    clearTimeout(t);
  }
}

function chunks(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function toKeywordRow(pk) {
  return {
    audit_date: AUDIT_DATE,
    property_url: PROPERTY,
    keyword: pk.keyword,
    location_name: pk.location_name || null,
    location_unmapped: pk.location_unmapped === true,
    keyword_class: pk.keyword_class || null,
    class_unmapped: pk.class_unmapped === true,
    best_rank_group: pk.best_rank_group ?? null,
    best_rank_absolute: pk.best_rank_absolute ?? null,
    best_url: pk.best_url || null,
    best_title: pk.best_title || null,
    has_ai_overview: !!pk.has_ai_overview,
    ai_overview_present_any: !!pk.ai_overview_present_any,
    local_pack_present_any: !!pk.local_pack_present_any,
    paa_present_any: !!pk.paa_present_any,
    featured_snippet_present_any: !!pk.featured_snippet_present_any,
    local_pack_position: pk.local_pack_position ?? null,
    kp_present: pk.kp_present === true,
    kp_ours: pk.kp_ours === true,
    featured_snippet_ours: pk.featured_snippet_ours === true,
    paa_ours: pk.paa_ours === true,
    search_volume: pk.search_volume ?? null,
    serp_features: pk.serp_features || null,
    serp_surface_stack: pk.serp_surface_stack ?? null,
    serp_depth: pk.serp_depth ?? 50,
    location_code: pk.location_code ?? null,
    location_coordinate: pk.location_coordinate ?? null,
    device: pk.device || 'desktop',
    os: pk.os || 'windows',
    organic_count: pk.organic_count ?? null,
    dfs_cost: pk.dfs_cost ?? null,
    se_results_count: pk.se_results_count ?? null,
    crawl_incomplete: pk.crawl_incomplete === true,
    error: pk.error || null,
    last_refreshed_at: new Date().toISOString(),
  };
}

const log = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')).batches || [] : [];
const batches = chunks(KEYWORDS, BATCH);
console.log(`resume ${KEYWORDS.length} keywords in ${batches.length} batches of ${BATCH}`);

for (let i = 0; i < batches.length; i++) {
  const batch = batches[i];
  console.log(`batch ${i + 1}/${batches.length}: ${batch.join(' | ')}`);
  let serp;
  try {
    serp = await postJson('/api/aigeo/serp-rank-test', { keywords: batch, depth: 50 });
  } catch (e) {
    console.error('SERP fail', e.message);
    // retry one-by-one
    for (const kw of batch) {
      try {
        console.log('  retry single', kw);
        const one = await postJson('/api/aigeo/serp-rank-test', { keywords: [kw], depth: 50 });
        const per = Array.isArray(one?.per_keyword) ? one.per_keyword : [];
        if (!per.length) throw new Error('no per_keyword');
        const keywordRows = per.map(toKeywordRow);
        const saved = await postJson('/api/supabase/save-keyword-batch', {
          propertyUrl: PROPERTY, auditDate: AUDIT_DATE, keywordRows,
        });
        console.log('  saved', kw, saved?.data || saved);
        log.push({ keyword: kw, ok: true, summary: { keyword: kw, rank: per[0].best_rank_absolute, stack: Array.isArray(per[0].serp_surface_stack) ? per[0].serp_surface_stack.length : 0 } });
      } catch (e2) {
        console.error('  single fail', kw, e2.message);
        log.push({ keyword: kw, ok: false, error: e2.message });
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify({ auditDate: AUDIT_DATE, batches: log }, null, 2));
    continue;
  }
  const per = Array.isArray(serp?.per_keyword) ? serp.per_keyword : [];
  const summary = per.map((p) => ({
    keyword: p.keyword,
    rank: p.best_rank_absolute,
    stack: Array.isArray(p.serp_surface_stack) ? p.serp_surface_stack.length : 0,
    org: p.organic_count,
    err: p.error || null,
  }));
  console.log(JSON.stringify(summary));
  try {
    const saved = await postJson('/api/supabase/save-keyword-batch', {
      propertyUrl: PROPERTY, auditDate: AUDIT_DATE, keywordRows: per.map(toKeywordRow),
    });
    log.push({ batch: i + 1, ok: true, summary, saved: saved?.data || saved });
    console.log('saved', saved?.data || saved);
  } catch (e) {
    console.error('SAVE fail', e.message);
    log.push({ batch: i + 1, ok: false, error: e.message, summary });
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ auditDate: AUDIT_DATE, batches: log }, null, 2));
  await new Promise((r) => setTimeout(r, 400));
}

console.log('DONE wrote', OUT);

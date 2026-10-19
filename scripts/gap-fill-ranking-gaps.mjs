/**
 * Re-fetch empty/incomplete/error + unverified-absence keywords via production
 * APIs, patch keyword_rankings, then repair Surface / Top dials.
 *
 *   node scripts/gap-fill-ranking-gaps.mjs --date=2026-10-19
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { listGapFillKeywords } from '../lib/keyword-ranking/gap-fill-empty.js';
import { summarizeSerpCaptureCoverage } from '../lib/keyword-ranking/dfs-serp-quality.js';

const BASE = process.env.AIGEO_BASE_URL || 'https://ai-geo-audit.vercel.app';
const PROPERTY = 'https://www.alanranger.com';
const dateArg = process.argv.find((a) => a.startsWith('--date='));
const AUDIT_DATE = dateArg
  ? dateArg.slice('--date='.length)
  : new Date().toISOString().slice(0, 10);
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'output');
const OUT = join(OUT_DIR, `gap-fill-${AUDIT_DATE}.json`);

async function postJson(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
  if (!r.ok) throw new Error(`${path} ${r.status}: ${text.slice(0, 400)}`);
  return json;
}

async function loadRows() {
  const url = `${BASE}/api/supabase/get-keyword-rankings?propertyUrl=${encodeURIComponent(PROPERTY)}&auditDate=${encodeURIComponent(AUDIT_DATE)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`get-keyword-rankings ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  const rows = j?.data?.keywords || j?.keywords || j?.data || j?.rows || j?.keyword_rankings || [];
  return Array.isArray(rows) ? rows : [];
}

function toKeywordRow(pk, existing = {}) {
  return {
    audit_date: AUDIT_DATE,
    property_url: PROPERTY,
    keyword: pk.keyword,
    location_name: pk.location_name || existing.location_name || null,
    location_unmapped: pk.location_unmapped === true,
    keyword_class: pk.keyword_class || existing.keyword_class || null,
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
    search_volume: pk.search_volume ?? existing.search_volume ?? null,
    serp_features: pk.serp_features || null,
    serp_surface_stack: pk.serp_surface_stack ?? null,
    serp_depth: pk.serp_depth ?? 50,
    location_code: pk.location_code ?? existing.location_code ?? null,
    location_coordinate: pk.location_coordinate ?? existing.location_coordinate ?? null,
    device: pk.device || existing.device || 'desktop',
    os: pk.os || existing.os || 'windows',
    organic_count: pk.organic_count ?? null,
    dfs_cost: pk.dfs_cost ?? null,
    se_results_count: pk.se_results_count ?? null,
    crawl_incomplete: pk.crawl_incomplete === true,
    error: pk.error || null,
    ai_alan_citations: existing.ai_alan_citations ?? null,
    ai_alan_citations_count: existing.ai_alan_citations_count ?? null,
    ai_engines: existing.ai_engines ?? null,
    last_refreshed_at: new Date().toISOString(),
  };
}

const before = await loadRows();
const gaps = listGapFillKeywords(before, 40);
const beforeCov = summarizeSerpCaptureCoverage(before);
console.log(JSON.stringify({
  auditDate: AUDIT_DATE,
  tracked: before.length,
  gaps: gaps.length,
  beforeCov,
}, null, 2));
if (!gaps.length) {
  console.log('No gaps — nothing to do.');
  process.exit(0);
}

const byExisting = new Map(before.map((r) => [String(r.keyword || '').toLowerCase(), r]));
const log = [];

for (let i = 0; i < gaps.length; i++) {
  const keyword = gaps[i];
  console.log(`[${i + 1}/${gaps.length}] ${keyword}`);
  try {
    // Fresh spend_state each keyword so confirm budget is available.
    const serp = await postJson('/api/aigeo/serp-rank-test', {
      keywords: [keyword],
      depth: 50,
      ai_overview: true,
    });
    const per = Array.isArray(serp?.per_keyword) ? serp.per_keyword : [];
    if (!per.length) {
      log.push({ keyword, ok: false, error: 'no_per_keyword' });
      continue;
    }
    const pk = per[0];
    const existing = byExisting.get(keyword.toLowerCase()) || {};
    const row = toKeywordRow(pk, existing);
    const save = await postJson('/api/supabase/save-keyword-batch', {
      propertyUrl: PROPERTY,
      auditDate: AUDIT_DATE,
      keywordRows: [row],
    });
    log.push({
      keyword,
      ok: true,
      capture_status: pk?.serp_features?.capture_status || null,
      confirmation_state: pk?.serp_features?.confirmation_state || null,
      best_rank_group: pk?.best_rank_group ?? null,
      saved: save?.saved ?? save?.status ?? null,
    });
    console.log(
      `  → ${pk?.serp_features?.capture_status || '?'} / ${pk?.serp_features?.confirmation_state || '-'} / rank=${pk?.best_rank_group ?? 'null'}`
    );
  } catch (err) {
    console.error(`  ✗ ${err.message}`);
    log.push({ keyword, ok: false, error: err.message });
  }
}

const after = await loadRows();
const afterCov = summarizeSerpCaptureCoverage(after);
let dials = null;
try {
  dials = await postJson('/api/aigeo/repair-ranking-dials', {
    propertyUrl: PROPERTY,
    auditDate: AUDIT_DATE,
  });
} catch (err) {
  console.error('dial repair failed:', err.message);
}

mkdirSync(OUT_DIR, { recursive: true });
const summary = {
  auditDate: AUDIT_DATE,
  attempted: gaps.length,
  ok: log.filter((x) => x.ok).length,
  failed: log.filter((x) => !x.ok).length,
  beforeCov,
  afterCov,
  dials,
  log,
};
writeFileSync(OUT, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({
  wrote: OUT,
  before: beforeCov,
  after: afterCov,
  dials,
}, null, 2));

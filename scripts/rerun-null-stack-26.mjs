/** Re-fetch current null-stack keywords for 2026-10-05 (batch 3). */
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });

const BASE = 'https://ai-geo-audit.vercel.app';
const PROPERTY = 'https://www.alanranger.com';
const AUDIT_DATE = '2026-10-05';
const KEYWORDS = [
  'best photography course','best photography workshops','best photography workshops uk','business headshots',
  'camera courses coventry','camera courses for beginners','camera courses near me','commercial photographer',
  'commercial photographer coventry','commercial photographer near me','commercial photography services',
  'corporate headshots','corporate photography','corporate photography training','ecommerce product photography',
  'estate agent photographer','evening photography classes','food photographer','food photographer near me',
  'food photography','hire a photographer coventry','photography lessons coventry','photography workshops coventry',
  'still life photographer','team headshots','uk photography workshops'
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
    let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 400) }; }
    if (!r.ok) throw new Error(`${path} ${r.status}: ${text.slice(0, 300)}`);
    return json;
  } finally { clearTimeout(t); }
}

function toRow(pk) {
  return {
    audit_date: AUDIT_DATE, property_url: PROPERTY, keyword: pk.keyword,
    location_name: pk.location_name || null, location_unmapped: pk.location_unmapped === true,
    keyword_class: pk.keyword_class || null, class_unmapped: pk.class_unmapped === true,
    best_rank_group: pk.best_rank_group ?? null, best_rank_absolute: pk.best_rank_absolute ?? null,
    best_url: pk.best_url || null, best_title: pk.best_title || null,
    has_ai_overview: !!pk.has_ai_overview, ai_overview_present_any: !!pk.ai_overview_present_any,
    local_pack_present_any: !!pk.local_pack_present_any, paa_present_any: !!pk.paa_present_any,
    featured_snippet_present_any: !!pk.featured_snippet_present_any,
    local_pack_position: pk.local_pack_position ?? null, kp_present: pk.kp_present === true,
    kp_ours: pk.kp_ours === true, featured_snippet_ours: pk.featured_snippet_ours === true,
    paa_ours: pk.paa_ours === true, search_volume: pk.search_volume ?? null,
    serp_features: pk.serp_features || null, serp_surface_stack: pk.serp_surface_stack ?? null,
    serp_depth: pk.serp_depth ?? 50, location_code: pk.location_code ?? null,
    location_coordinate: pk.location_coordinate ?? null, device: pk.device || 'desktop',
    os: pk.os || 'windows', organic_count: pk.organic_count ?? null, dfs_cost: pk.dfs_cost ?? null,
    se_results_count: pk.se_results_count ?? null, crawl_incomplete: pk.crawl_incomplete === true,
    error: pk.error || null, last_refreshed_at: new Date().toISOString(),
  };
}

for (let i = 0; i < KEYWORDS.length; i += 3) {
  const batch = KEYWORDS.slice(i, i + 3);
  console.log(`batch ${i / 3 + 1}: ${batch.join(' | ')}`);
  try {
    const serp = await postJson('/api/aigeo/serp-rank-test', { keywords: batch, depth: 50 });
    const per = Array.isArray(serp?.per_keyword) ? serp.per_keyword : [];
    console.log(JSON.stringify(per.map((p) => ({
      k: p.keyword, rank: p.best_rank_absolute,
      stack: Array.isArray(p.serp_surface_stack) ? p.serp_surface_stack.length : 0, org: p.organic_count,
    }))));
    const saved = await postJson('/api/supabase/save-keyword-batch', {
      propertyUrl: PROPERTY, auditDate: AUDIT_DATE, keywordRows: per.map(toRow),
    });
    console.log('saved', saved?.data || saved);
  } catch (e) {
    console.error('batch fail', e.message);
    for (const kw of batch) {
      try {
        const one = await postJson('/api/aigeo/serp-rank-test', { keywords: [kw], depth: 50 });
        const per = one?.per_keyword || [];
        if (!per.length) throw new Error('empty');
        await postJson('/api/supabase/save-keyword-batch', {
          propertyUrl: PROPERTY, auditDate: AUDIT_DATE, keywordRows: per.map(toRow),
        });
        console.log('ok', kw);
      } catch (e2) {
        console.error('fail', kw, e2.message);
      }
    }
  }
}
console.log('DONE');

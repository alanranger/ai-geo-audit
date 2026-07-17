/**
 * Backfill AI Mode citation fields onto an existing clean-baseline audit day.
 * Local DFS calls (no Vercel HTTP hop).
 *
 * Usage: node scripts/enrich-clean-baseline-ai-mode.mjs --date=YYYY-MM-DD
 */
import { config as dotenvConfig } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { buildCombinedRows, normalizeKeyword } from '../lib/keyword-ranking/refresh-core.js';
import { fetchAiModeRowsLocal } from '../lib/keyword-ranking/fetch-ai-mode-local.js';

dotenvConfig({ path: '.env.local' });

const PROPERTY = 'https://www.alanranger.com';
const dateArg = process.argv.find((a) => a.startsWith('--date='));
const auditDate = dateArg ? dateArg.slice('--date='.length) : new Date().toISOString().slice(0, 10);

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase credentials');
}

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const { data: rows, error } = await sb
    .from('keyword_rankings')
    .select('*')
    .eq('property_url', PROPERTY)
    .eq('audit_date', auditDate);
  if (error) throw error;
  if (!rows?.length) throw new Error(`No rows for ${auditDate}`);

  console.log(`AI Mode enrich (local) auditDate=${auditDate} keywords=${rows.length}`);
  const aiRows = await fetchAiModeRowsLocal(rows.map((r) => r.keyword), { concurrency: 4 });

  const serpRows = rows.map((r) => ({
    keyword: r.keyword,
    location_name: r.location_name,
    location_code: r.location_code,
    location_coordinate: r.location_coordinate,
    device: r.device,
    os: r.os,
    best_rank_group: r.best_rank_group,
    best_rank_absolute: r.best_rank_absolute,
    best_url: r.best_url,
    best_title: r.best_title,
    has_ai_overview: r.has_ai_overview,
    serp_features: r.serp_features,
    ai_overview_present_any: r.ai_overview_present_any,
    local_pack_present_any: r.local_pack_present_any,
    paa_present_any: r.paa_present_any,
    featured_snippet_present_any: r.featured_snippet_present_any,
    local_pack_position: r.local_pack_position,
    kp_present: r.kp_present,
    kp_ours: r.kp_ours,
    featured_snippet_ours: r.featured_snippet_ours,
    paa_ours: r.paa_ours,
    search_volume: r.search_volume,
    serp_depth: r.serp_depth,
    serp_surface_stack: r.serp_surface_stack,
    local_grid: r.local_grid,
    keyword_class: r.keyword_class,
    class_unmapped: r.class_unmapped,
    ai_overview_citations: r.ai_engines?.google_aio || null,
  }));

  const combined = buildCombinedRows(serpRows, aiRows);
  const byKw = new Map(combined.map((r) => [normalizeKeyword(r.keyword), r]));

  let updated = 0;
  let cited = 0;
  for (const row of rows) {
    const c = byKw.get(normalizeKeyword(row.keyword));
    if (!c) continue;
    const patch = {
      ai_total_citations: c.ai_total_citations ?? 0,
      ai_alan_citations_count: c.ai_alan_citations_count ?? 0,
      ai_alan_citations: c.ai_alan_citations || [],
      ai_engines: c.ai_engines,
      // Keep classic SERP AIO flag (ai_overview_present_any); do not OR AI Mode into it.
      has_ai_overview: Boolean(row.ai_overview_present_any),
    };
    if ((patch.ai_alan_citations_count || 0) > 0) cited += 1;
    const { error: upErr } = await sb
      .from('keyword_rankings')
      .update(patch)
      .eq('property_url', PROPERTY)
      .eq('audit_date', auditDate)
      .eq('keyword', row.keyword);
    if (upErr) throw upErr;
    updated += 1;
  }

  console.log(JSON.stringify({ audit_date: auditDate, updated, cited, ai_rows: aiRows.length }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

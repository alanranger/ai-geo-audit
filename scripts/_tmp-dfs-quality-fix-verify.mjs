/**
 * Post-deploy validation: 3 keywords only, SERP path (no AI Mode), ≤12 DFS calls.
 * Backs up current keyword_rankings rows, refreshes via production serp-rank-test,
 * saves via save-keyword-batch, reads back capture_status.
 */
import { config as dotenvConfig } from 'dotenv';
import { writeFileSync, mkdirSync } from 'node:fs';
import { buildCombinedRows, buildKeywordRows } from '../lib/keyword-ranking/refresh-core.js';

dotenvConfig({ path: '.env.local' });

const OUT = 'C:/Users/alan/Documents/Codex/2026-09-28/when/outputs';
const BASE = process.env.AIGEO_BASE_URL || 'https://www.alanranger.com';
// Prefer explicit Vercel production host for API (Squarespace front may rewrite).
const API_BASE = process.env.AIGEO_API_BASE || 'https://ai-geo-audit.vercel.app';
const PROPERTY = 'https://www.alanranger.com';
const KEYWORDS = [
  'beginners photography courses coventry',
  'free photography classes near me',
  'photography gift card',
];

mkdirSync(OUT, { recursive: true });

async function getKeywordRows() {
  const url = `${API_BASE}/api/supabase/get-keyword-rankings?propertyUrl=${encodeURIComponent(PROPERTY)}&auditDate=${new Date().toISOString().slice(0, 10)}`;
  const res = await fetch(url, { cache: 'no-store' });
  const json = await res.json();
  const rows = json?.data?.keywords || json?.data?.rows || [];
  const want = new Set(KEYWORDS.map((k) => k.toLowerCase()));
  return (rows || []).filter((r) => want.has(String(r.keyword || '').toLowerCase()));
}

async function main() {
  const auditDate = new Date().toISOString().slice(0, 10);
  const before = await getKeywordRows();
  writeFileSync(`${OUT}/dfs-quality-fix-backup-before.json`, JSON.stringify({
    backed_up_at: new Date().toISOString(),
    auditDate,
    rows: before,
  }, null, 2));

  const t0 = Date.now();
  const serpRes = await fetch(`${API_BASE}/api/aigeo/serp-rank-test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keywords: KEYWORDS, depth: 50 }),
  });
  const serpJson = await serpRes.json();
  const per = Array.isArray(serpJson?.per_keyword) ? serpJson.per_keyword : [];
  const combined = buildCombinedRows(per, []);
  const keywordRows = buildKeywordRows(combined, auditDate, PROPERTY, { stampRefreshedAt: true });

  const saveRes = await fetch(`${API_BASE}/api/supabase/save-keyword-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keywordRows, auditDate, propertyUrl: PROPERTY }),
  });
  const saveJson = await saveRes.json().catch(() => ({}));

  // Brief settle then read back
  await new Promise((r) => setTimeout(r, 1500));
  const after = await getKeywordRows();

  const summary = {
    generated_at: new Date().toISOString(),
    api_base: API_BASE,
    auditDate,
    duration_ms: Date.now() - t0,
    serp_http: serpRes.status,
    serp_summary: serpJson?.summary || null,
    per_keyword_from_api: per.map((r) => ({
      keyword: r.keyword,
      best_rank_group: r.best_rank_group,
      best_rank_absolute: r.best_rank_absolute,
      best_url: r.best_url,
      crawl_incomplete: r.crawl_incomplete,
      organic_count: r.organic_count,
      dfs_cost: r.dfs_cost,
      se_results_count: r.se_results_count,
      error: r.error || null,
      capture_status: r.serp_features?.capture_status || null,
      serp_depth: r.serp_depth,
      location_code: r.location_code,
      location_coordinate: r.location_coordinate,
      local_pack_position: r.local_pack_position,
    })),
    save_http: saveRes.status,
    save_json: saveJson,
    before: before.map((r) => ({
      keyword: r.keyword,
      best_rank_group: r.best_rank_group,
      best_url: r.best_url,
      capture_status: r.serp_features?.capture_status || null,
      organic_count: r.serp_features?.organic_count ?? null,
      stub: r.serp_features?.stub || false,
      fetch_error: r.serp_features?.fetch_error || null,
      last_refreshed_at: r.last_refreshed_at,
    })),
    after: after.map((r) => ({
      keyword: r.keyword,
      best_rank_group: r.best_rank_group,
      best_rank_absolute: r.best_rank_absolute,
      best_url: r.best_url,
      capture_status: r.serp_features?.capture_status || null,
      organic_count: r.serp_features?.organic_count ?? null,
      dfs_cost: r.serp_features?.dfs_cost ?? null,
      serp_depth_requested: r.serp_features?.serp_depth_requested ?? r.serp_depth,
      geo_method: r.serp_features?.geo_method || null,
      last_good_rank_group: r.serp_features?.last_good_rank_group ?? null,
      last_good_at: r.serp_features?.last_good_at || null,
      stub: r.serp_features?.stub || false,
      fetch_error: r.serp_features?.fetch_error || null,
      last_refreshed_at: r.last_refreshed_at,
      location_code: r.location_code,
      location_coordinate: r.location_coordinate,
    })),
    estimated_dfs_calls_note: 'serp-rank-test retries up to 3× per keyword on incomplete; budget ≤12 including retries',
    total_dfs_cost_from_rows: per.reduce((s, r) => s + (Number(r.dfs_cost) || 0), 0),
  };

  writeFileSync(`${OUT}/dfs-quality-fix-verify.json`, JSON.stringify(summary, null, 2));
  writeFileSync(`${OUT}/dfs-quality-fix-backup-after.json`, JSON.stringify({
    backed_up_at: new Date().toISOString(),
    auditDate,
    rows: after,
  }, null, 2));
  console.log(JSON.stringify({
    ok: saveRes.ok && serpRes.ok,
    after: summary.after,
    cost: summary.total_dfs_cost_from_rows,
    serp_http: serpRes.status,
    save_http: saveRes.status,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

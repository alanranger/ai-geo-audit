/**
 * 5×5 GBP grid rescan for Local-tier local-money keywords.
 * Usage:
 *   node scripts/local-grid-rescan.mjs --spot   # 3 keywords proof (~$0.60)
 *   node scripts/local-grid-rescan.mjs          # full 64 (~$12.80)
 *   node scripts/local-grid-rescan.mjs --dry-run
 */

import { config as dotenvConfig } from 'dotenv';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { parseCsvLine } from '../lib/keyword-ranking/parse-tracking-csv.js';
import { resolveTrackingLocation } from '../lib/keyword-ranking/tracking-location.js';
import { fetchLocalGridSerp } from '../lib/keyword-ranking/fetch-local-grid-serp.js';
import { buildLocalGridPoints, getGridConfig } from '../lib/keyword-ranking/business-location.js';
import { computeSurfaceVisibilityRollup } from '../lib/audit/surfaceScores.js';
import { computeTopOfPageRollup } from '../lib/audit/topOfPage.js';
import { resolveRowsClassificationAtRender } from '../lib/keyword-ranking/resolve-classification-at-render.js';

dotenvConfig({ path: '.env.local' });

const PROPERTY = 'https://www.alanranger.com';
const TARGET_ROOT = 'alanranger.com';
const DEPTH = 50;
const dryRun = process.argv.includes('--dry-run');
const spotOnly = process.argv.includes('--spot');
const SPOT_KEYWORDS = [
  'photographer in coventry',
  'photography classes coventry',
  'photographer coventry',
];
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const login = process.env.DATAFORSEO_API_LOGIN || process.env.DATAFORSEO_LOGIN;
const password = process.env.DATAFORSEO_API_PASSWORD || process.env.DATAFORSEO_PASSWORD;
if (!login || !password) throw new Error('Missing DataForSEO credentials');
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase credentials');
}

const auth = Buffer.from(`${login}:${password}`).toString('base64');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function loadLocalTierKeywords() {
  const lines = readFileSync(join(root, 'config/keyword-tracking-locations-and-class-LOCKED-v4.csv'), 'utf8')
    .trim().split(/\r?\n/).slice(1);
  return lines
    .filter((line) => {
      const f = parseCsvLine(line);
      return String(f[1] || '').toLowerCase() === 'local'
        && String(f[3] || '').toLowerCase() === 'local-money';
    })
    .map((line) => parseCsvLine(line)[0])
    .filter(Boolean);
}

async function getAuditDate() {
  const { data, error } = await sb
    .from('keyword_rankings')
    .select('audit_date')
    .eq('property_url', PROPERTY)
    .not('serp_surface_stack', 'is', null)
    .order('audit_date', { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0]?.audit_date;
}

async function loadAllRows(auditDate) {
  const { data, error } = await sb
    .from('keyword_rankings')
    .select('*')
    .eq('property_url', PROPERTY)
    .eq('audit_date', auditDate);
  if (error) throw error;
  return resolveRowsClassificationAtRender(data || []);
}

function roundRankInt(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return Math.round(Number(value));
}

function rowPatchFromGrid(serp, loc) {
  return {
    best_rank_group: roundRankInt(serp.best_rank_group),
    best_rank_absolute: roundRankInt(serp.best_rank_absolute),
    best_url: serp.best_url,
    best_title: serp.best_title,
    has_ai_overview: serp.has_ai_overview,
    serp_features: serp.serp_features,
    ai_overview_present_any: serp.ai_overview_present_any,
    local_pack_present_any: serp.local_pack_present_any,
    paa_present_any: serp.paa_present_any,
    featured_snippet_present_any: serp.featured_snippet_present_any,
    local_pack_position: roundRankInt(serp.local_pack_position),
    kp_present: serp.kp_present,
    kp_ours: serp.kp_ours,
    featured_snippet_ours: serp.featured_snippet_ours,
    paa_ours: serp.paa_ours,
    serp_surface_stack: serp.serp_surface_stack,
    local_grid: serp.local_grid,
    location_name: serp.location_name || loc.location_name,
    location_code: serp.location_code ?? loc.location_code ?? null,
    location_coordinate: serp.location_coordinate ?? null,
    device: serp.device ?? null,
    os: serp.os ?? null,
    serp_depth: serp.serp_depth ?? DEPTH,
    last_refreshed_at: new Date().toISOString(),
  };
}

async function main() {
  const cfg = getGridConfig();
  const points = buildLocalGridPoints();
  const allLocal = loadLocalTierKeywords();
  const keywords = spotOnly ? SPOT_KEYWORDS : allLocal;
  const auditDate = await getAuditDate();
  const estCost = keywords.length * points.length * 0.008;
  console.error(JSON.stringify({
    auditDate, keywords: keywords.length, points: points.length, cfg, estCost, dryRun, spotOnly,
  }));

  const beforeRows = await loadAllRows(auditDate);
  const beforeRollup = computeSurfaceVisibilityRollup(beforeRows);
  const beforeTop = computeTopOfPageRollup(beforeRows);

  const rescanned = [];
  let cost = 0;
  for (let i = 0; i < keywords.length; i += 1) {
    const keyword = keywords[i];
    const loc = resolveTrackingLocation(keyword);
    console.error(`[${i + 1}/${keywords.length}] GRID ${keyword}`);
    const serp = await fetchLocalGridSerp(keyword, auth, TARGET_ROOT, DEPTH, {
      location_name: loc.location_name,
      location_code: loc.location_code,
      tier: loc.tier,
    });
    cost += serp.grid_cost_usd || (points.length * 0.008);
    if (serp?.error) console.error('  error:', serp.error);
    else {
      console.error(`  pack avg=${serp.local_grid?.pack?.average_position} cov=${serp.local_grid?.pack?.present_count}/${points.length} org avg=${serp.local_grid?.organic?.average_position}`);
    }
    rescanned.push({ keyword, serp, loc });
  }

  if (!dryRun) {
    for (const { keyword, serp, loc } of rescanned) {
      if (serp?.error && !serp.local_grid) continue;
      const patch = rowPatchFromGrid(serp, loc);
      const { error } = await sb
        .from('keyword_rankings')
        .update(patch)
        .eq('property_url', PROPERTY)
        .eq('audit_date', auditDate)
        .eq('keyword', keyword);
      if (error) throw new Error(`Update failed for ${keyword}: ${error.message}`);
    }
  }

  const afterRows = dryRun
    ? beforeRows.map((row) => {
      const hit = rescanned.find((r) => r.keyword.toLowerCase() === row.keyword.toLowerCase());
      if (!hit) return row;
      return { ...row, ...rowPatchFromGrid(hit.serp, hit.loc) };
    })
    : await loadAllRows(auditDate);

  const afterRollup = computeSurfaceVisibilityRollup(afterRows);
  const afterTop = computeTopOfPageRollup(afterRows);

  const spot = rescanned.map(({ keyword, serp }) => ({
    keyword,
    pack_avg: serp.local_grid?.pack?.average_position ?? null,
    pack_best: serp.local_grid?.pack?.best_position ?? null,
    pack_coverage: serp.local_grid?.pack?.present_count ?? 0,
    organic_avg: serp.local_grid?.organic?.average_position ?? null,
    organic_best: serp.local_grid?.organic?.best_position ?? null,
    organic_coverage: serp.local_grid?.organic?.present_count ?? 0,
  }));

  const report = {
    mode: spotOnly ? 'spot' : 'full',
    audit_date: auditDate,
    grid: cfg,
    sample_points: points.filter((_, i) => i % 6 === 0 || i === 12),
    keywords_rescanned: keywords.length,
    dfs_calls: keywords.length * points.length,
    actual_cost_usd: Math.round(cost * 1000) / 1000,
    estimated_cost_usd: Math.round(estCost * 1000) / 1000,
    cadence_proposal: 'Full 5×5 grid monthly (or after GBP/major change). Interim audits keep single GBP pin. National/brand never grid.',
    baseline_rebase: {
      surface_visibility_baseline_date: '2026-07-16',
      top_of_page_baseline_date: '2026-07-16',
      note: 'Flagged rebase after grid capture — not silent',
    },
    before: {
      surface_visibility: {
        overall: beforeRollup.overall,
        local: beforeRollup.byClass['local-money']?.score,
      },
      top_of_page: {
        overall: beforeTop.overall,
        local: beforeTop.byClass['local-money']?.score,
      },
    },
    after: {
      surface_visibility: {
        overall: afterRollup.overall,
        local: afterRollup.byClass['local-money']?.score,
      },
      top_of_page: {
        overall: afterTop.overall,
        local: afterTop.byClass['local-money']?.score,
      },
    },
    spot_check: spot,
    dry_run: dryRun,
  };

  mkdirSync(join(root, 'scripts/output'), { recursive: true });
  const outPath = join(root, `scripts/output/local-grid-rescan-${spotOnly ? 'spot' : 'full'}-2026-07-16.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

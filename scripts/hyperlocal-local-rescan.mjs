/**
 * Step 4 — Hyperlocal Local-tier rescan + BEFORE/AFTER dial report.
 * Alan green-light 2026-07-16. Local-tier local-money only (64 kw); UK-tracked
 * local-money (e.g. photography workshops coventry) unchanged.
 *
 * Usage: node scripts/hyperlocal-local-rescan.mjs [--dry-run]
 */

import { config as dotenvConfig } from 'dotenv';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { parseCsvLine } from '../lib/keyword-ranking/parse-tracking-csv.js';
import { fetchSerpForKeyword } from '../api/aigeo/serp-rank-test.js';
import { resolveTrackingLocation } from '../lib/keyword-ranking/tracking-location.js';
import { computeSurfaceVisibilityRollup } from '../lib/audit/surfaceScores.js';
import { computeTopOfPageRollup } from '../lib/audit/topOfPage.js';
import { resolveRowsClassificationAtRender } from '../lib/keyword-ranking/resolve-classification-at-render.js';
import { applyTrackedEmptySerpStubs } from '../lib/keyword-ranking/empty-serp-stub.js';

dotenvConfig({ path: '.env.local' });

const PROPERTY = 'https://www.alanranger.com';
const TARGET_ROOT = 'alanranger.com';
const DEPTH = 50;
const COST_PER_CALL = 0.008;
const dryRun = process.argv.includes('--dry-run');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const login = process.env.DATAFORSEO_API_LOGIN || process.env.DATAFORSEO_LOGIN;
const password = process.env.DATAFORSEO_API_PASSWORD || process.env.DATAFORSEO_PASSWORD;
if (!login || !password) throw new Error('Missing DataForSEO credentials in .env.local');
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

function packWasAbsent(row) {
  if (row?.local_pack_position != null && Number(row.local_pack_position) > 0) return false;
  const stack = Array.isArray(row?.serp_surface_stack) ? row.serp_surface_stack : [];
  const pack = stack.find((e) => e?.type === 'local_pack');
  return !(pack?.ours === true || pack?.our_position != null);
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
  return data?.[0]?.audit_date || '2026-07-14';
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

function rowPatchFromSerp(serp, loc) {
  return {
    best_rank_group: serp.best_rank_group,
    best_rank_absolute: serp.best_rank_absolute,
    best_url: serp.best_url,
    best_title: serp.best_title,
    has_ai_overview: serp.has_ai_overview,
    serp_features: serp.serp_features,
    ai_overview_present_any: serp.ai_overview_present_any,
    local_pack_present_any: serp.local_pack_present_any,
    paa_present_any: serp.paa_present_any,
    featured_snippet_present_any: serp.featured_snippet_present_any,
    local_pack_position: serp.local_pack_position,
    kp_present: serp.kp_present,
    kp_ours: serp.kp_ours,
    featured_snippet_ours: serp.featured_snippet_ours,
    paa_ours: serp.paa_ours,
    serp_surface_stack: serp.serp_surface_stack,
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
  const keywords = loadLocalTierKeywords();
  const auditDate = await getAuditDate();
  console.error(`Audit date: ${auditDate}; Local-tier keywords: ${keywords.length}; dryRun=${dryRun}`);

  const beforeRows = await loadAllRows(auditDate);
  const beforeByKw = new Map(beforeRows.map((r) => [r.keyword.toLowerCase(), r]));
  const beforeRollup = computeSurfaceVisibilityRollup(beforeRows);
  const beforeTop = computeTopOfPageRollup(beforeRows);

  const rescanned = [];
  let cost = 0;
  for (let i = 0; i < keywords.length; i += 1) {
    const keyword = keywords[i];
    const loc = resolveTrackingLocation(keyword);
    console.error(`[${i + 1}/${keywords.length}] ${keyword}`);
    const serp = await fetchSerpForKeyword(keyword, auth, TARGET_ROOT, DEPTH, {
      location_name: loc.location_name,
      location_code: loc.location_code,
      tier: loc.tier,
    });
    cost += COST_PER_CALL;
    if (serp?.error) console.error('  error:', serp.error);
    rescanned.push({ keyword, serp, loc });
    await new Promise((r) => setTimeout(r, 400));
  }

  const packChanges = [];
  for (const { keyword, serp } of rescanned) {
    const before = beforeByKw.get(keyword.toLowerCase());
    const wasAbsent = before ? packWasAbsent(before) : true;
    const nowPresent = serp.local_pack_position != null && Number(serp.local_pack_position) > 0;
    if (wasAbsent && nowPresent) {
      packChanges.push({ keyword, before: null, after: serp.local_pack_position });
    } else if (before?.local_pack_position !== serp.local_pack_position) {
      packChanges.push({
        keyword,
        before: before?.local_pack_position ?? null,
        after: serp.local_pack_position ?? null,
      });
    }
  }

  if (!dryRun) {
    // Never write bare empties — same stub gate as save-keyword-batch / cron.
    const stubbed = applyTrackedEmptySerpStubs(
      rescanned.map(({ keyword, serp, loc }) => ({
        keyword,
        ...rowPatchFromSerp(serp, loc),
        error: serp?.error || null,
      }))
    );
    for (const row of stubbed) {
      const { error: _gate, ...patch } = row;
      if (!Array.isArray(patch.serp_surface_stack) || patch.serp_surface_stack.length === 0) {
        patch.serp_surface_stack = null;
      }
      const { error } = await sb
        .from('keyword_rankings')
        .update(patch)
        .eq('property_url', PROPERTY)
        .eq('audit_date', auditDate)
        .eq('keyword', row.keyword);
      if (error) {
        const fallback = { ...patch };
        delete fallback.location_coordinate;
        delete fallback.location_code;
        delete fallback.device;
        delete fallback.os;
        delete fallback.serp_depth;
        const { error: err2 } = await sb
          .from('keyword_rankings')
          .update(fallback)
          .eq('property_url', PROPERTY)
          .eq('audit_date', auditDate)
          .eq('keyword', row.keyword);
        if (err2) throw new Error(`Update failed for ${row.keyword}: ${err2.message}`);
        console.error(`  metadata columns skipped (${error.message})`);
      }
    }
  }

  const afterRows = dryRun
    ? beforeRows.map((row) => {
      const hit = rescanned.find((r) => r.keyword.toLowerCase() === row.keyword.toLowerCase());
      if (!hit) return row;
      return { ...row, ...rowPatchFromSerp(hit.serp, hit.loc) };
    })
    : await loadAllRows(auditDate);

  const afterRollup = computeSurfaceVisibilityRollup(afterRows);
  const afterTop = computeTopOfPageRollup(afterRows);

  const spotCheck = ['photographer coventry', 'photographer in coventry'].map((kw) => {
    const r = rescanned.find((x) => x.keyword.toLowerCase() === kw);
    return {
      keyword: kw,
      pack: r?.serp?.local_pack_position ?? null,
      organic: r?.serp?.best_rank_group ?? null,
    };
  });

  const report = {
    audit_date: auditDate,
    keywords_rescanned: keywords.length,
    actual_cost_usd: Math.round(cost * 1000) / 1000,
    baseline_rebase: {
      surface_visibility_baseline_date: '2026-07-16',
      note: 'SURFACE_VISIBILITY_BASELINE_DATE updated in lib/audit/surfaceScores.js — not silent',
    },
    before: {
      surface_visibility: {
        overall: beforeRollup.overall,
        local: beforeRollup.byClass['local-money']?.score,
        national: beforeRollup.byClass['national-money']?.score,
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
        national: afterRollup.byClass['national-money']?.score,
      },
      top_of_page: {
        overall: afterTop.overall,
        local: afterTop.byClass['local-money']?.score,
      },
    },
    pack_absent_to_present_count: packChanges.filter((p) => p.before == null && p.after != null).length,
    pack_position_changes: packChanges.length,
    pack_changes_sample: packChanges.slice(0, 15),
    spot_check: spotCheck,
    dry_run: dryRun,
  };

  const outPath = join(root, 'scripts/output/hyperlocal-rescan-report-2026-07-16.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

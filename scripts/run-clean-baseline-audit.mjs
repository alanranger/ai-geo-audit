/**
 * One clean keyword baseline: replace-a-day, single-pin hyperlocal for Local-tier,
 * stub empty stacks, no 5×5 grid.
 *
 * Usage: node scripts/run-clean-baseline-audit.mjs [--date=YYYY-MM-DD]
 */
import { config as dotenvConfig } from 'dotenv';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { parseCsvLine } from '../lib/keyword-ranking/parse-tracking-csv.js';
import { fetchSerpForKeyword } from '../api/aigeo/serp-rank-test.js';
import { resolveTrackingLocation } from '../lib/keyword-ranking/tracking-location.js';
import { resolveKeywordClass } from '../lib/keyword-ranking/tracking-class.js';
import { applyTrackedEmptySerpStubs } from '../lib/keyword-ranking/empty-serp-stub.js';
import { coalesceSearchVolume } from '../lib/keyword-ranking/ke-search-volumes.js';
import { getHyperlocalCoordinate, getBusinessDevice } from '../lib/keyword-ranking/business-location.js';

dotenvConfig({ path: '.env.local' });

const PROPERTY = 'https://www.alanranger.com';
const TARGET_ROOT = 'alanranger.com';
const DEPTH = 50;
const CONCURRENCY = 4;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dateArg = process.argv.find((a) => a.startsWith('--date='));
const auditDate = dateArg ? dateArg.slice('--date='.length) : new Date().toISOString().slice(0, 10);

const login = process.env.DATAFORSEO_API_LOGIN || process.env.DATAFORSEO_LOGIN;
const password = process.env.DATAFORSEO_API_PASSWORD || process.env.DATAFORSEO_PASSWORD;
if (!login || !password) throw new Error('Missing DataForSEO credentials');
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase credentials');
}

const auth = Buffer.from(`${login}:${password}`).toString('base64');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function loadLockedKeywords() {
  const lines = readFileSync(
    join(root, 'config/keyword-tracking-locations-and-class-LOCKED-v4.csv'),
    'utf8'
  ).trim().split(/\r?\n/).slice(1);
  return lines.map((line) => {
    const f = parseCsvLine(line);
    return {
      keyword: String(f[0] || '').trim(),
      tracking_location: String(f[1] || '').trim(),
      keyword_class: String(f[3] || '').trim(),
    };
  }).filter((r) => r.keyword);
}

async function mapPool(items, limit, worker) {
  const out = new Array(items.length);
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i;
      i += 1;
      out[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return out;
}

async function main() {
  const locked = loadLockedKeywords();
  if (locked.length !== 120) {
    throw new Error(`Expected 120 locked keywords, got ${locked.length}`);
  }
  console.log(`Clean baseline auditDate=${auditDate} keywords=${locked.length} depth=${DEPTH} grid=OFF`);

  const { error: delErr, count: deleted } = await sb
    .from('keyword_rankings')
    .delete({ count: 'exact' })
    .eq('property_url', PROPERTY)
    .eq('audit_date', auditDate);
  if (delErr) throw delErr;
  console.log(`Deleted existing rows for ${auditDate}: ${deleted ?? 0}`);

  const serpRows = await mapPool(locked, CONCURRENCY, async (row, idx) => {
    const loc = resolveTrackingLocation(row.keyword);
    console.log(`[${idx + 1}/${locked.length}] ${row.keyword} tier=${loc.tier}`);
    const serp = await fetchSerpForKeyword(row.keyword, auth, TARGET_ROOT, DEPTH, {
      location_name: loc.location_name,
      location_code: loc.location_code,
      tier: loc.tier,
    });
    const cls = resolveKeywordClass(row.keyword);
    return {
      audit_date: auditDate,
      property_url: PROPERTY,
      keyword: row.keyword,
      best_rank_group: serp?.best_rank_group ?? null,
      best_rank_absolute: serp?.best_rank_absolute ?? null,
      best_url: serp?.best_url ?? null,
      best_title: serp?.best_title ?? null,
      has_ai_overview: serp?.has_ai_overview === true,
      ai_total_citations: serp?.ai_total_citations ?? null,
      ai_alan_citations_count: serp?.ai_alan_citations_count ?? null,
      ai_alan_citations: serp?.ai_alan_citations ?? null,
      serp_features: serp?.serp_features || {},
      ai_overview_present_any: serp?.ai_overview_present_any === true,
      local_pack_present_any: serp?.local_pack_present_any === true,
      paa_present_any: serp?.paa_present_any === true,
      featured_snippet_present_any: serp?.featured_snippet_present_any === true,
      local_pack_position: serp?.local_pack_position ?? null,
      kp_present: serp?.kp_present === true,
      kp_ours: serp?.kp_ours === true,
      featured_snippet_ours: serp?.featured_snippet_ours === true,
      paa_ours: serp?.paa_ours === true,
      search_volume: coalesceSearchVolume(row.keyword, serp?.search_volume ?? null),
      serp_depth: serp?.serp_depth ?? DEPTH,
      location_name: serp?.location_name || loc.location_name,
      location_code: serp?.location_code ?? loc.location_code ?? null,
      location_coordinate: serp?.location_coordinate ?? null,
      device: serp?.device ?? null,
      os: serp?.os ?? null,
      serp_surface_stack: Array.isArray(serp?.serp_surface_stack) ? serp.serp_surface_stack : null,
      keyword_class: cls.keyword_class,
      class_unmapped: cls.class_unmapped,
      error: serp?.error || null,
      local_grid: null,
    };
  });

  const pin = getHyperlocalCoordinate();
  const device = getBusinessDevice();
  const stubbed = applyTrackedEmptySerpStubs(serpRows).map((row) => {
    const { error: _e, ...dbRow } = row;
    if (!Array.isArray(dbRow.serp_surface_stack) || dbRow.serp_surface_stack.length === 0) {
      dbRow.serp_surface_stack = null;
    }
    // Local-tier empties must still carry the GBP pin (gate 5), even when DFS returns nothing.
    if (resolveTrackingLocation(dbRow.keyword).tier === 'L') {
      if (!dbRow.location_coordinate) dbRow.location_coordinate = pin;
      if (!dbRow.device) dbRow.device = device;
      if (!dbRow.os && device === 'desktop') dbRow.os = 'windows';
    }
    return dbRow;
  });

  const { error: upErr } = await sb.from('keyword_rankings').upsert(stubbed, {
    onConflict: 'audit_date,property_url,keyword',
  });
  if (upErr) throw upErr;

  const ranked = stubbed.filter((r) => Array.isArray(r.serp_surface_stack) && r.serp_surface_stack.length > 0).length;
  const stubs = stubbed.filter((r) => r.serp_features?.stub === true).length;
  const hyperlocal = stubbed.filter((r) => String(r.location_coordinate || '').includes('52.3991769')).length;
  const grid = stubbed.filter((r) => r.local_grid != null).length;
  const report = {
    audit_date: auditDate,
    total: stubbed.length,
    ranked,
    stubs,
    hyperlocal_pins: hyperlocal,
    grid_rows: grid,
    six_watch: [
      'beginners photography classes coventry',
      'beginners photography lessons coventry',
      'camera courses coventry',
      'commercial photographer coventry',
      'hire a professional photographer coventry',
      'photography lessons coventry',
    ].map((kw) => {
      const r = stubbed.find((x) => x.keyword.toLowerCase() === kw);
      return {
        keyword: kw,
        ranked: Array.isArray(r?.serp_surface_stack) && r.serp_surface_stack.length > 0,
        stub: r?.serp_features?.stub === true,
        coord: r?.location_coordinate || null,
        rank: r?.best_rank_group ?? null,
      };
    }),
  };
  mkdirSync(join(root, 'scripts/output'), { recursive: true });
  const out = join(root, `scripts/output/clean-baseline-${auditDate}.json`);
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`Wrote ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

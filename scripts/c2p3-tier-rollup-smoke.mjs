// Phase C / C2 part 3 -- tier rollup smoke test.
//
// Calls the /api/aigeo/revenue-funnel-diagnosis handler twice:
//   1) full universe (no ?pages=) so the page-type filter applies and the
//      tier_rollup gets built across all 9 sellable tiers.
//   2) canary-only with includeAllPages=true so we can confirm the 4 canary
//      slugs still classify identically after the restructure.
//
// Pretty-prints:
//   - category -> tier mapping (canonical_products + unmapped)
//   - tier_filter_meta (counts before/after page-type filter)
//   - all 9 tier rows (revenue trend + GSC aggregate + page-state counts +
//     severity + page count)
//   - the Workshops Residential expanded Level-2 page list (for the
//     verification carve-out)
//   - per-canary verdict with full metrics
//
//   node scripts/c2p3-tier-rollup-smoke.mjs

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });

import handler from '../api/aigeo/revenue-funnel-diagnosis.js';
import { TIER_DEFINITIONS, TIER_ORDER, EXCLUDED_BOOKING_CATEGORIES, EXCLUDED_PRODUCT_CATEGORIES } from '../lib/revenue-tier-mapping.js';

const CANARIES = [
  'private-photography-lessons',
  'photography-workshops',
  'photography-courses-coventry',
  'landscape-photography-workshops'
];

function makeReq(query) { return { method: 'GET', query }; }

function makeRes() {
  const out = { statusCode: null, headers: {}, body: null };
  return {
    setHeader(k, v) { out.headers[k] = v; },
    status(c) { out.statusCode = c; return this; },
    json(b) { out.body = b; return this; },
    _out: out
  };
}

async function callDiagnosis(query) {
  const res = makeRes();
  await handler(makeReq(query), res);
  if (res._out.statusCode !== 200) {
    console.error('FAILED:', res._out.statusCode, JSON.stringify(res._out.body, null, 2));
    process.exit(1);
  }
  return res._out.body;
}

function printMappingTable() {
  console.log('=== CATEGORY -> TIER MAPPING ===\n');
  console.log('canonical_products.category -> revenue tier (9 sellable tiers):');
  for (const tierKey of TIER_ORDER) {
    const def = TIER_DEFINITIONS[tierKey];
    console.log(`  ${def.label}  (booking_category: "${def.bookingCategory}")`);
    if (def.productCategories.length === 0) {
      console.log('    (no canonical_products categories; pages from page-type=academy)');
    } else {
      for (const c of def.productCategories) console.log(`    - "${c}"`);
    }
  }
  console.log('\nEXCLUDED canonical_products categories (do NOT appear in tier headers):');
  for (const c of EXCLUDED_PRODUCT_CATEGORIES) console.log(`  - "${c}"`);
  console.log('\nEXCLUDED booking_sheet category_labels (do NOT appear in tier headers):');
  for (const c of EXCLUDED_BOOKING_CATEGORIES) console.log(`  - "${c}"`);
  console.log('');
}

function fmtRev(c) {
  return `nonJLR=£${(c.non_jlr || 0).toLocaleString('en-GB')}  JLR=£${(c.jlr || 0).toLocaleString('en-GB')}  total=£${(c.total || 0).toLocaleString('en-GB')}  (${c.txn_count} txns)`;
}

function printTierRollup(payload) {
  console.log('=== TIER ROLLUP (Level 1, default view) ===\n');
  console.log(`GSC window: ${payload.gsc_window.first_period} -> ${payload.gsc_window.last_period}`);
  console.log(`Page-type filter: include_event_pages=${payload.tier_filter_meta.include_event_pages}; default keeps landing+product+academy`);
  console.log(`Page-type counts BEFORE filter:`, payload.tier_filter_meta.counts_before_filter);
  console.log(`Page-type counts AFTER  filter:`, payload.tier_filter_meta.counts_after_filter);
  console.log(`Unmapped product categories (flagged for review):`, payload.unmapped_product_categories);
  console.log('');
  for (const row of payload.tier_rollup) {
    console.log(`-- ${row.label}  [severity=${row.severity}] [pages=${row.page_count}] [at_risk=£${row.pages_at_risk_gbp}]`);
    console.log(`   booking_category: "${row.booking_category}"`);
    console.log(`   revenue 2024:     ${fmtRev(row.revenue_trend.y2024)}`);
    console.log(`   revenue 2025:     ${fmtRev(row.revenue_trend.y2025)}`);
    console.log(`   revenue 2026 YTD: ${fmtRev(row.revenue_trend.y2026_ytd)}`);
    console.log(`   GSC first 3mo (${row.gsc_trend.first_window_label}): imp=${row.gsc_trend.first_3mo.impressions}  clicks=${row.gsc_trend.first_3mo.clicks}`);
    console.log(`   GSC last  3mo (${row.gsc_trend.last_window_label}): imp=${row.gsc_trend.last_3mo.impressions}  clicks=${row.gsc_trend.last_3mo.clicks}`);
    console.log(`   GSC trend: impressions ${row.gsc_trend.pct_change_impressions == null ? 'n/a' : row.gsc_trend.pct_change_impressions + '%'}, clicks ${row.gsc_trend.pct_change_clicks == null ? 'n/a' : row.gsc_trend.pct_change_clicks + '%'}`);
    console.log(`   page states:`, row.page_state_counts);
    console.log(`   honesty: ${row.gsc_honesty_note}`);
    console.log('');
  }
}

function printLevel2Sample(payload, tierKey) {
  const row = payload.tier_rollup.find(r => r.tier_key === tierKey);
  const pages = payload.diagnostics.filter(d => d.tier_key === tierKey);
  console.log(`\n=== LEVEL 2 -- "${row?.label || tierKey}" page list (${pages.length} pages) ===\n`);
  for (const p of pages) {
    const rev = p.metrics?.full_window?.revenue_gbp_nonjlr;
    const clicks = p.metrics?.full_window?.clicks;
    const imp = p.metrics?.full_window?.impressions;
    console.log(`  - /${p.page_slug}  [state=${p.state}] [rank=${p.rank_score}]`);
    console.log(`    page_tier=${p.page_tier}  page_class=${p.page_seasonality?.type}${p.page_seasonality?.is_mixed_seasonality ? '  MIXED' : ''}`);
    console.log(`    window: clicks=${clicks}, impressions=${imp}, revenue=£${rev}`);
    console.log(`    verdict: ${p.verdict_text}`);
    console.log('');
  }
}

function printCanaryVerification(payload) {
  console.log('\n=== CANARY VERIFICATION (4 pages, post-restructure) ===\n');
  for (const slug of CANARIES) {
    const d = payload.diagnostics.find(x => x.page_slug === slug);
    if (!d) {
      console.log(`  /${slug}  -- NOT FOUND in diagnosis output`);
      continue;
    }
    const lt = d.metrics?.lifetime;
    console.log(`  /${slug}`);
    console.log(`    state           : ${d.state}  (rank ${d.rank_score})`);
    console.log(`    tier_key        : ${d.tier_key}`);
    console.log(`    page_tier       : ${d.page_tier}`);
    console.log(`    page_class      : ${d.page_seasonality?.type}  (mixed=${d.page_seasonality?.is_mixed_seasonality === true})`);
    console.log(`    GSC overlay     : ${d.metrics?.gsc_overlay_window?.label}`);
    console.log(`    lifetime        : nonJLR=£${lt?.lifetime_nonjlr}  first=${lt?.first_txn_date}  extends_before_gsc=${lt?.extends_before_gsc_window}`);
    if (lt?.pre_window_warning_text) console.log(`    pre-window warn : ${lt.pre_window_warning_text}`);
    console.log(`    verdict         : ${d.verdict_text}`);
    console.log('');
  }
}

async function run() {
  printMappingTable();

  console.log('=== full-universe diagnosis (default filter: landing+product+academy) ===');
  const full = await callDiagnosis({
    propertyUrl: 'https://www.alanranger.com',
    windowMonths: '6',
    minImpressions: '1000',
    includeAllPages: 'true'
  });
  printTierRollup(full);
  printLevel2Sample(full, 'workshops_residential');

  console.log('\n=== canary-only (?pages=, bypasses page-type filter) ===');
  const canary = await callDiagnosis({
    propertyUrl: 'https://www.alanranger.com',
    pages: CANARIES.join(','),
    windowMonths: '6',
    minImpressions: '1000',
    includeAllPages: 'true'
  });
  printCanaryVerification(canary);
}

try { await run(); } catch (err) { console.error('FATAL:', err); process.exit(1); }

// Phase C / C2 part 3 verification: 10-tier rollup + hard reconciliation.
//
//   node scripts/c2-tier-verify.mjs

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });

import handler from '../api/aigeo/revenue-funnel-diagnosis.js';
import {
  TIER_DEFINITIONS,
  TIER_ORDER,
  BOOKING_SHEET_NON_JLR_TARGETS,
  ACADEMY_COMMERCIAL_SLUGS,
  tierFromProductCategory,
  EXCLUDED_PRODUCT_CATEGORIES,
  BOOKING_CATEGORY_ALIASES
} from '../lib/revenue-tier-mapping.js';

const CANARIES = [
  'private-photography-lessons',
  'photography-workshops',
  'photography-courses-coventry',
  'landscape-photography-workshops'
];

function makeRes() {
  const out = { statusCode: null, body: null };
  return {
    setHeader() {},
    status(c) { out.statusCode = c; return this; },
    json(b) { out.body = b; return this; },
    _out: out
  };
}

async function fetchPayload(q) {
  const res = makeRes();
  await handler({ method: 'GET', query: q }, res);
  if (res._out.statusCode !== 200) throw new Error('API ' + res._out.statusCode);
  return res._out.body;
}

function printCategoryMapping() {
  console.log('\n=== CATEGORY -> TIER MAPPING (canonical_products.category) ===\n');
  const rows = [];
  for (const [tierKey, def] of Object.entries(TIER_DEFINITIONS)) {
    for (const cat of def.productCategories) {
      rows.push({ category: cat, tier_key: tierKey, tier_label: def.label });
    }
  }
  rows.sort((a, b) => a.category.localeCompare(b.category));
  for (const r of rows) console.log('  ' + r.category.padEnd(28) + ' -> ' + r.tier_label + ' (' + r.tier_key + ')');
  console.log('\n  EXCLUDED product categories:');
  for (const c of EXCLUDED_PRODUCT_CATEGORIES) console.log('    ' + c + ' -> __excluded__ (voucher plumbing)');
  console.log('\n  Booking-sheet aliases (netted into tier, not separate headers):');
  for (const [label, tier] of Object.entries(BOOKING_CATEGORY_ALIASES)) {
    console.log('    ' + label + ' -> ' + tier);
  }
}

function printHardReconciliation(payload) {
  const rec = payload.tier_reconciliation;
  console.log('\n=== FIX 1: HARD RECONCILIATION (10 tiers, non-JLR) ===\n');
  if (!rec) { console.log('  FAIL: tier_reconciliation missing from API'); return false; }
  console.log('  Targets:  2024 £' + BOOKING_SHEET_NON_JLR_TARGETS.y2024
    + '  |  2025 £' + BOOKING_SHEET_NON_JLR_TARGETS.y2025
    + '  |  2026 YTD £' + BOOKING_SHEET_NON_JLR_TARGETS.y2026_ytd);
  console.log('  Tier sum: 2024 £' + rec.tier_sum_non_jlr.y2024
    + '  |  2025 £' + rec.tier_sum_non_jlr.y2025
    + '  |  2026 YTD £' + rec.tier_sum_non_jlr.y2026_ytd);
  console.log('  Delta:    2024 £' + rec.delta_vs_targets.y2024
    + '  |  2025 £' + rec.delta_vs_targets.y2025
    + '  |  2026 YTD £' + rec.delta_vs_targets.y2026_ytd);
  console.log('\n  Per-tier non-JLR (2024 / 2025 / 2026 YTD):');
  for (const key of TIER_ORDER) {
    const t = rec.per_tier[key];
    if (!t) { console.log('    MISSING ' + key); continue; }
    console.log('    ' + t.label.padEnd(28) + '  '
      + t.y2024 + ' / ' + t.y2025 + ' / ' + t.y2026_ytd);
  }
  if (rec.unmapped_booking_categories?.length) {
    console.log('\n  Unmapped booking categories:', JSON.stringify(rec.unmapped_booking_categories));
  }
  console.log('  Stated rounded targets: 2024 £42791 | 2025 £27027 | 2026 £19233');
  if (rec.delta_vs_stated_rounded) {
    console.log('  Delta vs stated: 2024 £' + rec.delta_vs_stated_rounded.y2024
      + ' | 2025 £' + rec.delta_vs_stated_rounded.y2025
      + ' | 2026 £' + rec.delta_vs_stated_rounded.y2026_ytd);
  }
  console.log('  Stated rounded PASS: ' + (rec.passes_stated_rounded ? 'yes' : 'no'));
  console.log('\n  ' + (rec.passes ? 'PASS — penny tie to booking_sheet_transactions' : 'HALT — non-zero delta'));
  return rec.passes && rec.passes_stated_rounded;
}

function printTierRollup(payload) {
  console.log('\n=== LEVEL 1: TIER ROLLUP (10 tiers) ===\n');
  const sevRank = { critical: 0, high: 1, medium: 2, low: 3, healthy: 4, info: 5 };
  const sorted = (payload.tier_rollup || []).slice().sort((a, b) => {
    const sa = sevRank[a.severity] ?? 9;
    const sb = sevRank[b.severity] ?? 9;
    if (sa !== sb) return sa - sb;
    return (b.pages_at_risk_gbp || 0) - (a.pages_at_risk_gbp || 0);
  });
  for (const t of sorted) {
    const rt = t.revenue_trend || {};
    const nj = (y) => (rt[y]?.non_jlr ?? 0);
    console.log('--- ' + t.label + ' (' + t.tier_key + ') ---');
    console.log('  severity: ' + t.severity + '  |  pages: ' + t.page_count);
    console.log('  revenue: 2024 £' + nj('y2024') + ' -> 2025 £' + nj('y2025') + ' -> 2026 YTD £' + nj('y2026_ytd'));
    console.log('  page states: ' + JSON.stringify(t.page_state_counts || {}));
  }
}

function printAcademyPages(payload, allPayload) {
  console.log('\n=== FIX 2: ACADEMY COMMERCIAL PAGES (allowlist) ===\n');
  console.log('  Allowlist slugs:', [...ACADEMY_COMMERCIAL_SLUGS].join(', '));
  const rollup = (payload.tier_rollup || []).find(t => t.tier_key === 'academy');
  console.log('  Academy tier page_count (rollup): ' + (rollup?.page_count ?? 0));
  console.log('  Academy tier page_slugs:', JSON.stringify(rollup?.page_slugs || []));
  const all = allPayload?.diagnostics || payload._allDiagnostics || [];
  const acTier = all.filter(d => d.tier_key === 'academy');
  console.log('  All diagnostics with tier_key=academy (' + acTier.length + '):');
  for (const d of acTier) {
    console.log('    /' + d.page_slug + '  page_tier=' + d.page_tier + '  state=' + d.state
      + '  in_default_cards=' + !(d.state === 'insufficient_data'));
  }
}

function printResidentialAttribution(payload) {
  const att = payload.workshops_residential_attribution;
  console.log('\n=== FIX 3: WORKSHOPS RESIDENTIAL PAGE ATTRIBUTION ===\n');
  if (!att) { console.log('  FAIL: workshops_residential_attribution missing'); return; }
  console.log('  Model: ' + att.model);
  console.log('  ' + att.explanation);
  console.log('\n  Default view hub: ' + (att.default_view_pages || []).join(', '));
  console.log('  Hub diagnosis: ' + JSON.stringify(att.hub_page));
  console.log('\n  Satellite location/event pages (' + att.satellite_count + ' total, '
    + att.satellite_in_default_view_count + ' in default view with event toggle '
    + (payload.includeEvent ? 'ON' : 'OFF') + '):');
  for (const p of (att.satellite_pages || []).slice(0, 20)) {
    console.log('    /' + p.page_slug);
    console.log('      page_tier=' + p.page_tier + '  tier_key=' + (p.tier_key || 'null')
      + '  in_default=' + p.in_default_view);
    console.log('      ' + p.reason_not_in_residential_tier);
  }
  if ((att.satellite_pages || []).length > 20) {
    console.log('    ... +' + (att.satellite_pages.length - 20) + ' more');
  }
}

function printCanaries(payload) {
  console.log('\n=== CANARY CLASSIFICATIONS ===\n');
  const expected = {
    'private-photography-lessons': 'visibility_loss_with_low_ctr_baseline',
    'photography-workshops': 'funnel_bypass_revenue_with_minimal_organic',
    'photography-courses-coventry': 'traffic_with_zero_conversion',
    'landscape-photography-workshops': 'traffic_rich_modest_conversion'
  };
  let ok = true;
  for (const slug of CANARIES) {
    const d = (payload.diagnostics || []).find(x => x.page_slug === slug);
    const pass = d && d.state === expected[slug];
    if (!pass) ok = false;
    console.log('  ' + (pass ? 'PASS' : 'FAIL') + '  /' + slug);
  }
  return ok;
}

try {
  printCategoryMapping();
  const all = await fetchPayload({ includeJlr: 'false', includeEvent: 'true', includeAllPages: 'true' });
  const filtered = await fetchPayload({ includeJlr: 'false', includeEvent: 'false' });
  filtered._allDiagnostics = all.diagnostics;
  filtered.includeEvent = false;
  all.includeEvent = true;

  const recOk = printHardReconciliation(filtered);
  printTierRollup(filtered);
  printAcademyPages(filtered, all);
  printResidentialAttribution(filtered);
  printCanaries(filtered);

  console.log('\n=== UNMAPPED PRODUCT CATEGORIES ===\n');
  console.log('  ' + JSON.stringify(filtered.unmapped_product_categories || []));

  if (!recOk) {
    console.error('\nHALT: reconciliation failed — do not deploy.\n');
    process.exit(1);
  }
  console.log('\nDone — reconciliation PASS.\n');
} catch (err) {
  console.error('FATAL:', err);
  process.exit(1);
}

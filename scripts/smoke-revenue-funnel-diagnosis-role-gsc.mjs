// Phase 2 evidence: role-aware hub/product GSC on tier_rollup (read-only).

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import handler from '../api/aigeo/revenue-funnel-diagnosis.js';

const envFile = path.resolve('.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const SPOT = [
  {
    label: 'Bluebell',
    tier_key: 'workshops_non_residential',
    product_slug: 'photo-workshops-uk/bluebell-woodlands-photography-workshops',
    hub_slug: 'one-day-landscape-photography-workshops',
    expect_hub_imp: 7218,
    expect_prod_imp: 1902
  },
  {
    label: 'Peak heather',
    tier_key: 'workshops_non_residential',
    product_slug: 'photo-workshops-uk/peak-district-heather-photography-workshop',
    hub_slug: 'landscape-photography-workshops',
    expect_hub_imp: 110874,
    expect_prod_imp: 1104
  },
  {
    label: 'Hartland',
    tier_key: 'workshops_residential',
    product_slug: 'photo-workshops-uk/landscape-photography-devon-hartland-quay',
    hub_slug: 'photography-workshops',
    expect_hub_imp: 56320,
    expect_prod_imp: 2869
  },
  {
    label: 'Beginners course',
    tier_key: 'courses_masterclasses',
    product_slug: 'photography-services-near-me/beginners-photography-course',
    hub_slug: 'beginners-photography-classes',
    expect_hub_imp: 11796,
    expect_prod_imp: 19900
  },
  {
    label: 'Intermediates Lightroom',
    tier_key: 'courses_masterclasses',
    product_slug: 'photography-services-near-me/intermediates-lightroom-photography-course',
    hub_slug: 'photo-editing-course-coventry',
    expect_hub_imp: 10066,
    expect_prod_imp: 0
  }
];

const req = { method: 'GET', query: { propertyUrl: 'https://www.alanranger.com' } };
const res = {
  status(code) { this._code = code; return this; },
  setHeader() { return this; },
  json(body) { this._body = body; }
};

await handler(req, res);
if (res._code !== 200) {
  console.error('FAIL status=' + res._code);
  console.error(JSON.stringify(res._body, null, 2));
  process.exit(1);
}

const p = res._body;

function slugRow(overlay, slug) {
  return (overlay?.slugs || []).find((r) => r.slug === slug) || null;
}

console.log('=== DELIVERABLE 1 — role-split GSC spot-check ===\n');
for (const s of SPOT) {
  const tier = p.tier_rollup.find((t) => t.tier_key === s.tier_key);
  const hub = slugRow(tier?.hub_gsc_trend, s.hub_slug);
  const prod = slugRow(tier?.product_gsc_trend, s.product_slug);
  console.log(`${s.label} | tier=${s.tier_key}`);
  console.log(`  hub: ${s.hub_slug} | imp=${hub?.impressions ?? '—'} | clicks=${hub?.clicks ?? '—'} | pos=${hub?.best_avg_position ?? '—'}`);
  console.log(`  product: ${s.product_slug} | imp=${prod?.impressions ?? '—'} | clicks=${prod?.clicks ?? '—'} | pos=${prod?.best_avg_position ?? '—'}`);
  console.log(`  expected hub imp=${s.expect_hub_imp} product imp=${s.expect_prod_imp}`);
  console.log('');
}

console.log('=== DELIVERABLE 2 — tier reconciliation ===');
const rec = p.tier_reconciliation;
console.log('passes:', rec.passes);
console.log('tier_sum_non_jlr:', JSON.stringify(rec.tier_sum_non_jlr));
console.log('targets_non_jlr:', JSON.stringify(rec.targets_non_jlr));
console.log('delta_vs_targets:', JSON.stringify(rec.delta_vs_targets));

console.log('\n=== DELIVERABLE 3 — page_count / state tallies (diagnostic pages only) ===');
for (const t of p.tier_rollup) {
  console.log(`${t.tier_key}: page_count=${t.page_count} severity=${t.severity} states=${JSON.stringify(t.page_state_counts)}`);
}

console.log('\n=== DELIVERABLE 4 — old gsc_trend still present ===');
const sample = p.tier_rollup.find((t) => t.tier_key === 'workshops_non_residential');
console.log('workshops_non_residential.gsc_trend keys:', Object.keys(sample.gsc_trend || {}));
console.log('workshops_non_residential.hub_gsc_trend.role:', sample.hub_gsc_trend?.role);
console.log('workshops_non_residential.product_gsc_trend.role:', sample.product_gsc_trend?.role);

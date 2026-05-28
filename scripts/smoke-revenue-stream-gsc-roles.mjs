// Smoke / proof script for lib/revenue-stream-gsc-roles.js (Phase 1 gate).
// Prints Deliverable 2 (tier correctness) and Deliverable 3 (GSC spot-check).

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
  buildRevenueStreamGscRoles,
  slugFromCanonicalUrl,
  tierKeyForProductSlug
} from '../lib/revenue-stream-gsc-roles.js';
import {
  TIER_DEFINITIONS,
  tierFromProductCategory
} from '../lib/revenue-tier-mapping.js';

const GSC_FROM = '2025-01-13';
const PROPERTY = 'https://www.alanranger.com';

const envFile = path.resolve('.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

async function fetchProducts() {
  const { data, error } = await supabase
    .from('canonical_products')
    .select('product_url, service_page_url, category, is_retired')
    .eq('is_retired', false)
    .not('category', 'is', null);
  if (error) throw error;
  return data || [];
}

async function fetchGscImpressions(slugs) {
  if (!slugs.length) return new Map();
  const { data, error } = await supabase
    .from('gsc_page_timeseries')
    .select('page_url, impressions')
    .eq('property_url', PROPERTY)
    .gte('date', GSC_FROM)
    .in('page_url', slugs);
  if (error) throw error;
  const out = new Map();
  for (const row of data || []) {
    out.set(row.page_url, (out.get(row.page_url) || 0) + Number(row.impressions || 0));
  }
  return out;
}

function tierLabel(tierKey) {
  return TIER_DEFINITIONS[tierKey]?.label || tierKey;
}

function printDeliverable2(lookup) {
  console.log('\n=== DELIVERABLE 2 — photography-services-near-me/* tier correctness ===\n');
  const rows = [];
  for (const stream of lookup.streams) {
    for (const slug of stream.product_slugs) {
      if (!slug.startsWith('photography-services-near-me/')) continue;
      rows.push({
        product_slug: slug,
        category: null,
        tier_key: stream.tier_key,
        tier_label: tierLabel(stream.tier_key)
      });
    }
  }
  rows.sort((a, b) => a.product_slug.localeCompare(b.product_slug));

  const categoriesBySlug = new Map();
  for (const r of lookup._products || []) {
    const slug = slugFromCanonicalUrl(r.product_url);
    if (slug) categoriesBySlug.set(slug, r.category);
  }
  for (const row of rows) {
    row.category = categoriesBySlug.get(row.product_slug) || '?';
  }

  console.log('product_slug | category | tier_key | tier_label');
  for (const row of rows) {
    console.log(`${row.product_slug} | ${row.category} | ${row.tier_key} | ${row.tier_label}`);
  }

  const bad = rows.filter((r) =>
    ['print', 'gift voucher', 'merchandise', 'royalty'].includes(r.category) &&
    r.tier_key === 'courses_masterclasses'
  );
  const printOk = rows.filter((r) => r.category === 'print').every((r) => r.tier_key === 'prints_royalties');
  const voucherOk = rows.filter((r) => r.category === 'gift voucher').every((r) => r.tier_key === 'gift_vouchers_inc');

  console.log('\nGate checks:');
  console.log(`  print rows -> prints_royalties: ${printOk ? 'PASS' : 'FAIL'}`);
  console.log(`  gift voucher rows -> gift_vouchers_inc: ${voucherOk ? 'PASS' : 'FAIL'}`);
  console.log(`  print/voucher mapped to courses_masterclasses: ${bad.length ? 'FAIL' : 'PASS'} (${bad.length} rows)`);
  if (bad.length) process.exitCode = 1;
}

async function printSpotCheck(lookup, label, productSlug) {
  const tierKey = tierKeyForProductSlug(lookup, productSlug);
  const stream = lookup.streams.find((s) => s.tier_key === tierKey);
  const navSlugs = [];
  for (const row of lookup._products || []) {
    if (slugFromCanonicalUrl(row.product_url) !== productSlug) continue;
    const hub = slugFromCanonicalUrl(row.service_page_url);
    if (hub && !navSlugs.includes(hub)) navSlugs.push(hub);
  }
  navSlugs.sort();
  const gscSlugs = [...navSlugs, productSlug];
  const imp = await fetchGscImpressions(gscSlugs);
  console.log(`\n${label}`);
  console.log(`  tier_key: ${tierKey}`);
  for (const hub of navSlugs) {
    console.log(`  nav_hub: ${hub} | impressions: ${imp.get(hub) ?? 0}`);
  }
  console.log(`  product: ${productSlug} | impressions: ${imp.get(productSlug) ?? 0}`);
}

async function printDeliverable3(lookup) {
  console.log('\n=== DELIVERABLE 3 — GSC spot-check (date >= 2025-01-13) ===');
  await printSpotCheck(lookup, 'Workshop — Bluebell', 'photo-workshops-uk/bluebell-woodlands-photography-workshops');
  await printSpotCheck(lookup, 'Workshop — Peak heather', 'photo-workshops-uk/peak-district-heather-photography-workshop');
  await printSpotCheck(lookup, 'Workshop — Hartland', 'photo-workshops-uk/landscape-photography-devon-hartland-quay');
  await printSpotCheck(lookup, 'Course — beginners photography course', 'photography-services-near-me/beginners-photography-course');
  await printSpotCheck(lookup, 'Course — intermediates Lightroom', 'photography-services-near-me/intermediates-lightroom-photography-course');
}

const products = await fetchProducts();
const lookup = buildRevenueStreamGscRoles(products);
lookup._products = products;

console.log('=== DELIVERABLE 1 — stream summary ===');
for (const stream of lookup.streams) {
  console.log(`${stream.tier_key}: nav_hubs=${stream.nav_hub_slugs.length} products=${stream.product_slugs.length}`);
}

printDeliverable2(lookup);
await printDeliverable3(lookup);

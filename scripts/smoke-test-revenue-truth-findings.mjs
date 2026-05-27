// scripts/smoke-test-revenue-truth-findings.mjs
//
// End-to-end smoke test of the Phase B findings library against live Phase A
// data. Verifies VB1 / VB2 / VB3 / VB4 from the brief before any UI is built.
//
// Usage: node scripts/smoke-test-revenue-truth-findings.mjs

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { buildFindings } from '../lib/revenue-truth-findings.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
loadDotEnv(resolve(__dirname, '..', '.env.local'));

const PROPERTY = 'https://www.alanranger.com';

function loadDotEnv(p) {
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    process.env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
}

async function fetchAll(supabase, table, select, eq) {
  let from = 0;
  const pageSize = 1000;
  const out = [];
  while (true) {
    const q = supabase.from(table).select(select).range(from, from + pageSize - 1);
    if (eq) q.eq(eq.col, eq.val);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  console.log('--- fetching booking_sheet_transactions + canonical_products ---');
  const [txns, products] = await Promise.all([
    fetchAll(supabase, 'booking_sheet_transactions',
      'year,month,txn_date,client_name,category_label,funding,amount,booking_source,channel,client_type,canonical_product,landing_page_url,is_jlr,is_redemption',
      { col: 'property_url', val: PROPERTY }),
    fetchAll(supabase, 'canonical_products',
      'product_title,product_url,category,service_page_url,service_page_title,is_redemption,is_retired')
  ]);
  console.log(`  fetched ${txns.length} transactions + ${products.length} canonical products`);

  const findings = buildFindings({
    transactions: txns,
    canonicalProducts: products,
    now: '2026-05-27T17:00:00Z'
  });

  console.log('\n=== VB1: per-year non-JLR reconciliation (must match Phase A V5) ===');
  for (const r of findings.reconciliation.nonjlr_per_year) {
    console.log(`  ${r.year}: £${r.amount.toFixed(2)}  (target 2024 £42790.79, 2025 £27027.46, 2026 YTD £19233.04)`);
  }

  console.log('\n=== VB1 (cont.): sum across PRODUCTS for each year (non-JLR) ===');
  const productSums = sumByYearFromFindings(findings.products.all);
  console.log(JSON.stringify(productSums, null, 2));

  console.log('\n=== VB1 (cont.): sum across PAGES for each year (non-JLR) ===');
  const pageSums = sumByYearFromFindings(findings.pages.all);
  console.log(JSON.stringify(pageSums, null, 2));

  console.log('\n=== VB2: \u00a3360 1-2-1 Package finding ===');
  const p360 = findings.products.all.find(f => f.unit_id === '1-2-1 Package - 4 x 2hr Face-to-Face (the GBP360 4-for-3)');
  console.log(JSON.stringify(p360, null, 2));

  console.log('\n=== VB3: /private-photography-lessons page finding ===');
  const ppl = findings.pages.all.find(f => f.unit_id === 'https://www.alanranger.com/private-photography-lessons');
  console.log(JSON.stringify(ppl, null, 2));

  console.log('\n=== VB4: Commercial / Product Shoot one-off caveat (Screwfix) ===');
  const cps = findings.products.all.find(f => f.unit_id === 'Commission - Commercial / Product Shoot');
  console.log(JSON.stringify({
    unit_id: cps.unit_id,
    one_off_caveat: cps.one_off_caveat,
    flags: cps.flags,
    series_nonjlr: cps.series_nonjlr,
    largest_single_txn_nonjlr: cps.largest_single_txn_nonjlr
  }, null, 2));

  console.log('\n=== HEADLINE STRIP (non-JLR default) ===');
  console.log(JSON.stringify(findings.headline, null, 2));

  console.log('\n=== HONESTY NOTE: pace_context (drives the dashboard caveat) ===');
  console.log(JSON.stringify(findings.headline.pace_context, null, 2));

  console.log('\n=== TOP 5 DECLINING PRODUCTS 2024->2025 (non-JLR) ===');
  for (const f of findings.products.decliningTop5_2024_to_2025) {
    console.log(`  ${f.unit_id.slice(0, 60).padEnd(60)}  delta=\u00a3${f.deltas.nonjlr_2024_to_2025.delta_gbp.toFixed(2)}  flags=[${f.flags.join(',')}]`);
  }

  console.log('\n=== TOP 5 DECLINING PAGES 2024->2025 (non-JLR) ===');
  for (const f of findings.pages.decliningTop5_2024_to_2025) {
    console.log(`  ${f.unit_id.padEnd(70)}  delta=\u00a3${f.deltas.nonjlr_2024_to_2025.delta_gbp.toFixed(2)}`);
  }

  console.log('\n=== TOP 5 GROWING PRODUCTS 2024->2025 (non-JLR) ===');
  for (const f of findings.products.growingTop5_2024_to_2025) {
    console.log(`  ${f.unit_id.slice(0, 60).padEnd(60)}  delta=+\u00a3${f.deltas.nonjlr_2024_to_2025.delta_gbp.toFixed(2)}`);
  }
}

function sumByYearFromFindings(findings) {
  const acc = { y2024: 0, y2025: 0, y2026_ytd: 0 };
  for (const f of findings) {
    acc.y2024     += f.series_nonjlr.y2024;
    acc.y2025     += f.series_nonjlr.y2025;
    acc.y2026_ytd += f.series_nonjlr.y2026_ytd;
  }
  return {
    y2024: Number(acc.y2024.toFixed(2)),
    y2025: Number(acc.y2025.toFixed(2)),
    y2026_ytd: Number(acc.y2026_ytd.toFixed(2))
  };
}

main().catch(err => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});

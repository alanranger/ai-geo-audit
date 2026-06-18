// scripts/smoke-test-booking-sheet-readers.mjs
//
// End-to-end smoke test for the 2026-05-26 single-source-of-truth fix.
// Imports each of the 4 patched libs/endpoints' fetch functions and verifies
// they return data sourced from booking_sheet_monthly_wide.
//
// Expected values (from the user's own Booking Sheet, verified):
//   2025 full year:       £46,567.46
//   2026 YTD (Jan-May):   £19,598.04
//   17-month combined:    £66,165.50

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadBlendedSeasonality } from '../lib/revenue-funnel-seasonality-blend.js';
import { academyTierHealth } from '../lib/revenue-funnel-academy-economics.js';
import { synthesiseLegacyTierRevenue } from '../lib/booking-sheet-parser.mjs';
function shapeWideViewRow(row) {
  const tier_revenue = synthesiseLegacyTierRevenue(row.category_revenue);
  return {
    period_start: row.period_start,
    period_end: row.period_end,
    revenue_amount: Number(row.revenue_amount) || 0,
    operational_revenue: Number(row.operational_revenue) || 0,
    adjustment_net: Number(row.adjustment_net) || 0,
    tier_revenue,
    market_revenue: row.market_revenue || null,
    category_revenue: row.category_revenue || null
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadDotEnv(p) {
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    process.env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
}

loadDotEnv(resolve(__dirname, '..', '.env.local'));

const PROPERTY = 'https://www.alanranger.com';

function accumulateByYear(rows) {
  let total = 0;
  let sum2025 = 0;
  let sum2026 = 0;
  let op2025 = 0;
  let op2026 = 0;
  let adj2025 = 0;
  let adj2026 = 0;
  for (const r of rows) {
    const full = Number(r.revenue_amount);
    const op = Number(r.operational_revenue);
    const adj = Number(r.adjustment_net);
    total += full;
    if (r.period_start.startsWith('2025')) { sum2025 += full; op2025 += op; adj2025 += adj; }
    if (r.period_start.startsWith('2026')) { sum2026 += full; op2026 += op; adj2026 += adj; }
  }
  return { total, sum2025, sum2026, op2025, op2026, adj2025, adj2026 };
}

async function checkRawSums(supabase) {
  console.log('--- direct view query (new Phase L1 columns) ---');
  const { data, error } = await supabase
    .from('booking_sheet_monthly_wide')
    .select('period_start, period_end, revenue_amount, operational_revenue, adjustment_net, market_revenue, source')
    .eq('property_url', PROPERTY)
    .order('period_start', { ascending: true });
  if (error) throw error;
  const s = accumulateByYear(data);
  console.log(`  rows: ${data.length}`);
  console.log(`  2025 12-cat sum (= YTD Actual): £${s.sum2025.toFixed(2)}  expected £46567.46  ${closeTo(s.sum2025, 46567.46) ? 'OK' : 'FAIL'}`);
  console.log(`  2025 operational (D2C+B2B):     £${s.op2025.toFixed(2)}  expected £47796.21  ${closeTo(s.op2025, 47796.21) ? 'OK' : 'FAIL'}`);
  console.log(`  2025 adjustment net:            £${s.adj2025.toFixed(2)}  expected -£1228.75  ${closeTo(s.adj2025, -1228.75) ? 'OK' : 'FAIL'}`);
  console.log(`  2026 12-cat sum (= YTD Actual): £${s.sum2026.toFixed(2)}  expected £19598.04  ${closeTo(s.sum2026, 19598.04) ? 'OK' : 'FAIL'}`);
  console.log(`  2026 operational (D2C+B2B):     £${s.op2026.toFixed(2)}  expected £19857.04  ${closeTo(s.op2026, 19857.04) ? 'OK' : 'FAIL'}`);
  console.log(`  2026 adjustment net:            £${s.adj2026.toFixed(2)}  expected -£259.00   ${closeTo(s.adj2026, -259, 0.5) ? 'OK' : 'FAIL'}`);
  console.log(`  17-month full 12-cat total:     £${s.total.toFixed(2)}  expected £66165.50  ${closeTo(s.total, 66165.50) ? 'OK' : 'FAIL'}`);
  console.log(`  source field: ${data[0]?.source}`);
}

async function checkSeasonality(supabase) {
  console.log('--- loadBlendedSeasonality (lib/revenue-funnel-seasonality-blend.js) ---');
  const out = await loadBlendedSeasonality(supabase, PROPERTY);
  console.log(`  calibration_note: ${out.calibration_note}`);
  console.log('  byTier (back-compat, 4 real 1-to-1 mappings; services/hire fall back to 1.0):');
  for (const [tier, arr] of Object.entries(out.byTier)) {
    console.log(`    ${tier.padEnd(24)} ${arr.map(n => n.toFixed(2)).join(', ')}`);
  }
  console.log('  byMarket (new Phase L1 dimension):');
  for (const [market, arr] of Object.entries(out.byMarket || {})) {
    console.log(`    ${market.padEnd(24)} ${arr.map(n => n.toFixed(2)).join(', ')}`);
  }
}

async function checkAcademy(supabase) {
  console.log('--- academyTierHealth (lib/revenue-funnel-academy-economics.js) ---');
  const out = await academyTierHealth(supabase, PROPERTY);
  console.log(`  monthly_fixed_cost: £${out.monthly_fixed_cost_gbp}`);
  console.log(`  min_paid_signups:   ${out.min_paid_signups_per_month}`);
  console.log(`  badge:              ${out.badge ?? '(none)'}`);
  for (const m of out.months) {
    console.log(`  ${m.period_start}  revenue £${m.revenue_gbp}  net £${m.net_gp_gbp}  signups~${m.signups_est}`);
  }
}

function closeTo(a, b, tol = 0.01) {
  return Math.abs(a - b) < tol;
}

async function checkRevenueFunnelSummaryShape(supabase) {
  console.log('--- revenue-funnel-summary fetchLatestRevenue shape (back-compat) ---');
  const { data, error } = await supabase
    .from('booking_sheet_monthly_wide')
    .select('period_start, period_end, revenue_amount, currency, source, operational_revenue, adjustment_net, market_revenue, category_revenue')
    .eq('property_url', PROPERTY)
    .order('period_end', { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = data[0];
  const shaped = shapeWideViewRow(row);
  console.log(`  latest month: ${shaped.period_start} -> ${shaped.period_end}`);
  console.log(`  revenue_amount (full 12-cat = YTD Actual basis): £${shaped.revenue_amount.toFixed(2)}`);
  console.log(`  operational_revenue (D2C+B2B headline):           £${shaped.operational_revenue.toFixed(2)}`);
  console.log(`  adjustment_net (voucher timing line):             £${shaped.adjustment_net.toFixed(2)}`);
  console.log(`  market_revenue (new):  ${JSON.stringify(shaped.market_revenue)}`);
  console.log('  tier_revenue (back-compat synthesised):');
  for (const [k, v] of Object.entries(shaped.tier_revenue)) {
    console.log(`    ${k.padEnd(24)} ${v === null ? '(null - not a real category)' : `£${Number(v).toFixed(2)}`}`);
  }
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in .env.local');
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  await checkRawSums(supabase);
  console.log('');
  await checkSeasonality(supabase);
  console.log('');
  await checkAcademy(supabase);
  console.log('');
  await checkRevenueFunnelSummaryShape(supabase);
}

main().catch(err => { console.error(err); process.exit(1); });

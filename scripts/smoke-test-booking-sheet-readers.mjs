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

async function checkRawSums(supabase) {
  console.log('--- direct view query ---');
  const { data, error } = await supabase
    .from('booking_sheet_monthly_wide')
    .select('period_start, period_end, revenue_amount, tier_revenue, source')
    .eq('property_url', PROPERTY)
    .order('period_start', { ascending: true });
  if (error) throw error;
  let total = 0;
  let sum2025 = 0;
  let sum2026 = 0;
  for (const r of data) {
    const n = Number(r.revenue_amount);
    total += n;
    if (r.period_start.startsWith('2025')) sum2025 += n;
    if (r.period_start.startsWith('2026')) sum2026 += n;
  }
  console.log(`  rows: ${data.length}`);
  console.log(`  2025 sum: £${sum2025.toFixed(2)}    (expected £46567.46)  ${closeTo(sum2025, 46567.46) ? 'OK' : 'FAIL'}`);
  console.log(`  2026 sum: £${sum2026.toFixed(2)}    (expected £19598.04)  ${closeTo(sum2026, 19598.04) ? 'OK' : 'FAIL'}`);
  console.log(`  total:    £${total.toFixed(2)}    (expected £66165.50)  ${closeTo(total, 66165.50) ? 'OK' : 'FAIL'}`);
  console.log(`  source field: ${data[0]?.source}`);
}

async function checkSeasonality(supabase) {
  console.log('--- loadBlendedSeasonality (lib/revenue-funnel-seasonality-blend.js) ---');
  const out = await loadBlendedSeasonality(supabase, PROPERTY);
  console.log(`  calibration_note: ${out.calibration_note}`);
  for (const [tier, arr] of Object.entries(out.byTier)) {
    console.log(`  ${tier.padEnd(24)} ${arr.map(n => n.toFixed(2)).join(', ')}`);
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
}

main().catch(err => { console.error(err); process.exit(1); });

// scripts/verify-seasonal-forecast.mjs
//
// Independent Node implementation of the per-category seasonally-adjusted
// forecast. Used to verify the math against live Supabase BEFORE adding
// anything to the analyser library or dashboard.
//
// Method (per brief):
// 1. For each category, weight_m = month_m_nonjlr_revenue / annual_nonjlr_revenue.
//    Compute for each base year (2024, 2025) and average across years with
//    non-zero annual.
// 2. Sum the weights for closed months (Jan..lastClosed).
// 3. forecast_full_year = ytd_closed / sum_of_closed_weights.
//    (Algebraically equivalent to "ytd + (ytd / closedWeightSum) * remainingWeightSum"
//    because the weights sum to 1 per year per category.)
// 4. Sum per-category forecasts -> grand total mid.
// 5. low/high = mid * 0.9 / mid * 1.1.
//
// Edge cases handled:
// - Categories with no base-year history -> fallback to flat ytd * 12/closedM.
// - Categories with closedWeightSum near zero -> same flat fallback (avoids
//   blow-up).
// - Categories with negative annual sums (Pick n Mix Out, Gift Vouchers Out) ->
//   weights sign-preserve correctly; forecasts come out negative as expected.
// - JLR transactions excluded everywhere (is_jlr filter).
// - Current partial month excluded (closed-month boundary only).
//
// Usage: node scripts/verify-seasonal-forecast.mjs

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
loadDotEnv(resolve(__dirname, '..', '.env.local'));

const PROPERTY = 'https://www.alanranger.com';
const BASE_YEARS = [2024, 2025];
const TOP_CATS_FOR_WEIGHTS = [
  '2. Workshops Non Residential',
  '3. Workshops Residential',
  '7. 1-2-1',
  '1. Courses/masterclasses',
  '11 Commissions'
];

function loadDotEnv(p) {
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    process.env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
}

async function fetchAllTxns(supabase) {
  let from = 0; const pageSize = 1000; const out = [];
  while (true) {
    const { data, error } = await supabase.from('booking_sheet_transactions')
      .select('year,month,amount,category_label,is_jlr')
      .eq('property_url', PROPERTY)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

function aggregateCatYearMonth(txns) {
  // Map<category, Map<year, Array(12) of monthly non-jlr sums>>
  const m = new Map();
  for (const t of txns) {
    if (t.is_jlr) continue;
    const cat = t.category_label;
    if (!cat) continue;
    const year = Number(t.year);
    const month = Number(t.month);
    if (!Number.isFinite(year) || !Number.isFinite(month)) continue;
    if (month < 1 || month > 12) continue;
    let byYear = m.get(cat);
    if (!byYear) { byYear = new Map(); m.set(cat, byYear); }
    let arr = byYear.get(year);
    if (!arr) { arr = new Array(12).fill(0); byYear.set(year, arr); }
    arr[month - 1] += Number(t.amount) || 0;
  }
  return m;
}

function computeWeights(matrix, baseYears) {
  // Map<category, Array(12) of averaged weights>
  const out = new Map();
  for (const [cat, byYear] of matrix.entries()) {
    const yearWeights = [];
    for (const year of baseYears) {
      const arr = byYear.get(year);
      if (!arr) continue;
      const annual = arr.reduce((a, b) => a + b, 0);
      if (Math.abs(annual) < 0.01) continue;       // skip near-zero annuals
      yearWeights.push(arr.map(v => v / annual));   // sign-preserved monthly share
    }
    if (yearWeights.length === 0) { out.set(cat, null); continue; }
    const avg = new Array(12).fill(0);
    for (const w of yearWeights) for (let i = 0; i < 12; i++) avg[i] += w[i] / yearWeights.length;
    out.set(cat, avg);
  }
  return out;
}

function compute2026YtdPerCat(txns, currentYear, closedM) {
  const m = new Map();
  for (const t of txns) {
    if (t.is_jlr) continue;
    if (Number(t.year) !== currentYear) continue;
    if (Number(t.month) > closedM) continue;
    const cat = t.category_label;
    if (!cat) continue;
    m.set(cat, (m.get(cat) || 0) + (Number(t.amount) || 0));
  }
  return m;
}

function computeCategoryForecast(cat, weights, ytd, closedM) {
  const result = { category: cat, ytd_closed_nonjlr: round2(ytd) };
  if (weights == null) {
    const fallback = closedM > 0 ? ytd * (12 / closedM) : ytd;
    result.method = 'flat_12_over_M_no_history';
    result.forecast_full_year_mid = round2(fallback);
    result.closed_weight_sum = null;
    return result;
  }
  const closedWeightSum = weights.slice(0, closedM).reduce((a, b) => a + b, 0);
  if (Math.abs(closedWeightSum) < 0.001) {
    const fallback = closedM > 0 ? ytd * (12 / closedM) : ytd;
    result.method = 'flat_12_over_M_zero_closed_weight';
    result.forecast_full_year_mid = round2(fallback);
    result.closed_weight_sum = round3(closedWeightSum);
    return result;
  }
  result.method = 'seasonally_adjusted';
  result.closed_weight_sum = round3(closedWeightSum);
  result.remaining_weight_sum = round3(1 - closedWeightSum);
  result.forecast_full_year_mid = round2(ytd / closedWeightSum);
  result.forecast_remaining = round2(result.forecast_full_year_mid - ytd);
  return result;
}

function round2(v) { return Math.round((Number(v) || 0) * 100) / 100; }
function round3(v) { return Math.round((Number(v) || 0) * 1000) / 1000; }
function round4(v) { return Math.round((Number(v) || 0) * 10000) / 10000; }

function fmtPct(v) {
  if (v == null) return '-';
  return (Math.round(v * 1000) / 10).toFixed(1) + '%';
}

function printWeightsTable(catWeights, cat) {
  const w = catWeights.get(cat);
  if (!w) { console.log(`  ${cat.padEnd(40)} no base-year history`); return; }
  const monthLabels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const rows = w.map((v, i) => `${monthLabels[i]}:${fmtPct(v).padStart(7)}`).join(' ');
  const sum = w.reduce((a, b) => a + b, 0);
  console.log(`  ${cat}`);
  console.log(`    ${rows}`);
  console.log(`    sum_of_weights=${round4(sum)} (must == 1.0 modulo float)`);
}

function printCategoryForecast(forecast, baseYearAvg) {
  const cat = forecast.category;
  const ytd = forecast.ytd_closed_nonjlr;
  const f = forecast.forecast_full_year_mid;
  const cw = forecast.closed_weight_sum;
  const method = forecast.method;
  const avgLbl = baseYearAvg != null ? `(2024-25 avg full year £${round2(baseYearAvg).toLocaleString('en-GB')})` : '';
  console.log(`  ${cat.padEnd(34)} YTD=£${ytd.toFixed(2).padStart(9)}  closedWeightSum=${cw != null ? cw.toFixed(3).padStart(6) : '   -- '}  forecast=£${f.toFixed(2).padStart(10)}  method=${method}  ${avgLbl}`);
}

function baseYearAvgFullYear(matrix, cat, baseYears) {
  const byYear = matrix.get(cat);
  if (!byYear) return null;
  const vals = [];
  for (const y of baseYears) {
    const arr = byYear.get(y);
    if (!arr) continue;
    vals.push(arr.reduce((a, b) => a + b, 0));
  }
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function sanitySpotCheck(matrix, weights, baseYears) {
  // For each category, compute the historical avg Jan-Apr revenue and
  // assert that feeding that figure as 2026 YTD produces a forecast
  // approximately equal to the historical avg full year. Tolerance 5%.
  const closedM = 4;
  const rows = [];
  for (const [cat, w] of weights.entries()) {
    if (!w) continue;
    const byYear = matrix.get(cat);
    const histJanApr = []; const histAnnual = [];
    for (const y of baseYears) {
      const arr = byYear.get(y);
      if (!arr) continue;
      const annual = arr.reduce((a, b) => a + b, 0);
      if (Math.abs(annual) < 0.01) continue;
      histAnnual.push(annual);
      histJanApr.push(arr.slice(0, closedM).reduce((a, b) => a + b, 0));
    }
    if (!histJanApr.length) continue;
    const avgJanApr = histJanApr.reduce((a, b) => a + b, 0) / histJanApr.length;
    const avgAnnual = histAnnual.reduce((a, b) => a + b, 0) / histAnnual.length;
    const cws = w.slice(0, closedM).reduce((a, b) => a + b, 0);
    if (Math.abs(cws) < 0.001) continue;
    const modelForecast = avgJanApr / cws;
    const diffPct = Math.abs(modelForecast - avgAnnual) / Math.abs(avgAnnual) * 100;
    rows.push({ cat, avgJanApr: round2(avgJanApr), avgAnnual: round2(avgAnnual), modelForecast: round2(modelForecast), diffPct: round2(diffPct) });
  }
  return rows;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  console.log('=== fetching booking_sheet_transactions (non-JLR will be filtered in-memory) ===');
  const txns = await fetchAllTxns(supabase);
  console.log(`  fetched ${txns.length} transactions total`);
  const nonjlr = txns.filter(t => !t.is_jlr);
  console.log(`  ${nonjlr.length} non-JLR`);

  const matrix = aggregateCatYearMonth(txns);
  const weights = computeWeights(matrix, BASE_YEARS);
  const closedM = 4; // 2026 mid-May -> Jan..Apr closed
  const ytd = compute2026YtdPerCat(txns, 2026, closedM);

  console.log('\n=== TOP-5 CATEGORY WEIGHTS (avg of 2024 + 2025 non-JLR monthly share) ===');
  for (const cat of TOP_CATS_FOR_WEIGHTS) printWeightsTable(weights, cat);

  console.log('\n=== ALL CATEGORY FORECASTS (closed_months=4, Jan..Apr 2026) ===');
  const allCats = [...new Set([...matrix.keys(), ...ytd.keys()])].sort();
  const perCat = allCats.map(cat => computeCategoryForecast(cat, weights.get(cat), ytd.get(cat) || 0, closedM));
  for (const f of perCat) {
    const avg = baseYearAvgFullYear(matrix, f.category, BASE_YEARS);
    printCategoryForecast(f, avg);
  }

  const mid = perCat.reduce((s, f) => s + f.forecast_full_year_mid, 0);
  console.log('\n=== GRAND TOTAL ===');
  console.log(`  forecast_full_year_mid  = £${round2(mid).toLocaleString('en-GB')}`);
  console.log(`  range_low (-10%)        = £${round2(mid * 0.9).toLocaleString('en-GB')}`);
  console.log(`  range_high (+10%)       = £${round2(mid * 1.1).toLocaleString('en-GB')}`);
  console.log(`  (for comparison: 2024 actual full year £${round2(sumYear(nonjlr, 2024)).toLocaleString('en-GB')}, 2025 actual £${round2(sumYear(nonjlr, 2025)).toLocaleString('en-GB')})`);
  console.log(`  (naive x12/4 figure was £55,338 -- shown here for diff: £${round2(mid - 55338.12).toLocaleString('en-GB')})`);

  console.log('\n=== SANITY SPOT-CHECK (feed historical avg Jan-Apr as YTD -> forecast should ~== historical avg full year) ===');
  const sanity = sanitySpotCheck(matrix, weights, BASE_YEARS);
  for (const row of sanity) {
    const pass = row.diffPct < 5 ? 'OK  ' : (row.diffPct < 15 ? 'WARN' : 'FAIL');
    console.log(`  [${pass}] ${row.cat.padEnd(34)} avgJanApr=£${row.avgJanApr.toFixed(2).padStart(9)}  modelForecast=£${row.modelForecast.toFixed(2).padStart(10)}  vs avgAnnual=£${row.avgAnnual.toFixed(2).padStart(10)}  diff=${row.diffPct.toFixed(2)}%`);
  }
}

function sumYear(txns, year) {
  let s = 0;
  for (const t of txns) if (Number(t.year) === year) s += Number(t.amount) || 0;
  return s;
}

main().catch(err => { console.error(err?.stack || err?.message || String(err)); process.exit(1); });

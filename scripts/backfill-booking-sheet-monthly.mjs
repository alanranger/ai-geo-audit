// scripts/backfill-booking-sheet-monthly.mjs
//
// Reads the user's Booking Sheet workbooks from Dropbox, parses the row-18
// Totals + per-category grids + per-year GP grids via
// lib/booking-sheet-truth-parser.mjs, and upserts into the canonical truth
// tables:
//
//   public.booking_sheet_monthly_category  (verbatim 12 categories per
//                                           year/month, revenue £)
//   public.booking_sheet_category_gp       (per-year per-category GP rate,
//                                           verbatim from each sheet's
//                                           "GP Amount" grid column J)
//
// Then refreshes the booking_sheet_monthly_wide materialised view, which
// joins the category table to booking_sheet_category_market to expose
// per-month operational_revenue (D2C+B2B), adjustment_net, and revenue_amount
// (full 12-cat sum = YTD Actual basis).
//
// 2026-05-26 Phase L1 correction: removed the upsert to booking_sheet_monthly
// (the invented 5-tier rollup table, now dropped). The verbatim 12-category
// data is the canonical truth; market mapping is data in
// booking_sheet_category_market joined by the view, not hard-coded here.
//
// 2026-05-26 Phase L2 addition: also upserts gpPerCategory rows into
// public.booking_sheet_category_gp. GP rate is year-specific (e.g. Workshops
// Non-Res 2025 = 0.80, 2026 = 0.75 -- real margin change). Never harmonise
// one year's rate onto another year's revenue.
//
// Hard requirement before any DB write: the per-sheet derived YEAR sum of
// ALL 12 categories MUST equal that sheet's "YTD Actual" cell (J47 for 2025,
// J48 for 2026). If any sheet fails this check, the script aborts and writes
// nothing. The gate proves completeness; the operational headline (D2C+B2B)
// is a presentation layer on top of verified-complete data.
//
// Usage:
//   node scripts/backfill-booking-sheet-monthly.mjs --dry-run
//   node scripts/backfill-booking-sheet-monthly.mjs

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { readWorkbookFromBuffer, parseBookingSheetTruth } from '../lib/booking-sheet-truth-parser.mjs';
import { persistBookingSheetTruth } from '../lib/booking-sheet-persist.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

loadDotEnv(resolve(__dirname, '..', '.env.local'));

const BOOKS = [
  { year: 2025, file: 'G:/Dropbox/1. Bookings/Booking Sheet 2025 - Alan Ranger Photography.xlsm' },
  { year: 2026, file: 'G:/Dropbox/1. Bookings/Booking Sheet 2026 - Alan Ranger Photography.xlsm' }
];

const PROPERTY_URL = 'https://www.alanranger.com';

// --------------------------------------------------------------------------
// Helpers (kept small to honour the project's complexity-15 rule)
// --------------------------------------------------------------------------

function loadDotEnv(p) {
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    process.env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
}

function parseArgs(argv) {
  return { dryRun: argv.includes('--dry-run') };
}

function loadAndParse(filePath) {
  if (!existsSync(filePath)) throw new Error(`file not found: ${filePath}`);
  const buf = readFileSync(filePath);
  const wb = readWorkbookFromBuffer(buf);
  return parseBookingSheetTruth(wb, { propertyUrl: PROPERTY_URL });
}

// The same year (e.g. Sales 2025) appears in BOTH workbooks because the 2026
// book carries historical "Sales 20xx" comparison tabs. We dedupe by primary
// key, last-write-wins -- the later book in the BOOKS list takes precedence.
// In practice the historical tabs are identical to the originals, but
// last-write-wins makes the override behaviour explicit.
function combineParses(parses) {
  const catMap = new Map();       // key = `${year}|${month}|${category_order}`
  const gpMap = new Map();        // key = `${year}|${category_order}`
  const txnMap = new Map();       // key = `${source_workbook}|${source_row}`
  const verification = [];
  const warnings = [];
  for (const p of parses) {
    for (const r of p.monthlyPerCategory) {
      catMap.set(`${r.year}|${r.month}|${r.category_order}`, r);
    }
    for (const r of (p.gpPerCategory || [])) {
      gpMap.set(`${r.year}|${r.category_order}`, r);
    }
    for (const r of (p.transactionRows || [])) {
      txnMap.set(`${r.source_workbook}|${r.source_row}`, r);
    }
    verification.push(...p.verification);
    warnings.push(...p.warnings);
  }
  const monthlyPerCategory = [...catMap.values()];
  const gpPerCategory = reconcileGpLabels([...gpMap.values()], monthlyPerCategory, warnings);
  const transactionRows = [...txnMap.values()];
  return { monthlyPerCategory, gpPerCategory, transactionRows, verification, warnings };
}

// The revenue grid is the canonical truth for category LABELS. If the GP grid
// in a sheet still has a stale label for the same (year, category_order) --
// e.g. 2025.xlsm fixed cell C444 from "12. Other" to "12. Academy" in the
// revenue grid but the GP grid below still says "12. Other" -- prefer the
// revenue label and surface the disagreement as a warning so the user can
// tidy the source workbook at their convenience.
function reconcileGpLabels(gpRows, catRows, warnings) {
  const canonicalByYearOrder = new Map();
  for (const r of catRows) {
    const key = `${r.year}|${r.category_order}`;
    if (!canonicalByYearOrder.has(key)) canonicalByYearOrder.set(key, r.category_label);
  }
  return gpRows.map(g => {
    const key = `${g.year}|${g.category_order}`;
    const canonical = canonicalByYearOrder.get(key);
    if (canonical && canonical !== g.category_label) {
      warnings.push(`GP label mismatch ${g.year}/cat ${g.category_order} (${g.source_cell}): GP grid="${g.category_label}", revenue grid="${canonical}" -- using revenue label`);
      return { ...g, category_label: canonical };
    }
    return g;
  });
}

function assertAllReconcile(verification) {
  const failed = verification.filter(v => !v.reconciles);
  if (failed.length === 0) return;
  const msg = failed.map(v =>
    `  ${v.sheet}: derived year sum £${v.derivedYearSum} vs YTD Actual ${v.ytdActualCell}=£${v.ytdActualValue}`
  ).join('\n');
  throw new Error(`reconciliation failed for ${failed.length} sheet(s):\n${msg}`);
}

function printVerification(verification) {
  console.log('--- reconciliation ---');
  for (const v of verification) {
    const tag = v.reconciles ? 'OK' : 'FAIL';
    console.log(`[${tag}] ${v.sheet}: derived £${v.derivedYearSum} == ${v.ytdActualCell} £${v.ytdActualValue}`);
  }
}

function printTopline(perCategory) {
  const byCategory = new Map();
  let total = 0;
  for (const r of perCategory) {
    const key = r.category_label;
    byCategory.set(key, (byCategory.get(key) || 0) + r.revenue_amount);
    total += r.revenue_amount;
  }
  const sorted = [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }));
  console.log('--- per-category totals (all years combined; full 12-cat sum = YTD Actual basis) ---');
  for (const [label, sum] of sorted) console.log(`  ${label.padEnd(34)} £${sum.toFixed(2)}`);
  console.log(`  ${'TOTAL (12-cat sum)'.padEnd(34)} £${total.toFixed(2)}`);
}

// Soft reconciliation: transaction-row sum per (year, month, category_order)
// should equal the summary-grid value. Differences are surfaced as warnings
// only -- a user-typed adjustment in the category grid with no backing
// transaction is legitimate (e.g. a manual fee correction) and should not
// halt the import. The category grid remains the headline reconciliation
// authority; transactions provide drilldowns.
function printTransactionReconciliation(transactionRows, monthlyPerCategory) {
  const fromTxn = new Map();
  for (const t of transactionRows) {
    if (!t.category_order) continue;
    const month = Number(t.txn_date.slice(5, 7));
    const key = `${t.year}|${month}|${t.category_order}`;
    fromTxn.set(key, round2((fromTxn.get(key) || 0) + Number(t.amount)));
  }
  const deltas = [];
  for (const c of monthlyPerCategory) {
    const key = `${c.year}|${c.month}|${c.category_order}`;
    const txSum = round2(fromTxn.get(key) || 0);
    const delta = round2(Number(c.revenue_amount) - txSum);
    if (Math.abs(delta) >= 0.01) deltas.push({ key, grid: c.revenue_amount, txn: txSum, delta });
  }
  console.log(`--- transaction-row reconciliation ---`);
  console.log(`  transactions parsed: ${transactionRows.length}`);
  console.log(`  cells where grid != sum(transactions): ${deltas.length}`);
  for (const d of deltas.slice(0, 8)) {
    console.log(`    ${d.key.padEnd(14)} grid=£${d.grid} txn=£${d.txn.toFixed(2)} delta=£${d.delta.toFixed(2)}`);
  }
  if (deltas.length > 8) console.log(`    ... and ${deltas.length - 8} more (warnings only, not fatal)`);
}

function round2(n) { return Number((Number(n) || 0).toFixed(2)); }

function printGpTopline(gpPerCategory) {
  const byYear = new Map();
  for (const r of gpPerCategory) {
    if (!byYear.has(r.year)) byYear.set(r.year, []);
    byYear.get(r.year).push(r);
  }
  for (const [year, rows] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
    rows.sort((a, b) => a.category_order - b.category_order);
    console.log(`--- GP rate per category, ${year} (verbatim from Sales ${year} tab col J) ---`);
    for (const r of rows) {
      const pct = (r.gp_rate * 100).toFixed(1);
      console.log(`  [${String(r.category_order).padStart(2)}] ${r.category_label.padEnd(32)} ${pct.padStart(5)}%  (${r.source_cell})`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`backfill-booking-sheet-monthly: dryRun=${args.dryRun}`);

  const parses = BOOKS.map(b => loadAndParse(b.file));
  const combined = combineParses(parses);
  if (combined.warnings.length) {
    console.log('--- warnings ---');
    for (const w of combined.warnings) console.log(`  ${w}`);
  }
  printVerification(combined.verification);
  assertAllReconcile(combined.verification);
  printTopline(combined.monthlyPerCategory);
  printGpTopline(combined.gpPerCategory);
  printTransactionReconciliation(combined.transactionRows, combined.monthlyPerCategory);

  if (args.dryRun) {
    console.log('dry-run: no DB writes performed.');
    return;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in .env.local');
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  console.log('--- writing to Supabase ---');
  const written = await persistBookingSheetTruth(supabase, PROPERTY_URL, combined);
  console.log(`wrote ${written.category_rows_written} category rows + ${written.gp_rows_written} GP rows + ${written.transaction_rows_written} transactions. wide view refreshed.`);
}

main().catch(err => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});

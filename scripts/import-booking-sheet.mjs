// scripts/import-booking-sheet.mjs
//
// !!! DEPRECATED 2026-05-26 !!!
//
// This LEGACY CLI wraps `lib/booking-sheet-parser.mjs`, which double-counts
// revenue when combined with the SQ + Stripe API sources. See the deprecation
// notice in `lib/booking-sheet-parser.mjs` and the spec at
// Docs/REVENUE-TRUTH-FROM-BOOKING-SHEET.md.
//
// REPLACED BY: `scripts/backfill-booking-sheet-monthly.mjs` (reads row-18
// Totals from each Sales YYYY tab and writes to booking_sheet_monthly +
// booking_sheet_monthly_category -- the new single-source-of-truth tables).
//
// Running this script will RE-CREATE the deleted `source='booking_sheet'`
// rows in revenue_snapshots, which the dashboard no longer reads but which
// would confuse anyone querying that table directly. Do NOT run.
//
// -----------------------------------------------------------------------
// Original docstring (kept for reference):
// -----------------------------------------------------------------------
//
// CLI wrapper around lib/booking-sheet-parser.mjs.
//
// Reads the live Booking Sheet from Dropbox, imports every funded-but-
// not-Stripe row (Bank + PayPal + Cash + Voucher/PicknMix re-attribution),
// aggregates by month and upserts into Supabase `revenue_snapshots` with
// source = 'booking_sheet'. Stripe-funded rows are deliberately skipped -
// they're already counted by stripe-revenue-sync + squarespace-revenue-sync.
//
// Usage:
//   node scripts/import-booking-sheet.mjs --dry-run            # show monthly totals, no DB writes
//   node scripts/import-booking-sheet.mjs --year 2026          # only 2026
//   node scripts/import-booking-sheet.mjs --year 2025,2026     # both years
//   node scripts/import-booking-sheet.mjs                      # default: 2025 + 2026, writes to Supabase

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { readWorkbookFromBuffer, parseBookingSheet } from '../lib/booking-sheet-parser.mjs';

// ---------- env ----------
function loadDotEnv(p) {
  if (!existsSync(p)) return;
  const text = readFileSync(p, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    const k = line.slice(0, eq).trim();
    process.env[k] = line.slice(eq + 1).trim();
  }
}
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
loadDotEnv(resolve(__dirname, '..', '.env.local'));

// ---------- args ----------
function parseArgs(argv) {
  const out = { dryRun: false, years: null };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--year' || a === '--years') {
      const v = argv[++i] || '';
      out.years = v.split(',').map(s => Number(s.trim())).filter(Boolean);
    }
  }
  return out;
}

// ---------- locate the spreadsheet ----------
function findBookingSheet() {
  const now = new Date();
  for (let y = now.getFullYear(); y >= now.getFullYear() - 3; y -= 1) {
    const p = `G:\\Dropbox\\1. Bookings\\Booking Sheet ${y} - Alan Ranger Photography.xlsm`;
    if (existsSync(p)) return p;
  }
  return null;
}

// ---------- pretty-print ----------
function printAggregates(byMonth) {
  console.log(`\nMonthly aggregates (will become ${byMonth.size} revenue_snapshots rows):`);
  console.log('  month     | wkshop-res | wkshop-NR | courses  | services | hire     | academy  | unident  | total    | txn');
  console.log('  ---------- + ---------- + --------- + -------- + -------- + -------- + -------- + -------- + -------- + ----');
  for (const key of [...byMonth.keys()].sort((a, b) => a.localeCompare(b))) {
    const b = byMonth.get(key);
    const f = (n) => `£${(n || 0).toFixed(2)}`.padStart(9);
    console.log(`  ${key}   | ${f(b.tierRevenue.workshops_residential)} | ${f(b.tierRevenue.workshops_nonres)} | ${f(b.tierRevenue.courses)} | ${f(b.tierRevenue.services)} | ${f(b.tierRevenue.hire)} | ${f(b.tierRevenue.academy)} | ${f(b.tierRevenue.unidentified)} | ${f(b.revenue)} | ${b.transactions}`);
  }
}

function printFundingBreakdown(records) {
  const byFunding = new Map();
  for (const r of records) byFunding.set(r.funding, (byFunding.get(r.funding) || 0) + r.amount);
  console.log(`\nKept records: ${records.length}`);
  console.log(`Totals by Funding:`);
  for (const [k, v] of [...byFunding.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(20)} £${v.toFixed(2)}`);
  }
}

// ---------- main ----------
async function main() {
  const args = parseArgs(process.argv);
  const path = findBookingSheet();
  if (!path) { console.error('Booking sheet not found in G:\\Dropbox\\1. Bookings'); process.exit(1); }
  console.log(`Opening: ${path}`);
  console.log(`Mode: ${args.dryRun ? 'DRY RUN' : 'WRITE TO SUPABASE'}`);

  const buf = readFileSync(path);
  const wb = readWorkbookFromBuffer(buf);
  const years = args.years || [new Date().getFullYear() - 1, new Date().getFullYear()];
  const { records, skipReasons, byMonth, supabaseRows, tabsRead } = parseBookingSheet(wb, { years });
  console.log(`Tabs read: ${tabsRead.join(', ')}`);

  const importantSkips = Object.entries(skipReasons).filter(([k]) => !k.startsWith('funding_excluded:'));
  if (importantSkips.length) console.log(`  skipped (non-funding):`, Object.fromEntries(importantSkips));

  printFundingBreakdown(records);
  printAggregates(byMonth);

  if (args.dryRun) {
    console.log('\nDRY RUN - no DB writes performed.');
    return;
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  console.log(`\nUpserting ${supabaseRows.length} rows to Supabase (source='booking_sheet')...`);
  const { data, error } = await supabase
    .from('revenue_snapshots')
    .upsert(supabaseRows, { onConflict: 'property_url,period_start,period_end,source' })
    .select();
  if (error) { console.error('Upsert failed:', error); process.exit(1); }
  console.log(`Saved ${(data || []).length} rows.`);
}

main().catch(e => { console.error(e); process.exit(1); });

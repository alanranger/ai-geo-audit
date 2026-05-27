// scripts/backfill-transactions-with-product-mapping.mjs
//
// Phase A transactions-only backfill. Reads the WITH_PRODUCT_MAPPING workbook
// (which has cols I = Canonical Product, J = Landing Page URL tagged for every
// transaction), parses the transaction detail blocks for years 2024 / 2025 /
// 2026, and idempotently re-loads public.booking_sheet_transactions.
//
// This script DELIBERATELY does NOT write to booking_sheet_monthly_category
// or booking_sheet_category_gp. The WITH_PRODUCT_MAPPING workbook has the
// monthly summary grid stripped (only category labels + targets remain), so
// touching those tables would destroy data populated by the Phase L1 / L2
// backfill from the original Booking Sheet workbooks. Phase L1 readers stay
// bit-for-bit identical (V7 invariant).
//
// After upsert it refreshes booking_sheet_monthly_wide so the new
// canonical_product / landing_page_url tags + JLR slices are visible to
// downstream queries.
//
// Usage:
//   node scripts/backfill-transactions-with-product-mapping.mjs --dry-run
//   node scripts/backfill-transactions-with-product-mapping.mjs

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { readWorkbookFromBuffer, parseBookingSheetTruth } from '../lib/booking-sheet-truth-parser.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

loadDotEnv(resolve(__dirname, '..', '.env.local'));

const SOURCE_WORKBOOK = 'G:/Dropbox/alan ranger photography/Website Code/alan-shared-resources/csv/files/Booking_Sheet_2026_-_WITH_PRODUCT_MAPPING.xlsm';
const PROPERTY_URL = 'https://www.alanranger.com';
const MIN_YEAR = 2024;

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
  return parseBookingSheetTruth(wb, { propertyUrl: PROPERTY_URL, minYear: MIN_YEAR });
}

function summarise(rows) {
  const byYear = new Map();
  for (const r of rows) {
    const y = r.year;
    const t = byYear.get(y) || { rows: 0, total: 0, nullProduct: 0, nullPage: 0, jlr: 0, redemption: 0 };
    t.rows += 1;
    t.total += Number(r.amount) || 0;
    if (!r.canonical_product) t.nullProduct += 1;
    if (!r.landing_page_url) t.nullPage += 1;
    if (String(r.booking_source || '').trim().toUpperCase() === 'JLR') t.jlr += 1;
    if (r.canonical_product && /redemption/i.test(r.canonical_product)) t.redemption += 1;
    byYear.set(y, t);
  }
  return byYear;
}

function printSummary(byYear) {
  console.log('--- transaction summary (read from workbook) ---');
  for (const [year, t] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${year}: ${t.rows} rows, sum £${t.total.toFixed(2)}, null canonical_product=${t.nullProduct}, null landing_page=${t.nullPage}, JLR rows=${t.jlr}, redemption rows=${t.redemption}`);
  }
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function upsertChunks(supabase, table, rows) {
  for (const batch of chunk(rows, 500)) {
    const { error } = await supabase.from(table).upsert(batch, { onConflict: 'property_url,year,source_workbook,source_row' });
    if (error) throw new Error(`${table} upsert failed: ${error.message}`);
  }
}

async function clearTransactionsForProperty(supabase) {
  const { error } = await supabase.from('booking_sheet_transactions').delete().eq('property_url', PROPERTY_URL);
  if (error) throw new Error(`delete failed: ${error.message}`);
}

async function refreshWideView(supabase) {
  const { error } = await supabase.rpc('refresh_booking_sheet_monthly_wide');
  if (error) throw new Error(`view refresh failed: ${error.message}`);
}

function dropGeneratedFields(rows) {
  // is_jlr, is_redemption, month are GENERATED ALWAYS STORED -- Postgres
  // refuses any value supplied for them. Strip before upsert.
  return rows.map(r => {
    const { is_jlr, is_redemption, month, ...rest } = r;
    return rest;
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`backfill-transactions-with-product-mapping: dryRun=${args.dryRun}`);
  console.log(`source: ${SOURCE_WORKBOOK}`);

  const parsed = loadAndParse(SOURCE_WORKBOOK);
  if (parsed.warnings.length) {
    console.log('--- parser warnings ---');
    for (const w of parsed.warnings) console.log(`  ${w}`);
  }
  const txnRows = parsed.transactionRows.map(r => ({ property_url: PROPERTY_URL, source_workbook: parsed.verification.find(v => v.year === r.year)?.sheet || `Sales ${r.year}`, ...r }));
  printSummary(summarise(txnRows));

  if (args.dryRun) {
    console.log('dry-run: no DB writes performed.');
    return;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in .env.local');
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  console.log('--- clearing existing booking_sheet_transactions for property ---');
  await clearTransactionsForProperty(supabase);

  console.log('--- upserting fresh transactions ---');
  await upsertChunks(supabase, 'booking_sheet_transactions', dropGeneratedFields(txnRows));

  console.log('--- refreshing booking_sheet_monthly_wide ---');
  await refreshWideView(supabase);

  console.log(`done. ${txnRows.length} transactions written.`);
}

main().catch(err => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});

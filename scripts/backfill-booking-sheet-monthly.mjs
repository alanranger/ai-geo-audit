// scripts/backfill-booking-sheet-monthly.mjs
//
// Reads the user's Booking Sheet workbooks from Dropbox, parses the row-18
// Totals + per-category grids via lib/booking-sheet-truth-parser.mjs, and
// upserts into the new authoritative tables:
//
//   - public.booking_sheet_monthly           (per year/month/tier)
//   - public.booking_sheet_monthly_category  (per year/month/raw_category)
//
// Then refreshes the booking_sheet_monthly_wide materialised view.
//
// Hard requirement before any DB write: the per-sheet derived YEAR sum MUST
// equal that sheet's "YTD Actual" cell (J47 for 2025, J48 for 2026). If any
// sheet fails this check, the script aborts and writes nothing.
//
// Usage:
//   node scripts/backfill-booking-sheet-monthly.mjs --dry-run
//   node scripts/backfill-booking-sheet-monthly.mjs

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { readWorkbookFromBuffer, parseBookingSheetTruth } from '../lib/booking-sheet-truth-parser.mjs';

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
  const tierMap = new Map();      // key = `${year}|${month}|${tier_id}`
  const catMap = new Map();       // key = `${year}|${month}|${category_order}`
  const verification = [];
  const warnings = [];
  for (const p of parses) {
    for (const r of p.monthlyPerTier) {
      tierMap.set(`${r.year}|${r.month}|${r.tier_id}`, r);
    }
    for (const r of p.monthlyPerCategory) {
      catMap.set(`${r.year}|${r.month}|${r.category_order}`, r);
    }
    verification.push(...p.verification);
    warnings.push(...p.warnings);
  }
  return {
    monthlyPerTier: [...tierMap.values()],
    monthlyPerCategory: [...catMap.values()],
    verification,
    warnings
  };
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

function printTopline(perTier) {
  const byTier = new Map();
  let total = 0;
  for (const r of perTier) {
    byTier.set(r.tier_id, (byTier.get(r.tier_id) || 0) + r.revenue_amount);
    total += r.revenue_amount;
  }
  console.log('--- per-tier totals (all years combined) ---');
  for (const [tier, sum] of byTier) console.log(`  ${tier.padEnd(24)} £${sum.toFixed(2)}`);
  console.log(`  ${'TOTAL'.padEnd(24)} £${total.toFixed(2)}`);
}

async function clearExistingRowsForProperty(supabase) {
  await supabase.from('booking_sheet_monthly').delete().eq('property_url', PROPERTY_URL);
  await supabase.from('booking_sheet_monthly_category').delete().eq('property_url', PROPERTY_URL);
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function upsertChunks(supabase, table, rows) {
  for (const batch of chunk(rows, 500)) {
    const { error } = await supabase.from(table).upsert(batch);
    if (error) throw new Error(`${table} upsert failed: ${error.message}`);
  }
}

async function refreshWideView(supabase) {
  const { error } = await supabase.rpc('refresh_booking_sheet_monthly_wide');
  if (error) throw new Error(`view refresh failed: ${error.message}`);
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

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
  printTopline(combined.monthlyPerTier);

  if (args.dryRun) {
    console.log('dry-run: no DB writes performed.');
    return;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in .env.local');
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  console.log('--- writing to Supabase ---');
  await clearExistingRowsForProperty(supabase);
  await upsertChunks(supabase, 'booking_sheet_monthly', combined.monthlyPerTier);
  await upsertChunks(supabase, 'booking_sheet_monthly_category', combined.monthlyPerCategory);
  await refreshWideView(supabase);
  console.log(`wrote ${combined.monthlyPerTier.length} tier rows, ${combined.monthlyPerCategory.length} category rows. wide view refreshed.`);
}

main().catch(err => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});

// scripts/import-booking-sheet.mjs
//
// Reads the live local Booking Sheet (Bookings folder in Dropbox), filters
// to direct Bank + PayPal payments, classifies each into one of the five
// commercial tiers, aggregates by month, and upserts rows into Supabase
// `revenue_snapshots` with source = 'booking_sheet'.
//
// Stripe-funded rows in the spreadsheet are deliberately SKIPPED - those
// are already counted by api/aigeo/stripe-revenue-sync.js (Acuity + subs)
// and api/aigeo/squarespace-revenue-sync.js (workshops / courses / vouchers).
// Gift Voucher Out rows are net-zero accounting entries and are also skipped.
//
// Usage:
//   node scripts/import-booking-sheet.mjs --dry-run            # show monthly totals, no DB writes
//   node scripts/import-booking-sheet.mjs --year 2026          # only 2026
//   node scripts/import-booking-sheet.mjs --year 2025,2026     # both years
//   node scripts/import-booking-sheet.mjs                      # default: 2025 + 2026, writes to Supabase
//
// Env required (from .env.local):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import xlsx from 'xlsx';
import { createClient } from '@supabase/supabase-js';

// ---------- env ----------
function loadDotEnv(p) {
  if (!existsSync(p)) return;
  const text = readFileSync(p, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    // ALWAYS overwrite from .env.local - we trust the file over any
    // potentially-stale shell environment vars.
    process.env[k] = v;
  }
}
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
loadDotEnv(resolve(__dirname, '..', '.env.local'));

// ---------- args ----------
function parseArgs(argv) {
  const out = { dryRun: false, years: null, includePayPal: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--include-paypal') out.includePayPal = true;
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

// ---------- parsing ----------
function findHeaderRow(rows) {
  for (let i = 0; i < rows.length; i += 1) {
    const cells = (rows[i] || []).map(c => String(c || '').trim().toLowerCase());
    if (cells.includes('date') && cells.includes('client') && cells.includes('category') && cells.includes('funding')) {
      return i;
    }
  }
  return -1;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function parseExcelDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  // DD-MMM-YY  (e.g. 12-May-26)
  const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (m) {
    const day = Number(m[1]);
    const mon = MONTHS[m[2].toLowerCase()];
    if (!mon) return null;
    let yr = Number(m[3]);
    if (yr < 100) yr = 2000 + yr;
    return `${yr}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  // ISO already
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

function parseAmount(raw) {
  if (raw == null || raw === '') return null;
  const cleaned = String(raw).replace(/[£,\s]/g, '');
  if (!cleaned || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Map booking-sheet Category column -> commercial tier ID we already use.
// Categories come like " 12. Academy " or " 11 Commissions " (leading number
// may or may not have a dot, leading/trailing whitespace).
function classifyCategory(rawCategory) {
  const lc = String(rawCategory || '').trim().toLowerCase();
  if (!lc) return null;
  if (lc.includes('course') || lc.includes('masterclass')) return 'courses';
  if (lc.includes('workshops')) return 'workshops';
  if (lc.includes('1-2-1') || lc.includes('121')) return 'services';
  if (lc.includes('mentoring')) return 'services';
  if (lc.includes('academy')) return 'academy';
  if (lc.includes('commission')) return 'hire';
  if (lc.includes('print') || lc.includes('royalt')) return 'hire';
  // 8. Gift Vouchers Inc -> other (mapped by user request)
  if (lc.includes('gift voucher') && lc.includes('inc')) return 'other';
  // 4. Pick n Mix Inc -> services (1-2-1 / mentoring bundle)
  if (lc.includes('pick n mix') || lc.includes('picknmix')) return 'services';
  return 'other';
}

// Which Funding values we INCLUDE.
//   - Bank: direct bank transfers (JLR / corporate contracts) - NOT seen
//     anywhere else, this is the main reason for this importer.
//   - Cash: rare but only seen in the booking sheet.
//   - PayPal: EXCLUDED by default. Cross-checking 2025 totals shows the
//     booking sheet "PayPal" entries match the Squarespace API's PayPal-
//     paid orders, which would double-count. Pass --include-paypal to
//     override if you have direct (non-Squarespace) PayPal payments.
//   - Stripe / Gift Voucher Out / PicknMix: always excluded (covered by
//     other syncs OR are net-zero accounting entries).
const BASE_INCLUDE_FUNDING = new Set(['bank', 'cash']);

function shouldIncludeFunding(funding, includePayPal) {
  const f = String(funding || '').trim().toLowerCase();
  if (BASE_INCLUDE_FUNDING.has(f)) return true;
  if (includePayPal && f === 'paypal') return true;
  return false;
}

function parseTab(ws, tabName, includePayPal) {
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', dateNF: 'yyyy-mm-dd' });
  const headerIdx = findHeaderRow(rows);
  if (headerIdx < 0) return { rows: [], skipReasons: { no_header: 1 } };
  const headers = rows[headerIdx].map(h => String(h || '').trim());
  const out = [];
  const skipReasons = {};
  for (const r of rows.slice(headerIdx + 1)) {
    const obj = {};
    for (let j = 0; j < headers.length; j += 1) if (headers[j]) obj[headers[j]] = r[j];
    const date = parseExcelDate(obj.Date);
    const amount = parseAmount(obj.Amount);
    const funding = String(obj.Funding || '').trim();
    const category = String(obj.Category || '').trim();
    if (!date) { skipReasons.no_date = (skipReasons.no_date || 0) + 1; continue; }
    if (amount == null) { skipReasons.no_amount = (skipReasons.no_amount || 0) + 1; continue; }
    if (!category) { skipReasons.no_category = (skipReasons.no_category || 0) + 1; continue; }
    if (!shouldIncludeFunding(funding, includePayPal)) {
      const key = `funding_excluded:${funding || '<empty>'}`;
      skipReasons[key] = (skipReasons[key] || 0) + 1;
      continue;
    }
    const tier = classifyCategory(category);
    out.push({ date, amount, funding, category, tier, sheet: tabName });
  }
  return { rows: out, skipReasons };
}

// ---------- aggregation ----------
const TIER_IDS = ['workshops', 'courses', 'services', 'hire', 'academy', 'other'];

function emptyTierMap() {
  const m = {};
  for (const id of TIER_IDS) m[id] = 0;
  return m;
}

function monthBounds(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const start = `${monthKey}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${monthKey}-${String(last).padStart(2, '0')}`;
  return { start, end };
}

function aggregateByMonth(records) {
  const byMonth = new Map();
  for (const r of records) {
    const key = r.date.slice(0, 7);
    const bucket = byMonth.get(key) || { revenue: 0, transactions: 0, tierRevenue: emptyTierMap(), tierTransactions: emptyTierMap() };
    bucket.revenue += r.amount;
    bucket.transactions += 1;
    bucket.tierRevenue[r.tier] = (bucket.tierRevenue[r.tier] || 0) + r.amount;
    bucket.tierTransactions[r.tier] = (bucket.tierTransactions[r.tier] || 0) + 1;
    byMonth.set(key, bucket);
  }
  return byMonth;
}

function roundMap(map) {
  const out = {};
  for (const [k, v] of Object.entries(map || {})) out[k] = Math.round(v * 100) / 100;
  return out;
}

function buildRows(propertyUrl, byMonth) {
  const rows = [];
  const keys = [...byMonth.keys()].sort();
  for (const k of keys) {
    const bucket = byMonth.get(k);
    const { start, end } = monthBounds(k);
    rows.push({
      property_url: propertyUrl,
      period_start: start,
      period_end: end,
      revenue_amount: Math.round(bucket.revenue * 100) / 100,
      currency: 'GBP',
      source: 'booking_sheet',
      transactions: bucket.transactions,
      tier_revenue: roundMap(bucket.tierRevenue),
      tier_transactions: roundMap(bucket.tierTransactions),
      notes: 'Imported from Booking Sheet (direct Bank + Cash; PayPal excluded unless --include-paypal)'
    });
  }
  return rows;
}

// ---------- main ----------
async function main() {
  const args = parseArgs(process.argv);
  const path = findBookingSheet();
  if (!path) { console.error('Booking sheet not found in G:\\Dropbox\\1. Bookings'); process.exit(1); }
  console.log(`Opening: ${path}`);
  console.log(`Mode: ${args.dryRun ? 'DRY RUN' : 'WRITE TO SUPABASE'}`);

  const wb = xlsx.readFile(path, { cellDates: true });
  const yearsRequested = args.years || [new Date().getFullYear(), new Date().getFullYear() - 1];
  const tabs = yearsRequested.map(y => `Sales ${y}`).filter(t => wb.Sheets[t]);
  console.log(`Tabs to import: ${tabs.join(', ')}\n`);

  let allRecords = [];
  for (const tab of tabs) {
    const { rows, skipReasons } = parseTab(wb.Sheets[tab], tab, args.includePayPal);
    console.log(`${tab}: kept ${rows.length} usable rows`);
    const importantSkips = Object.entries(skipReasons).filter(([k]) => !k.startsWith('funding_excluded:'));
    if (importantSkips.length) console.log(`  skipped (non-funding):`, Object.fromEntries(importantSkips));
    allRecords = allRecords.concat(rows);
  }

  // Diagnostic: total per funding source kept
  const byFunding = new Map();
  for (const r of allRecords) byFunding.set(r.funding, (byFunding.get(r.funding) || 0) + r.amount);
  console.log(`\nKept records: ${allRecords.length}`);
  console.log(`Totals by Funding:`);
  for (const [k, v] of [...byFunding.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(15)} £${v.toFixed(2)}`);
  }

  const byMonth = aggregateByMonth(allRecords);
  console.log(`\nMonthly aggregates (will become ${byMonth.size} revenue_snapshots rows):`);
  console.log('  month     | workshops | courses  | services | hire     | academy  | other    | total    | txn');
  console.log('  ---------- + --------- + -------- + -------- + -------- + -------- + -------- + -------- + ----');
  for (const key of [...byMonth.keys()].sort()) {
    const b = byMonth.get(key);
    const f = (n) => `£${(n || 0).toFixed(2)}`.padStart(8);
    console.log(`  ${key}    | ${f(b.tierRevenue.workshops).padStart(9)} | ${f(b.tierRevenue.courses)} | ${f(b.tierRevenue.services)} | ${f(b.tierRevenue.hire)} | ${f(b.tierRevenue.academy)} | ${f(b.tierRevenue.other)} | ${f(b.revenue)} | ${b.transactions}`);
  }

  if (args.dryRun) {
    console.log('\nDRY RUN - no DB writes performed.');
    return;
  }

  const propertyUrl = 'https://www.alanranger.com';
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const rowsToSave = buildRows(propertyUrl, byMonth);
  console.log(`\nUpserting ${rowsToSave.length} rows to Supabase (source='booking_sheet')...`);
  const { data, error } = await supabase
    .from('revenue_snapshots')
    .upsert(rowsToSave, { onConflict: 'property_url,period_start,period_end,source' })
    .select();
  if (error) { console.error('Upsert failed:', error); process.exit(1); }
  console.log(`Saved ${(data || []).length} rows.`);
}

main().catch(e => { console.error(e); process.exit(1); });

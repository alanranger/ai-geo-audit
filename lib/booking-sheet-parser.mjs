// lib/booking-sheet-parser.mjs
//
// Parse the user's local Booking Sheet workbook (the "Sales YYYY" tabs)
// into per-month, per-tier revenue buckets that match what the dashboard
// already shows.
//
// Used by:
//   - scripts/import-booking-sheet.mjs        (Node CLI, reads file from disk)
//   - api/aigeo/booking-sheet-upload.js       (Vercel endpoint, reads file
//                                              from base64 in the request body)
//
// Both callers hand us an xlsx.Workbook object (already loaded). This
// module never touches the filesystem, so it works server-side on Vercel
// where there is no Dropbox access.
//
// Funding column policy (per business owner, May 2026):
//   - Stripe              -> SKIP (already counted by stripe-revenue-sync
//                                 + squarespace-revenue-sync APIs)
//   - Bank                -> INCLUDE (JLR, corporate, BACS workshop balances)
//   - PayPal              -> INCLUDE (3rd-party royalties: Artfully Walls, Pure Photo)
//   - Cash                -> INCLUDE (rare)
//   - Various             -> INCLUDE, treat as Bank (mixed-channel bookings)
//   - Groupon             -> INCLUDE (past Groupon vouchers)
//   - W-Pay               -> INCLUDE (other PSPs)
//   - Gift Voucher Out    -> INCLUDE (re-attribution; paired ± entries that
//                                     move money between tiers, net zero)
//   - PicknMix            -> INCLUDE (same re-attribution flow as vouchers)
//
// Category column maps 1:1 to the 5 dashboard tiers, see classifyCategory().

import xlsx from 'xlsx';

// ----------------------------------------------------------------------
// Constants the rest of the file uses
// ----------------------------------------------------------------------

export const COMMERCIAL_TIER_IDS = ['workshops', 'courses', 'services', 'hire', 'academy', 'other'];

// Funding values we INCLUDE in the booking-sheet importer. Lowercased
// for comparison. Anything else (notably 'stripe') is skipped.
const FUNDING_INCLUDE = new Set([
  'bank',
  'paypal',
  'cash',
  'various',
  'groupon',
  'w-pay',
  'wpay',
  'gift voucher out',
  'picknmix',
  'pick n mix',
  'pick-n-mix'
]);

const MONTH_TOKEN = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// ----------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------

// Read an xlsm file buffer and return the parsed workbook. Centralised so
// both callers use the same xlsx options (cellDates=true matters for
// reliable date parsing).
export function readWorkbookFromBuffer(buffer) {
  return xlsx.read(buffer, { type: 'buffer', cellDates: true });
}

// Top-level entry point. Pass in a loaded workbook and (optionally) the
// years to import. Returns:
//   {
//     records:    [{ date, amount, funding, category, tier, sheet, event }],
//     skipReasons:{ [reason]: count },
//     byMonth:    Map<'YYYY-MM', bucket>,
//     supabaseRows: [...]                  (ready for upsert)
//   }
export function parseBookingSheet(workbook, options = {}) {
  const propertyUrl = options.propertyUrl || 'https://www.alanranger.com';
  const years = options.years || defaultYears();
  const tabs = years.map(y => `Sales ${y}`).filter(t => workbook.Sheets[t]);
  const records = [];
  const skipReasons = {};
  for (const tab of tabs) {
    const parsed = parseTab(workbook.Sheets[tab], tab);
    records.push(...parsed.rows);
    mergeSkipReasons(skipReasons, parsed.skipReasons);
  }
  const byMonth = aggregateByMonth(records);
  const supabaseRows = buildSupabaseRows(propertyUrl, byMonth);
  return { records, skipReasons, byMonth, supabaseRows, tabsRead: tabs };
}

// ----------------------------------------------------------------------
// Parsing helpers
// ----------------------------------------------------------------------

function defaultYears() {
  const y = new Date().getFullYear();
  return [y - 1, y];
}

function findHeaderRow(rows) {
  for (let i = 0; i < rows.length; i += 1) {
    const cells = (rows[i] || []).map(c => String(c || '').trim().toLowerCase());
    if (cells.includes('date') && cells.includes('client') && cells.includes('category') && cells.includes('funding')) {
      return i;
    }
  }
  return -1;
}

function parseExcelDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  // "DD-MMM-YY" e.g. 12-May-26
  const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (m) {
    const day = Number(m[1]);
    const mon = MONTH_TOKEN[m[2].toLowerCase()];
    if (!mon) return null;
    let yr = Number(m[3]);
    if (yr < 100) yr = 2000 + yr;
    return `${yr}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
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

// Booking-sheet "Category" -> dashboard commercial tier.
// Categories come like " 12. Academy " or " 11 Commissions ", whitespace and
// leading numbers may vary. Order of checks matters: workshops/courses both
// say "photography" etc., so we anchor on the most specific tokens first.
export function classifyCategory(rawCategory) {
  const lc = String(rawCategory || '').trim().toLowerCase();
  if (!lc) return null;
  // Most-specific first
  if (lc.includes('academy')) return 'academy';
  if (lc.includes('commission')) return 'hire';
  if (lc.includes('print') || lc.includes('royalt')) return 'hire';
  // Vouchers (in OR out) net within the Services tier — the matching
  // positive entry in the destination category re-attributes the money.
  if (lc.includes('gift voucher')) return 'services';
  if (lc.includes('pick n mix') || lc.includes('picknmix') || lc.includes('pick-n-mix')) return 'services';
  if (lc.includes('mentoring')) return 'services';
  if (lc.includes('1-2-1') || lc.includes('121') || lc.includes('1 2 1')) return 'services';
  if (lc.includes('workshop')) return 'workshops';
  if (lc.includes('course') || lc.includes('masterclass') || lc.includes('class')) return 'courses';
  return 'other';
}

function shouldIncludeFunding(funding) {
  const f = String(funding || '').trim().toLowerCase();
  if (!f) return false;
  return FUNDING_INCLUDE.has(f);
}

function parseTab(ws, tabName) {
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', dateNF: 'yyyy-mm-dd' });
  const headerIdx = findHeaderRow(rows);
  if (headerIdx < 0) return { rows: [], skipReasons: { no_header: 1 } };
  const headers = rows[headerIdx].map(h => String(h || '').trim());
  const out = [];
  const skipReasons = {};
  for (const r of rows.slice(headerIdx + 1)) {
    const result = parseTabRow(r, headers, tabName);
    if (result.skip) {
      skipReasons[result.skip] = (skipReasons[result.skip] || 0) + 1;
    } else {
      out.push(result.record);
    }
  }
  return { rows: out, skipReasons };
}

// Returns either { skip: 'reason' } or { record: {...} }. Splitting this
// out keeps parseTab's cognitive complexity in budget for the sonar lint.
function parseTabRow(rawRow, headers, tabName) {
  const obj = rowToObj(rawRow, headers);
  const date = parseExcelDate(obj.Date);
  const amount = parseAmount(obj.Amount);
  const funding = String(obj.Funding || '').trim();
  const category = String(obj.Category || '').trim();
  if (!date) return { skip: 'no_date' };
  if (amount == null) return { skip: 'no_amount' };
  if (!category) return { skip: 'no_category' };
  if (!shouldIncludeFunding(funding)) {
    return { skip: `funding_excluded:${funding || '<empty>'}` };
  }
  const tier = classifyCategory(category);
  return {
    record: {
      date,
      amount,
      funding,
      category,
      tier,
      sheet: tabName,
      event: String(obj.Event || '').trim()
    }
  };
}

function rowToObj(rawRow, headers) {
  const obj = {};
  for (let j = 0; j < headers.length; j += 1) if (headers[j]) obj[headers[j]] = rawRow[j];
  return obj;
}

function mergeSkipReasons(target, src) {
  for (const [k, v] of Object.entries(src || {})) {
    target[k] = (target[k] || 0) + v;
  }
}

// ----------------------------------------------------------------------
// Aggregation
// ----------------------------------------------------------------------

function emptyTierMap() {
  const m = {};
  for (const id of COMMERCIAL_TIER_IDS) m[id] = 0;
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
    const bucket = byMonth.get(key) || newBucket();
    bucket.revenue += r.amount;
    bucket.transactions += 1;
    bucket.tierRevenue[r.tier] = (bucket.tierRevenue[r.tier] || 0) + r.amount;
    bucket.tierTransactions[r.tier] = (bucket.tierTransactions[r.tier] || 0) + 1;
    byMonth.set(key, bucket);
  }
  return byMonth;
}

function newBucket() {
  return {
    revenue: 0,
    transactions: 0,
    tierRevenue: emptyTierMap(),
    tierTransactions: emptyTierMap()
  };
}

function roundMap(map) {
  const out = {};
  for (const [k, v] of Object.entries(map || {})) out[k] = Math.round(v * 100) / 100;
  return out;
}

function buildSupabaseRows(propertyUrl, byMonth) {
  const rows = [];
  const keys = [...byMonth.keys()].sort((a, b) => a.localeCompare(b));
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
      notes: 'Imported from Booking Sheet (Bank + PayPal + Cash + Voucher/PicknMix re-attribution; Stripe excluded)'
    });
  }
  return rows;
}

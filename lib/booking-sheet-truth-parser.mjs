// lib/booking-sheet-truth-parser.mjs
//
// SINGLE-SOURCE-OF-TRUTH parser for the Booking Sheet.
//
// Reads the "Sales YYYY" tab of the user's .xlsm Booking Sheet workbooks and
// emits two row sets ready for upsert:
//
//   1. monthlyPerTier rows -> public.booking_sheet_monthly
//        (year, month, tier_id, revenue_amount, source_workbook)
//
//   2. monthlyPerCategory rows -> public.booking_sheet_monthly_category
//        (year, month, category_order, category_label, tier_id,
//         revenue_amount, source_workbook, source_cell_range)
//
// What it reads from the sheet:
//   - Header row (row 5) has "Tuition Categories" (2025) or "Sales Categories"
//     (2026) at column I, then "Target" at J, then 12 monthly cells K..V
//     (Jan..Dec), then "Year" total at W.
//   - Category rows 6..17 hold the 12 categories.
//   - Row 18 "Totals" holds the user's canonical per-month total.
//   - Cell J47 (2025) / J48 (2026) holds the "YTD Actual" master figure.
//
// What it does NOT do:
//   - Does not walk transactional rows.
//   - Does not apply funding-method filters (Bank/PayPal/Cash/etc).
//   - Does not exclude Stripe-funded sales -- the Booking Sheet's row-18
//     Totals already reflects EVERY funding channel, which is the whole point.
//
// Why this replaces lib/booking-sheet-parser.mjs for the headline read:
//   The legacy parser walked the transactional rows and dropped Stripe-funded
//   bookings on the assumption that the dashboard would also be reading the
//   Stripe API source. The dashboard was, but with double-counting between SQ
//   API + Stripe API + this filtered Booking Sheet feed. See
//   Docs/REVENUE-TRUTH-FROM-BOOKING-SHEET.md.

import xlsx from 'xlsx';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TIER_IDS = Object.freeze([
  'courses',
  'workshops_nonres',
  'workshops_residential',
  'services',
  'academy'
]);

// 12 Booking Sheet category labels (verbatim, leading number kept) -> 5 tiers.
// Rationale documented in Docs/REVENUE-TRUTH-FROM-BOOKING-SHEET.md section 9.
//
// Pick n Mix and Gift Vouchers each have an Inc (positive cash) and an Out
// (negative re-attribution). Both pair members map to 'services' so the net
// per-tier figure for 'services' equals the cash flowing in that the other
// tiers have not absorbed via direct sales.
const CATEGORY_TO_TIER = Object.freeze({
  '1. Courses/masterclasses':   'courses',
  '2. Workshops Non Residential': 'workshops_nonres',
  '3. Workshops Residential':   'workshops_residential',
  '4. Pick n Mix Inc':          'services',
  '5. Pick n Mix Out':          'services',
  '6. Mentoring':               'services',
  '7. 1-2-1':                   'services',
  '8. Gift Vouchers Inc':       'services',
  '9. Gift Vouchers Out':       'services',
  '10. Prints & Royalties':     'services',
  '11 Commissions':             'services',
  '12. Academy':                'academy'
});

const LABEL_COL = 8;          // column I
const TARGET_COL = 9;         // column J
const FIRST_MONTH_COL = 10;   // column K (Jan)
const LAST_MONTH_COL = 21;    // column V (Dec)
const YEAR_TOTAL_COL = 22;    // column W
const TOTALS_ROW_LABEL_RE = /^total/i;
const SHEET_NAME_RE = /^sales\s+(\d{4})$/i;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function readWorkbookFromBuffer(buffer) {
  return xlsx.read(buffer, { type: 'buffer', cellDates: true });
}

// Parse "Sales YYYY" tabs in the workbook. Returns:
//   {
//     monthlyPerTier:     [ { year, month, tier_id, revenue_amount,
//                             source_workbook } ],
//     monthlyPerCategory: [ { year, month, category_order, category_label,
//                             tier_id, revenue_amount, source_workbook,
//                             source_cell_range } ],
//     verification: [ { sheet, year, monthlyTotalsRow, derivedFromCategories,
//                       ytdActualCell, reconciles } ],
//     warnings:     [ string ]
//   }
//
// Options:
//   propertyUrl:  defaults to https://www.alanranger.com
//   minYear:      defaults to 2025. Older "Sales YYYY" tabs use a different
//                 category layout (e.g. "2. Workshops" not split into Res /
//                 Non-Res; no "12. Academy"; sub-row "- Workshops Residential"
//                 without a leading number) that the CATEGORY_TO_TIER map
//                 doesn't cover. Set this lower at your own risk.
export function parseBookingSheetTruth(workbook, options = {}) {
  const propertyUrl = options.propertyUrl || 'https://www.alanranger.com';
  const minYear = options.minYear ?? 2025;
  const monthlyPerTier = [];
  const monthlyPerCategory = [];
  const verification = [];
  const warnings = [];

  for (const sheetName of workbook.SheetNames) {
    const yearMatch = SHEET_NAME_RE.exec(sheetName);
    if (!yearMatch) continue;
    const year = Number(yearMatch[1]);
    if (year < minYear) continue;
    const ws = workbook.Sheets[sheetName];
    const sheetParse = parseOneSheet(ws, year, sheetName);
    if (sheetParse.error) {
      warnings.push(`${sheetName}: ${sheetParse.error}`);
      continue;
    }
    for (const r of sheetParse.tierRows) {
      monthlyPerTier.push({ property_url: propertyUrl, source_workbook: sheetName, ...r });
    }
    for (const r of sheetParse.categoryRows) {
      monthlyPerCategory.push({ property_url: propertyUrl, source_workbook: sheetName, ...r });
    }
    verification.push(sheetParse.verification);
  }

  return { monthlyPerTier, monthlyPerCategory, verification, warnings };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function parseOneSheet(ws, year, sheetName) {
  const range = decodeRange(ws);
  if (!range) return { error: 'sheet is empty' };

  const headerRow = findHeaderRow(ws, range);
  if (headerRow < 0) {
    return { error: 'header row (Tuition/Sales Categories) not found in col I' };
  }

  const categories = readCategoryRows(ws, headerRow, range);
  const totalsRow = categories.find(c => c.isTotalsRow) || null;
  const dataRows = categories.filter(c => !c.isTotalsRow);
  if (!dataRows.length || !totalsRow) {
    return { error: 'no category rows or no totals row found' };
  }

  const ytd = findYtdActual(ws, range);

  return {
    tierRows: buildTierRows(year, dataRows),
    categoryRows: buildCategoryRows(year, dataRows),
    verification: buildVerification(sheetName, year, dataRows, totalsRow, ytd)
  };
}

function decodeRange(ws) {
  const ref = ws['!ref'];
  if (!ref) return null;
  return xlsx.utils.decode_range(ref);
}

function findHeaderRow(ws, range) {
  const maxR = Math.min(range.e.r, 40);
  for (let r = range.s.r; r <= maxR; r += 1) {
    const cell = ws[xlsx.utils.encode_cell({ r, c: LABEL_COL })];
    if (!cell) continue;
    const s = String(cell.v || '').trim().toLowerCase();
    if (s === 'tuition categories' || s === 'sales categories') return r;
  }
  return -1;
}

function readCategoryRows(ws, headerRow, range) {
  const out = [];
  const maxR = Math.min(range.e.r, headerRow + 40);
  for (let r = headerRow + 1; r <= maxR; r += 1) {
    const labelCell = ws[xlsx.utils.encode_cell({ r, c: LABEL_COL })];
    const label = labelCell ? String(labelCell.v || '').trim() : '';
    if (!label) continue;
    const monthly = readMonthlyRow(ws, r);
    const yearTotal = toNum(ws[xlsx.utils.encode_cell({ r, c: YEAR_TOTAL_COL })]?.v);
    const isTotalsRow = TOTALS_ROW_LABEL_RE.test(label);
    out.push({
      row: r + 1,
      label,
      monthly,
      yearTotal: round2(yearTotal),
      monthlySum: round2(monthly.reduce((a, b) => a + b, 0)),
      isTotalsRow
    });
    if (isTotalsRow) break;
  }
  return out;
}

function readMonthlyRow(ws, r) {
  const monthly = [];
  for (let c = FIRST_MONTH_COL; c <= LAST_MONTH_COL; c += 1) {
    monthly.push(toNum(ws[xlsx.utils.encode_cell({ r, c })]?.v));
  }
  return monthly;
}

function findYtdActual(ws, range) {
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    const cell = ws[xlsx.utils.encode_cell({ r, c: LABEL_COL })];
    if (!cell) continue;
    const s = String(cell.v || '').trim().toLowerCase();
    if (s.startsWith('ytd actual')) {
      const v = toNum(ws[xlsx.utils.encode_cell({ r, c: TARGET_COL })]?.v);
      return { value: round2(v), cell: `J${r + 1}` };
    }
  }
  return { value: null, cell: null };
}

function buildTierRows(year, dataRows) {
  // Aggregate per (month, tier) across all categories that map to that tier.
  // Use sparse map so we only emit non-zero rows (keeps the DB tidy).
  const acc = new Map(); // key = `${month}|${tier}` -> sum
  for (const cat of dataRows) {
    const tier = CATEGORY_TO_TIER[cat.label];
    if (!tier) continue; // unmapped categories are skipped (logged via warnings caller-side)
    for (let m = 0; m < 12; m += 1) {
      const v = cat.monthly[m];
      if (!v) continue;
      const key = `${m + 1}|${tier}`;
      acc.set(key, (acc.get(key) || 0) + v);
    }
  }
  const out = [];
  for (const [key, sum] of acc) {
    const [monthStr, tier_id] = key.split('|');
    out.push({
      year,
      month: Number(monthStr),
      tier_id,
      revenue_amount: round2(sum)
    });
  }
  return out;
}

function buildCategoryRows(year, dataRows) {
  const out = [];
  // Prefer the leading number from the label (1..12 on modern sheets) and
  // fall back to the row-position sequence (1, 2, 3, ...) on older sheets
  // where some categories lack a leading number. This keeps category_order
  // unique per (year, month) - that's the primary key.
  dataRows.forEach((cat, idx) => {
    const order = parseCategoryOrder(cat.label) || (idx + 1);
    const tier = CATEGORY_TO_TIER[cat.label] || 'unidentified';
    for (let m = 0; m < 12; m += 1) {
      const v = cat.monthly[m];
      if (v === 0) continue;
      out.push({
        year,
        month: m + 1,
        category_order: order,
        category_label: cat.label,
        tier_id: tier,
        revenue_amount: round2(v),
        source_cell_range: cellRangeFor(cat.row, m)
      });
    }
  });
  return out;
}

function parseCategoryOrder(label) {
  const m = /^(\d{1,2})\b/.exec(label);
  return m ? Number(m[1]) : 0;
}

function cellRangeFor(rowOneBased, monthIdxZero) {
  const col = xlsx.utils.encode_col(FIRST_MONTH_COL + monthIdxZero);
  return `${col}${rowOneBased}`;
}

function buildVerification(sheetName, year, dataRows, totalsRow, ytd) {
  const derivedMonthly = [];
  for (let m = 0; m < 12; m += 1) {
    derivedMonthly.push(round2(dataRows.reduce((a, c) => a + (c.monthly[m] || 0), 0)));
  }
  const derivedYearSum = round2(derivedMonthly.reduce((a, b) => a + b, 0));
  return {
    sheet: sheetName,
    year,
    monthlyTotalsRow: totalsRow.monthly.map(round2),
    monthlyTotalsRowSum: round2(totalsRow.monthly.reduce((a, b) => a + b, 0)),
    derivedFromCategories: derivedMonthly,
    derivedYearSum,
    ytdActualValue: ytd.value,
    ytdActualCell: ytd.cell,
    reconciles: ytd.value != null && Math.abs(derivedYearSum - ytd.value) < 0.01
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toNum(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[£,\s]/g, '');
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function round2(n) {
  return Number((Number(n) || 0).toFixed(2));
}

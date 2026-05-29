// lib/booking-sheet-truth-parser.mjs
//
// SINGLE-SOURCE-OF-TRUTH parser for the Booking Sheet.
//
// Reads the "Sales YYYY" tab of the user's .xlsm Booking Sheet workbooks and
// emits ONE row set ready for upsert:
//
//   monthlyPerCategory rows -> public.booking_sheet_monthly_category
//     (year, month, category_order, category_label, revenue_amount,
//      source_workbook, source_cell_range)
//
// The 12 verbatim categories are the canonical revenue truth. The mapping
// from category -> market (D2C / B2B / ADJUSTMENT) lives in the database
// table public.booking_sheet_category_market and is joined in by the
// public.booking_sheet_monthly_wide materialised view -- this parser does
// NOT need to know about markets.
//
// What it reads from the sheet:
//   - Header row (row 5) has "Tuition Categories" (2025) or "Sales Categories"
//     (2026) at column I, then "Target" at J, then 12 monthly cells K..V
//     (Jan..Dec), then "Year" total at W.
//   - Category rows 6..17 hold the 12 categories.
//   - Row 18 "Totals" holds the user's canonical per-month total.
//   - Cell J47 (2025) / J48 (2026) holds the "YTD Actual" master figure.
//
// IMPORT GATE (verification): the derived sum of all 12 categories for the
// year MUST match the sheet's own "YTD Actual" cell to the penny. The gate
// proves completeness of the import. The dashboard headline figure is
// revenue_amount (= the full 12-category sum = the YTD Actual cell) -- so
// the on-screen number, the import-gate basis, and the user's spreadsheet
// figure are all the same number. operational_revenue (D2C + B2B) and
// adjustment_net (voucher timing) are exposed alongside as secondary
// breakdown lines beneath the headline.
//
// 2026-05-26 Phase L1 correction: previously this parser also emitted a
// monthlyPerTier rowset that rolled the 12 categories into 5 invented
// "tiers" (courses / workshops_nonres / workshops_residential / services /
// academy). The `services` tier in particular merged 8 unrelated D2C, B2B
// and ADJUSTMENT categories and corresponded to nothing real. The rollup
// is now deleted -- the canonical layer is the 12 verbatim categories and
// the 3-value market attribute joined in by the wide view.
//
// 2026-05-26 Phase L2 addition: also emits gpPerCategory rows -- one row
// per (year, category_order) carrying the GP RATE (e.g. 0.90 for
// "1. Courses/masterclasses") read verbatim from each Sales YYYY tab's own
// "GP Amount" grid (column J on the row whose column I label matches the
// category). GP rate IS year-specific (e.g. Workshops Non-Res 2025 = 0.80,
// 2026 = 0.75 -- real margin change, fuel/hotel costs). Storing per-year
// is non-negotiable -- never harmonise one year's rate onto another year's
// revenue.
//
// 2026-05-26 Phase L2 addition (continued): also emits transactionRows --
// one row per booking line item from the per-booking detail block below the
// summary grids (header row "Date | Client | Category | Funding | Amount |
// Event | Source" in cols A..G, around row 167-169 depending on sheet).
// Each row carries: txn_date, client_name, category_label, funding (banking
// source: Stripe/Bank/PayPal/...), amount £, event_label, booking_source
// (raw col G: "Google"/"Existing"/"JLR"/"Into The Blue"/...), and two
// derived fields: client_type ('Existing' if source = 'Existing' else 'New')
// and channel (NULL if Existing else the booking source). The Revenue Truth
// tab uses these for unit counts, channel mix, new-vs-existing, and
// funding/fees breakdowns -- per the rule that channel/funding/client splits
// must be computed FROM transaction rows, never from cached grid-summary
// cells (those cells were proven unreliable).

import xlsx from 'xlsx';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LABEL_COL = 8;          // column I
const TARGET_COL = 9;         // column J
const FIRST_MONTH_COL = 10;   // column K (Jan)
const LAST_MONTH_COL = 21;    // column V (Dec)
const YEAR_TOTAL_COL = 22;    // column W
const TOTALS_ROW_LABEL_RE = /^total/i;
const SHEET_NAME_RE = /^sales\s+(\d{4})$/i;
const GP_AMOUNT_HEADER_RE = /^gp\s*amount$/i;
const GP_GRID_MAX_ROWS_BELOW_HEADER = 20;

// Transaction-block constants. Header is "Date | Client | Category | Funding
// | Amount | Event | Source" in cols A..G. We scan col A for that "Date"
// header (case-insensitive), then read rows downward until a row's date
// cell becomes empty / non-numeric.
const TXN_HEADER_LABEL_RE = /^date$/i;
const TXN_HEADER_MIN_ROW = 100;        // detail block sits well below the summary
const TXN_HEADER_MAX_ROW = 250;
const TXN_MAX_DATA_ROWS = 2000;
const TXN_DATE_COL = 0;              // A
const TXN_CLIENT_COL = 1;            // B
const TXN_CATEGORY_COL = 2;          // C
const TXN_FUNDING_COL = 3;           // D
const TXN_AMOUNT_COL = 4;            // E
const TXN_EVENT_COL = 5;             // F
const TXN_SOURCE_COL = 6;            // G
const TXN_CANONICAL_PRODUCT_COL = 8; // I  (Phase A: user-tagged authoritative product)
const TXN_LANDING_PAGE_COL = 9;      // J  (Phase A: user-tagged authoritative landing page)
const TXN_EXISTING_SOURCE = 'existing';

// Legacy export retained so older callers don't crash on import. Phase L1
// strips this from any meaningful use.
export const TIER_IDS = Object.freeze([]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function readWorkbookFromBuffer(buffer) {
  return xlsx.read(buffer, { type: 'buffer', cellDates: true });
}

/** 2024 sheet used "12. Other"; treat as Academy for market + reporting. */
export function normalizeCategoryLabel(label) {
  const s = String(label || '').trim();
  return s === '12. Other' ? '12. Academy' : s;
}

// Parse "Sales YYYY" tabs in the workbook. Returns:
//   {
//     monthlyPerCategory: [ { property_url, year, month, category_order,
//                             category_label, revenue_amount,
//                             source_workbook, source_cell_range } ],
//     gpPerCategory:      [ { property_url, year, category_order,
//                             category_label, gp_rate, source_workbook,
//                             source_cell } ],
//     transactionRows:    [ { property_url, year, source_workbook,
//                             source_row, txn_date (ISO YYYY-MM-DD),
//                             client_name, category_label, category_order,
//                             funding, amount, event_label, booking_source,
//                             client_type, channel } ],
//     verification: [ { sheet, year, monthlyTotalsRow, derivedFromCategories,
//                       ytdActualValue, ytdActualCell, reconciles } ],
//     warnings:     [ string ]
//   }
//
// Options:
//   propertyUrl:  defaults to https://www.alanranger.com
//   minYear:      defaults to 2024. Sales 2024 uses the modern 12-category
//                 grid; "12. Other" is normalised to "12. Academy" on import.
export function parseBookingSheetTruth(workbook, options = {}) {
  const propertyUrl = options.propertyUrl || 'https://www.alanranger.com';
  const minYear = options.minYear ?? 2024;
  const monthlyPerCategory = [];
  const gpPerCategory = [];
  const transactionRows = [];
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
    for (const r of sheetParse.categoryRows) {
      monthlyPerCategory.push({ property_url: propertyUrl, source_workbook: sheetName, ...r });
    }
    for (const r of sheetParse.gpRows) {
      gpPerCategory.push({ property_url: propertyUrl, source_workbook: sheetName, ...r });
    }
    for (const r of sheetParse.txnRows) {
      transactionRows.push({ property_url: propertyUrl, source_workbook: sheetName, ...r });
    }
    verification.push(sheetParse.verification);
  }

  return { monthlyPerCategory, gpPerCategory, transactionRows, verification, warnings };
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
  const gpRows = buildGpRows(ws, range, year);
  const txnRows = buildTransactionRows(ws, range, year);

  return {
    categoryRows: buildCategoryRows(year, dataRows),
    gpRows,
    txnRows,
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

function buildCategoryRows(year, dataRows) {
  const out = [];
  // Prefer the leading number from the label (1..12 on modern sheets) and
  // fall back to the row-position sequence (1, 2, 3, ...) on older sheets
  // where some categories lack a leading number. This keeps category_order
  // unique per (year, month) - that's the primary key.
  dataRows.forEach((cat, idx) => {
    const order = parseCategoryOrder(cat.label) || (idx + 1);
    for (let m = 0; m < 12; m += 1) {
      const v = cat.monthly[m];
      if (v === 0) continue;
      out.push({
        year,
        month: m + 1,
        category_order: order,
        category_label: normalizeCategoryLabel(cat.label),
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

// Reconciliation: derived sum of all 12 categories for the year MUST equal
// the sheet's own "YTD Actual" cell (J47/J48) to the penny. This is what the
// import gate checks.
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
// Transaction block (per-booking detail rows below the summary grids)
// ---------------------------------------------------------------------------
//
// Header row in cols A..G: "Date | Client | Category | Funding | Amount |
// Event | Source". Position varies per sheet (~167-169 in current modern
// books) so we scan col A in the safe window TXN_HEADER_MIN_ROW ..
// TXN_HEADER_MAX_ROW for the literal "Date" header. Data rows below it
// continue until col A is no longer a numeric date.
//
// "Source" (col G) is the booking source. The literal "Existing" means an
// existing client (no acquisition channel). Anything else (Google, JLR,
// Into The Blue, Referral, Artfully Walls, ChatGPT, etc.) is a new-client
// channel. We derive client_type + channel from this single column.

function findTxnHeaderRow(ws, range) {
  const lo = Math.max(range.s.r, TXN_HEADER_MIN_ROW);
  const hi = Math.min(range.e.r, TXN_HEADER_MAX_ROW);
  for (let r = lo; r <= hi; r += 1) {
    const cell = ws[xlsx.utils.encode_cell({ r, c: TXN_DATE_COL })];
    if (!cell) continue;
    if (TXN_HEADER_LABEL_RE.test(String(cell.v || '').trim())) return r;
  }
  return -1;
}

function readTxnCell(ws, r, c) {
  const cell = ws[xlsx.utils.encode_cell({ r, c })];
  if (!cell) return null;
  const v = cell.v;
  if (v === undefined || v === null || v === '') return null;
  return v;
}

function deriveClientFields(rawSource) {
  const src = rawSource == null ? '' : String(rawSource).trim();
  if (!src) return { booking_source: null, client_type: 'New', channel: null };
  if (src.toLowerCase() === TXN_EXISTING_SOURCE) {
    return { booking_source: src, client_type: 'Existing', channel: null };
  }
  return { booking_source: src, client_type: 'New', channel: src };
}

function buildOneTxnRow(ws, r, year) {
  const txnDate = readTxnDate(ws, r);
  if (!txnDate) return null;
  const category = readTxnCell(ws, r, TXN_CATEGORY_COL);
  if (!category) return null;
  const amount = toNum(readTxnCell(ws, r, TXN_AMOUNT_COL));
  if (!amount) return null;        // skip rows with no money attached
  const categoryLabel = normalizeCategoryLabel(String(category).trim());
  const order = parseCategoryOrder(categoryLabel) || null;
  const funding = readTxnCell(ws, r, TXN_FUNDING_COL);
  const event = readTxnCell(ws, r, TXN_EVENT_COL);
  const client = readTxnCell(ws, r, TXN_CLIENT_COL);
  const derived = deriveClientFields(readTxnCell(ws, r, TXN_SOURCE_COL));
  // Phase A: cols I + J carry the user's authoritative canonical product +
  // landing page tags. Read VERBATIM -- never re-derive from event_text via
  // the flat event_product_mapping CSV (the workbook also applies client-
  // name and category-level overrides that the flat lookup cannot express).
  const canonicalProduct = readTxnText(ws, r, TXN_CANONICAL_PRODUCT_COL);
  const landingPageUrl   = readTxnText(ws, r, TXN_LANDING_PAGE_COL);
  return {
    year,
    source_row: r + 1,
    txn_date: txnDate,
    client_name: client == null ? null : String(client).trim() || null,
    category_label: categoryLabel,
    category_order: order,
    funding: funding == null ? null : String(funding).trim() || null,
    amount: round2(amount),
    event_label: event == null ? null : String(event).trim() || null,
    canonical_product: canonicalProduct,
    landing_page_url: landingPageUrl,
    ...derived
  };
}

function readTxnText(ws, r, c) {
  const v = readTxnCell(ws, r, c);
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function buildTransactionRows(ws, range, year) {
  const header = findTxnHeaderRow(ws, range);
  if (header < 0) return [];
  const out = [];
  const lastRow = Math.min(range.e.r, header + TXN_MAX_DATA_ROWS);
  let blankRun = 0;
  // The user's workbook can have very large gaps (e.g. Sales 2026 has 13
  // blank rows between the "Date" header at row 169 and the first txn at
  // row 183 because the rows above were used for a deprecated layout).
  // 50 consecutive empties is a comfortable margin while still terminating
  // before we scan to the bottom of the sheet.
  for (let r = header + 1; r <= lastRow; r += 1) {
    const row = buildOneTxnRow(ws, r, year);
    if (!row) {
      blankRun += 1;
      if (blankRun >= 50) break;
      continue;
    }
    blankRun = 0;
    out.push(row);
  }
  return out;
}

function excelSerialToIsoDate(serial) {
  // Excel epoch: 1899-12-30 (accounts for the historical 1900 leap-year bug).
  const epochMs = Date.UTC(1899, 11, 30);
  const ms = epochMs + Math.round(serial) * 24 * 60 * 60 * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// xlsx is read with { cellDates: true } so date cells arrive as JS Date
// instances rather than Excel serial numbers. Handle both shapes so the
// parser is resilient to either reader config.
function readTxnDate(ws, r) {
  const v = readTxnCell(ws, r, TXN_DATE_COL);
  if (v == null) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === 'number' && Number.isFinite(v) && v >= 1) {
    return excelSerialToIsoDate(v);
  }
  return null;
}

// ---------------------------------------------------------------------------
// GP grid (per-year, per-category gross-profit rate)
// ---------------------------------------------------------------------------
//
// The "GP Amount" grid lives below the main revenue grid in each Sales YYYY
// tab. Layout (Sales 2025 example):
//   row 97: col I = "Tuition Categories"; col J = "GP Amount"; K..V = month
//           names; W = "Year"
//   row 98+: col I = category label; col J = GP RATE for this category in
//            this year (e.g. 0.90 = 90%); K..V = monthly GP money; W = year
//            money
//
// 2026 has the same layout but the header row is one lower because the
// transactional detail above is one row taller. The header position varies
// per sheet so we scan column J for the "GP Amount" label.

function findGpHeaderRow(ws, range) {
  const maxR = Math.min(range.e.r, 200);
  for (let r = range.s.r; r <= maxR; r += 1) {
    const cell = ws[xlsx.utils.encode_cell({ r, c: TARGET_COL })];
    if (!cell) continue;
    if (GP_AMOUNT_HEADER_RE.test(String(cell.v || '').trim())) return r;
  }
  return -1;
}

function readOneGpRow(ws, r) {
  const labelCell = ws[xlsx.utils.encode_cell({ r, c: LABEL_COL })];
  const label = labelCell ? String(labelCell.v || '').trim() : '';
  if (!label) return null;
  if (TOTALS_ROW_LABEL_RE.test(label)) return null;
  const rateCell = ws[xlsx.utils.encode_cell({ r, c: TARGET_COL })];
  const rate = toNum(rateCell?.v);
  if (rate <= 0 || rate > 1) return null;
  return { label, rate, sourceCell: `J${r + 1}` };
}

function buildGpRows(ws, range, year) {
  const gpHeader = findGpHeaderRow(ws, range);
  if (gpHeader < 0) return [];
  const out = [];
  const seen = new Set();
  const lastRow = Math.min(range.e.r, gpHeader + GP_GRID_MAX_ROWS_BELOW_HEADER);
  for (let r = gpHeader + 1; r <= lastRow; r += 1) {
    const row = readOneGpRow(ws, r);
    if (!row) continue;
    const order = parseCategoryOrder(row.label) || (out.length + 1);
    if (seen.has(order)) continue;
    seen.add(order);
    out.push({
      year,
      category_order: order,
      category_label: normalizeCategoryLabel(row.label),
      gp_rate: round5(row.rate),
      source_cell: row.sourceCell
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round5(n) {
  return Number((Number(n) || 0).toFixed(5));
}

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

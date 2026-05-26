// Discovery-only: read the Sales 2025 + Sales 2026 monthly category grids
// straight from the Booking Sheet workbooks the user has confirmed are the
// single source of truth for total revenue. Writes nothing.
//
// Output (stdout, JSON):
//   {
//     sheets: {
//       'Sales 2025': {
//         categories:[ { row, label, monthly:[...12 values], total } ],
//         monthTotals:[...12], ytdActual, gridSum, sheetName
//       },
//       'Sales 2026': { ... }
//     },
//     dumpedTopRows: { sheetName: [[row1...], [row2...]] }
//   }

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import xlsx from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const BOOKS = [
  { year: 2026, file: 'G:/Dropbox/1. Bookings/Booking Sheet 2026 - Alan Ranger Photography.xlsm' }
];

function readWorkbook(p) {
  const buf = fs.readFileSync(p);
  return xlsx.read(buf, { type: 'buffer', cellDates: true });
}

function dumpRows(ws, maxRow = 50, maxCol = 40) {
  const out = [];
  const ref = ws['!ref'];
  if (!ref) return out;
  for (let r = 0; r < maxRow; r += 1) {
    const row = [];
    for (let c = 0; c < maxCol; c += 1) {
      const addr = xlsx.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (cell == null) { row.push(null); continue; }
      let v = cell.v;
      if (v instanceof Date) v = v.toISOString().slice(0, 10);
      if (typeof v === 'number') v = Number(v.toFixed(4));
      row.push(v);
    }
    out.push(row);
  }
  return out;
}

function toNum(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[£,\s]/g, '');
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

// Heuristics:
//  - The category grid lives on `Sales YYYY` tab.
//  - Column A holds category labels (Courses, Workshops Non-Res, etc).
//  - Columns B..M (or thereabouts) hold the 12 monthly columns.
//  - Column N (or wherever the row ends) holds the row total.
//  - There is also a "Totals" row at the bottom of the category list and a
//    "YTD Actual" cell somewhere on the sheet.
// The Sales 2025 / Sales 2026 sheets share the same shape:
//   - row 5 has "Tuition Categories" in col I (index 8) and "Target" in col J (index 9)
//   - columns K..V (index 10..21) hold the 12 monthly cells (Jan..Dec)
//   - column W (index 22) holds the row's "Year" total
//   - the category list starts at row 6, each labelled "1. Courses/masterclasses",
//     "2. Workshops Non Residential", etc., and ends at a "Totals" row
//   - the "YTD Actual" label sits in col I (column 8) somewhere below the
//     grid, with its numeric value in col J (column 9)
function extractCategoryGrid(ws) {
  const ref = ws['!ref'];
  if (!ref) return null;
  const range = xlsx.utils.decode_range(ref);

  // Anchor: find either "Tuition Categories" (2025 sheet) or "Sales Categories"
  // (2026 sheet) in col index 8 (column I).
  let headerRow = -1;
  for (let r = range.s.r; r <= Math.min(range.e.r, 40); r += 1) {
    const cell = ws[xlsx.utils.encode_cell({ r, c: 8 })];
    if (!cell) continue;
    const s = String(cell.v || '').trim().toLowerCase();
    if (s === 'tuition categories' || s === 'sales categories') {
      headerRow = r;
      break;
    }
  }
  if (headerRow < 0) return { error: 'header row (Tuition/Sales Categories) not found in col I' };

  const LABEL_COL = 8;      // col I
  const TARGET_COL = 9;     // col J
  const FIRST_MONTH_COL = 10; // col K (Jan)
  const LAST_MONTH_COL = 21;  // col V (Dec)
  const YEAR_TOTAL_COL = 22;  // col W

  const categories = [];
  let totalsRow = null;
  for (let r = headerRow + 1; r <= Math.min(range.e.r, headerRow + 40); r += 1) {
    const labelCell = ws[xlsx.utils.encode_cell({ r, c: LABEL_COL })];
    const label = labelCell ? String(labelCell.v || '').trim() : '';
    if (!label) continue;
    const target = toNum(ws[xlsx.utils.encode_cell({ r, c: TARGET_COL })]?.v);
    const monthly = [];
    for (let c = FIRST_MONTH_COL; c <= LAST_MONTH_COL; c += 1) {
      monthly.push(toNum(ws[xlsx.utils.encode_cell({ r, c })]?.v));
    }
    const yearTotal = toNum(ws[xlsx.utils.encode_cell({ r, c: YEAR_TOTAL_COL })]?.v);
    const monthlySum = monthly.reduce((a, b) => a + b, 0);
    const entry = {
      row: r + 1,
      label,
      target,
      monthly: monthly.map(v => Number(v.toFixed(2))),
      yearTotal: Number(yearTotal.toFixed(2)),
      monthlySum: Number(monthlySum.toFixed(2)),
      sumMatchesYearTotal: Math.abs(monthlySum - yearTotal) < 0.01
    };
    if (/^total/i.test(label)) {
      totalsRow = entry;
      break;
    }
    categories.push(entry);
  }

  // YTD Actual label (in col I), value in col J
  let ytdActual = null;
  let ytdAt = null;
  let ytdLabelRow = null;
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    const lc = ws[xlsx.utils.encode_cell({ r, c: LABEL_COL })];
    if (!lc) continue;
    const s = String(lc.v || '').trim().toLowerCase();
    if (s === 'ytd actual' || s === 'ytd actuals' || s.startsWith('ytd actual')) {
      const vCell = ws[xlsx.utils.encode_cell({ r, c: TARGET_COL })];
      if (vCell) {
        ytdActual = Number(toNum(vCell.v).toFixed(2));
        ytdAt = `J${r + 1}`;
        ytdLabelRow = r + 1;
      }
      break;
    }
  }

  // Recompute monthly totals across categories AND across only positive lines
  // (so the "Out" reattribution lines don't make Workshops Non-Res look short).
  const monthTotals = [];
  for (let i = 0; i < 12; i += 1) {
    monthTotals.push(Number(categories.reduce((a, c) => a + (c.monthly[i] || 0), 0).toFixed(2)));
  }
  const gridSum = Number(monthTotals.reduce((a, b) => a + b, 0).toFixed(2));

  // Also expose the Totals row from the sheet (if found) as it's the user's
  // canonical Per-Month-Total figure.
  return {
    headerRow: headerRow + 1,
    layout: {
      label: 'I', target: 'J', months: 'K..V (Jan..Dec)', yearTotal: 'W'
    },
    categories,
    totalsRow,
    derivedMonthTotals: monthTotals,
    derivedGridSum: gridSum,
    ytdActual,
    ytdActualAt: ytdAt,
    ytdLabelRow,
    deltaGridVsYtd: ytdActual != null ? Number((gridSum - ytdActual).toFixed(2)) : null
  };
}

function main() {
  const out = { generated_at: new Date().toISOString(), sheets: {} };
  for (const b of BOOKS) {
    if (!fs.existsSync(b.file)) continue;
    const wb = readWorkbook(b.file);
    for (const sheetName of wb.SheetNames) {
      if (!/^Sales \d{4}$/i.test(sheetName)) continue;
      const ws = wb.Sheets[sheetName];
      const grid = extractCategoryGrid(ws);
      out.sheets[sheetName] = grid?.categories
        ? { categoryLabels: grid.categories.map(c => c.label), totalsRow: grid.totalsRow?.label, ytdActual: grid.ytdActual }
        : grid;
    }
  }
  process.stdout.write(JSON.stringify(out, null, 2));
}

main();

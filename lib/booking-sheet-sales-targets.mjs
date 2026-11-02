// Alan's own targets from each "Sales YYYY" tab (Monday brief redesign, batch 8 task 15).
// Rows are found by their labels, not fixed cells:
//   col J "Weighting" / "Monthly Target" / "Working Days" → K..V = Jan..Dec, W = year;
//   category rows under "Sales Categories" (col I) → col J = flat monthly target;
//   col I "YTD Actual" / "YTD Var to target" → col J.
import xlsx from 'xlsx';

const LABEL_COL = 8;   // I
const TARGET_COL = 9;  // J
const FIRST_MONTH_COL = 10;
const YEAR_COL = 22;
const SHEET_NAME_RE = /^sales\s+(\d{4})$/i;
const HEADER_RE = /^(tuition|sales) categories$/i;
const CATEGORY_RE = /^(\d{1,2})\.?\s+\S/;

function cellVal(ws, r, c) {
  return ws[xlsx.utils.encode_cell({ r, c })]?.v;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function findRow(ws, col, re, fromRow, toRow) {
  for (let r = fromRow; r <= toRow; r += 1) {
    if (re.test(String(cellVal(ws, r, col) ?? '').trim())) return r;
  }
  return -1;
}

function monthRow(ws, r) {
  const out = [];
  for (let c = FIRST_MONTH_COL; c < FIRST_MONTH_COL + 12; c += 1) out.push(num(cellVal(ws, r, c)) ?? 0);
  return out;
}

function categoryTargets(ws, headerRow) {
  const targets = {};
  const labels = {};
  for (let r = headerRow + 1; r <= headerRow + 20; r += 1) {
    const label = String(cellVal(ws, r, LABEL_COL) ?? '').trim();
    if (/^total/i.test(label)) break;
    const m = CATEGORY_RE.exec(label);
    if (!m) continue;
    targets[m[1]] = num(cellVal(ws, r, TARGET_COL)) ?? 0;
    labels[m[1]] = label;
  }
  return { targets, labels };
}

/** One sheet → targets row, or { error }. */
export function parseSalesTargetsSheet(ws, year, sheetName) {
  const weightRow = findRow(ws, TARGET_COL, /^weighting$/i, 0, 12);
  const targetRow = findRow(ws, TARGET_COL, /^monthly target$/i, 0, 12);
  const daysRow = findRow(ws, TARGET_COL, /^working days$/i, 0, 12);
  const headerRow = findRow(ws, LABEL_COL, HEADER_RE, 0, 40);
  if (targetRow < 0 || daysRow < 0 || weightRow < 0 || headerRow < 0) {
    return { error: `${sheetName}: target rows not found (weighting ${weightRow}, monthly ${targetRow}, days ${daysRow}, header ${headerRow})` };
  }
  const ytdRow = findRow(ws, LABEL_COL, /^ytd actual$/i, headerRow, headerRow + 80);
  const varRow = findRow(ws, LABEL_COL, /^ytd var to target$/i, headerRow, headerRow + 80);
  const { targets, labels } = categoryTargets(ws, headerRow);
  return {
    year,
    source_workbook: sheetName,
    monthly_target: monthRow(ws, targetRow).map((v) => Math.round(v * 100) / 100),
    working_days: monthRow(ws, daysRow).map((v) => Math.round(v)),
    weighting: monthRow(ws, weightRow),
    annual_target: num(cellVal(ws, targetRow, YEAR_COL)),
    category_targets: targets,
    category_labels: labels,
    ytd_actual: ytdRow >= 0 ? num(cellVal(ws, ytdRow, TARGET_COL)) : null,
    ytd_var: varRow >= 0 ? num(cellVal(ws, varRow, TARGET_COL)) : null
  };
}

export function parseSalesTargets(workbook, { minYear = 2026 } = {}) {
  const rows = [];
  const warnings = [];
  for (const sheetName of workbook.SheetNames) {
    const m = SHEET_NAME_RE.exec(sheetName);
    if (!m || Number(m[1]) < minYear) continue;
    const parsed = parseSalesTargetsSheet(workbook.Sheets[sheetName], Number(m[1]), sheetName);
    if (parsed.error) warnings.push(parsed.error);
    else rows.push(parsed);
  }
  return { rows, warnings };
}

export async function persistSalesTargets(supabase, propertyUrl, parsed) {
  const rows = (parsed?.rows || []).map((r) => ({ ...r, property_url: propertyUrl, imported_at: new Date().toISOString() }));
  if (!rows.length) return { written: 0, warnings: parsed?.warnings || [] };
  const { error } = await supabase.from('booking_sheet_sales_targets').upsert(rows, { onConflict: 'property_url,year' });
  if (error) throw new Error(`sales_targets_upsert:${error.message}`);
  return { written: rows.length, warnings: parsed.warnings || [] };
}

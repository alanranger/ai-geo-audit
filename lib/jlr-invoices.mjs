/**
 * JLR Bookings tab → outstanding invoices for Strategy "Cash to collect".
 * A row counts in its due month only after it is invoiced. Paid rows drop out.
 * No email is stored.
 */
import xlsx from 'xlsx';
import { toExcelDate } from './excel-date.mjs';

const SHEET = /^jlr bookings$/i;
const HEADS = [
  ['event_name', /^course name$/],
  ['event_date', /^start date$/],
  ['client_name', /^requestor name$/],
  ['invoice_date', /^invoice$/],
  ['invoice_no', /^invoice ref$/],
  ['due_date', /^due$/],
  ['paid_amount', /^paid$/],
  ['paid_date', /^date$/],
  ['outstanding', /^outstanding$/]
];

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const money = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(String(v ?? '').replace(/[£,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const same = (a, b) => norm(a) === norm(b) && norm(a) !== '';

export function shortEvent(name) {
  const s = String(name || '');
  if (/1-2-1|one to one/i.test(s)) return '1-2-1';
  const word = s.split(/\s+/).find((w) => w.length > 2 && !/photography|workshop|classes|classic/i.test(w));
  return word || 'JLR';
}

function headerMap(header) {
  const names = header.map(norm);
  const out = {};
  for (const [key, re] of HEADS) out[key] = names.findIndex((h) => re.test(h));
  return out.outstanding >= 0 && out.client_name >= 0 ? out : null;
}

function parseRow(row, cols, sourceRow) {
  const client = String(row[cols.client_name] ?? '').trim();
  const outstanding = money(row[cols.outstanding]);
  if (!client || !(outstanding > 0)) return null;
  return {
    client_name: client,
    event_name: String(row[cols.event_name] ?? '').trim() || null,
    event_date: toExcelDate(row[cols.event_date]),
    invoice_no: String(row[cols.invoice_no] ?? '').trim() || null,
    invoice_date: toExcelDate(row[cols.invoice_date]),
    due_date: toExcelDate(row[cols.due_date]),
    paid_amount: money(row[cols.paid_amount]),
    paid_date: toExcelDate(row[cols.paid_date]),
    outstanding,
    source_row: sourceRow
  };
}

/** Outstanding JLR rows from a workbook. Totals and blank names are skipped. */
export function parseJlrInvoices(wb) {
  const name = (wb.SheetNames || []).find((n) => SHEET.test(String(n).trim()));
  if (!name) return [];
  const grid = xlsx.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
  let cols = null;
  let header = 0;
  for (let i = 0; i < Math.min(15, grid.length); i++) {
    cols = headerMap(grid[i] || []);
    if (cols) { header = i; break; }
  }
  if (!cols) return [];
  const rows = [];
  for (let r = header + 1; r < grid.length; r++) {
    const out = parseRow(grid[r] || [], cols, r + 1);
    if (out) rows.push(out);
  }
  return rows;
}

const paidOnSheet = (row) => !!row.paid_date || (Number(row.paid_amount) > 0 && Number(row.paid_amount) >= Number(row.outstanding));
const matchedSale = (row, txns) => (txns || []).some((t) => t.is_jlr && same(t.client_name, row.client_name) && Math.abs((Number(t.amount) || 0) - Number(row.outstanding)) < 0.01);
const invoiced = (row, today) => !!row.invoice_no || (!!row.invoice_date && row.invoice_date <= today);

const dueLabel = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : 'no due date');

/**
 * Invoiced unpaid rows, grouped for the cash-to-collect month.
 * A due date before today counts in the current month (amber, red at 30 days).
 * Not-yet-invoiced rows are listed and not added.
 */
export function jlrCash(rows, { today, txns = [] } = {}) {
  const current = String(today || '').slice(0, 7);
  const byMonth = {};
  const groups = new Map();
  const pending = [];
  for (const row of rows || []) {
    if (!(Number(row.outstanding) > 0) || paidOnSheet(row) || matchedSale(row, txns)) continue;
    if (!invoiced(row, today)) {
      pending.push(row);
      continue;
    }
    const late = row.due_date && row.due_date < today;
    const days = late ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${row.due_date}T00:00:00Z`)) / 864e5) : 0;
    const month = !row.due_date || late ? current : row.due_date.slice(0, 7);
    const tone = days >= 30 ? 'red' : (late ? 'amber' : '');
    byMonth[month] = (byMonth[month] || 0) + Number(row.outstanding);
    const key = `${month}|${shortEvent(row.event_name)}|${row.due_date || ''}|${tone}`;
    const g = groups.get(key) || { month, event: shortEvent(row.event_name), due_date: row.due_date, tone, count: 0, gbp: 0 };
    g.count += 1;
    g.gbp += Number(row.outstanding);
    groups.set(key, g);
  }
  const lines = [...groups.values()].map((g) => ({
    month: g.month,
    gbp: Math.round(g.gbp * 100) / 100,
    counted: true,
    tone: g.tone,
    chip: g.tone ? 'Overdue' : 'Invoiced',
    label: `JLR · ${g.event} ×${g.count} · due ${dueLabel(g.due_date)}`
  }));
  for (const row of pending) {
    const month = (row.due_date || row.invoice_date || today).slice(0, 7);
    lines.push({
      month, gbp: Number(row.outstanding), counted: false, tone: 'wait', chip: 'To invoice',
      label: `JLR · ${shortEvent(row.event_name)} · due ${dueLabel(row.due_date)}`
    });
  }
  return { by_month: byMonth, lines };
}

export async function persistJlrInvoices(supabase, propertyUrl, rows, filename) {
  const { error: delErr } = await supabase.from('booking_sheet_jlr_invoices').delete().eq('property_url', propertyUrl);
  if (delErr) throw delErr;
  const imported_at = new Date().toISOString();
  const payload = rows.map((r) => ({
    property_url: propertyUrl, source_row: r.source_row, client_name: r.client_name, event_name: r.event_name,
    event_date: r.event_date, invoice_no: r.invoice_no, invoice_date: r.invoice_date, due_date: r.due_date,
    outstanding: r.outstanding, imported_at, source_file: filename || null
  }));
  for (let i = 0; i < payload.length; i += 200) {
    const { error } = await supabase.from('booking_sheet_jlr_invoices').insert(payload.slice(i, i + 200));
    if (error) throw error;
  }
  return { written: payload.length };
}

export async function syncJlrInvoices(supabase, propertyUrl, wb, filename) {
  try {
    return await persistJlrInvoices(supabase, propertyUrl, parseJlrInvoices(wb), filename);
  } catch (e) {
    return { written: 0, error: e.message || String(e) };
  }
}

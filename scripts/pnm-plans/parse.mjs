/**
 * Pick n Mix plan statement parser (read-only; never writes to the files). One plan per "Plan Statement" sheet:
 *   header block   B1 client name · B2 email · "Plan Type" / "Starts" / "Ends" rows (value in the next column)
 *   "Payment Schedule" header row → columns by their labels: payment amount (the "Payment Schedule" column),
 *                  "Date Due/ Paid", item, "Price Before Discount", "Price After Discount", "Event Date", "Ref"
 * A payment is a number in the payment column. Its date is the row's "Date Due/ Paid" and is marked reliable only when
 * it falls inside the plan's own start−60d … end+60d (template rows carry formula dates outside it). An allocated event
 * is a row with an item and a price after discount. Layouts that don't have these labels are reported, never guessed.
 */
import XLSX from 'xlsx';

/** Labels in the "Payment Schedule" row. 2016–2019 statements have one "Cost" column instead of before/after prices. */
const HEAD = {
  payment: /^payments?\s+schedule$/i, date: /^date\s+due\s*\/?\s*paid$/i, before: /^price before discount$/i,
  after: /^(price after discount|cost)$/i, eventDate: /^event( \/ due)? date$/i, ref: /^ref( \/ held)?$/i
};
const DAY = 86400000;
const iso = (n) => (typeof n === 'number' && n > 30000 && n < 80000 ? XLSX.SSF.format('yyyy-mm-dd', n) : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v) => (v == null ? '' : String(v).trim());
const SQS_REF = /^#?0*(\d{3,6})$/;

function headerRow(rows) {
  const i = rows.findIndex((r) => (r || []).some((c) => HEAD.payment.test(text(c))));
  if (i < 0) return null;
  const col = {};
  rows[i].forEach((c, j) => { for (const [k, re] of Object.entries(HEAD)) if (col[k] == null && re.test(text(c))) col[k] = j; });
  col.item = col.date != null ? col.date + 2 : null;
  return col.date != null && col.after != null ? { at: i, col } : null;
}

function labelled(rows, label) {
  for (const r of rows.slice(0, 12)) {
    const j = (r || []).findIndex((c) => new RegExp(`^${label}$`, 'i').test(text(c)));
    if (j >= 0) return r[j + 1];
  }
  return null;
}

function emailOf(rows) {
  for (const r of rows.slice(0, 4)) for (const c of r || []) { const s = text(c); if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return s.toLowerCase(); }
  return null;
}

function lineOf(r, col, plan) {
  const amount = num(r[col.payment]);
  const date = iso(r[col.date]);
  const inPlan = !!(date && plan.starts && Date.parse(date) >= Date.parse(plan.starts) - 60 * DAY && (!plan.ends || Date.parse(date) <= Date.parse(plan.ends) + 60 * DAY));
  const item = text(r[col.item]);
  const after = num(r[col.after]);
  const refRaw = text(r[col.ref]);
  const ref = SQS_REF.test(refRaw) ? Number(SQS_REF.exec(refRaw)[1]) : null;
  return {
    payment: amount && amount > 0 ? { amount, paid_on: inPlan ? date : null, date_reliable: inPlan, raw_date: date } : null,
    event: item && after != null ? { item: item.slice(0, 200), price_before: num(r[col.before]), price_after: after, event_date: iso(r[col.eventDate]), order_ref: ref } : null
  };
}

const NAME_HEADING = /^((first|last)\s+)?name$/i;
/** "<Client> 2018 pick n mix plan II.xlsx" → "Client"; null when the file name carries no client (a template). */
export function clientFromFile(fileName) {
  const m = /^(.*?)\s*\d{4}\s*pick\s*n\s*mix\s*plan/i.exec(String(fileName || '').split('/').pop());
  const n = m ? m[1].replace(/\s+/g, ' ').trim() : '';
  return n || null;
}
/**
 * Client name: B1 (or A1) in the current layout. Older statements have "First Name | Last Name" headings in row 1 and
 * the name in row 2; a heading is never a name. The file name is the fallback.
 */
export function clientName(rows, fileName) {
  const r0 = [text(rows[0]?.[1]), text(rows[0]?.[0])];
  if (r0.some((c) => NAME_HEADING.test(c))) {
    const below = [text(rows[1]?.[0]), text(rows[1]?.[1])].filter((c) => c && !c.includes('@')).join(' ').trim();
    if (below) return below;
  }
  return r0.find((c) => c && !NAME_HEADING.test(c)) || clientFromFile(fileName);
}

/** Parse one sheet → { plan, payments, events } or { problem }. */
export function parseSheet(ws, fileName) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: true });
  const head = headerRow(rows);
  if (!head) return { problem: 'no "Payment Schedule" header with date and price columns' };
  const plan = {
    client_name: clientName(rows, fileName), email: emailOf(rows), plan_type: text(labelled(rows, 'plan type')) || null,
    starts: iso(labelled(rows, 'starts')), ends: iso(labelled(rows, 'ends'))
  };
  if (!plan.email && !plan.client_name) return { problem: 'no client name or email in the header' };
  const payments = [];
  const events = [];
  const today = new Date().toISOString().slice(0, 10);
  for (const [k, r] of rows.slice(head.at + 1, head.at + 60).entries()) {
    if (!r) continue;
    if (r.some((c) => /^(total|balance)/i.test(text(c)))) break;
    const l = lineOf(r, head.col, plan);
    if (l.payment) payments.push({ line_no: k + 1, ...l.payment, scheduled_only: !!l.payment.raw_date && l.payment.raw_date > today });
    if (l.event) events.push({ line_no: k + 1, ...l.event });
  }
  return { plan, payments, events };
}

/** Year sheets look like "Plan Statement 2024"; drafts / options / conflicted copies are skipped by file name. */
export const SKIP_FILE = /(conflicted copy|option\s*\d|draft|copy of|~\$)/i;
/** A blank template: the file name starts with the year (no client), e.g. "2018 pick n mix plan.xlsx". */
export const TEMPLATE_FILE = /^\d{4}\s*pick\s*n\s*mix\s*plan/i;
export function planSheets(wb) {
  const named = wb.SheetNames.filter((n) => /plan statement/i.test(n));
  return named.length ? named : wb.SheetNames.slice(0, 1);
}

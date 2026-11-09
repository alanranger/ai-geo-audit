/**
 * Booking Sheet tabs that carry a client's email but have no table of their own (1-2-1's, Mentoring, Gift Vouchers,
 * Master Classes, RPS Course, Intentions, JLR Bookings) → booking_sheet_tab_contacts: one row per named client with
 * an email. Used only as identity evidence (name ↔ email); these rows are not bookings or money (sales come from the
 * Sales tabs). Workshops / Courses-Classes / PnM Plans keep their own tables. "Alt Email" is never used.
 */
import xlsx from 'xlsx';
import { toExcelDate } from './excel-date.mjs';
import { sheetEmail } from './booking-sheet-workshops.mjs';

export const CONTACT_TABS = [
  { tab: '1-2-1', match: /^1-2-1'?s?$/i },
  { tab: 'Mentoring', match: /^mentoring$/i },
  { tab: 'Gift Vouchers', match: /^gift vouchers?$/i },
  { tab: 'Master Classes', match: /^master classes$/i },
  { tab: 'RPS Course', match: /^rps course$/i },
  { tab: 'Intentions', match: /^intentions\b/i },
  { tab: 'JLR Bookings', match: /^jlr bookings$/i, b2b: 'JLR' }
];

const norm = (h) => String(h ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const EMAIL_HEAD = /^(email address|e-?mail|requestor email)$/;

function headerIndex(grid) {
  for (let i = 0; i < Math.min(12, grid.length); i++) if ((grid[i] || []).some((c) => EMAIL_HEAD.test(norm(c)))) return i;
  return -1;
}

/** Name columns: First / Last Name, Requestor Name, or (Mentoring) the two unlabelled columns right after the email. */
function contactColumns(header) {
  const col = (re) => header.findIndex((h) => re.test(h));
  const email = col(EMAIL_HEAD);
  const c = { email, first: col(/^first name$/), last: col(/^last name$/), full: col(/^requestor name$|^client$/), order: col(/order ref|voucher ref|invoice ref|^request id$/), booked: col(/^date booked$/), event: col(/^event date( 1)?$|^start date$/) };
  if (c.first < 0 && c.full < 0 && !header[email + 1] && !header[email + 2]) Object.assign(c, { first: email + 1, last: email + 2 });
  return c;
}

const cell = (row, i) => (i >= 0 ? String(row[i] ?? '').trim() : '');

function contactRow(row, c, base) {
  const email = sheetEmail(row[c.email]);
  const first = cell(row, c.first);
  const last = cell(row, c.last);
  const client = cell(row, c.full) || [first, last].filter(Boolean).join(' ');
  if (!email || !client) return null;
  return {
    ...base, first_name: first || null, last_name: last || null, client_name: client, email, order_ref: cell(row, c.order) || null,
    date_booked: c.booked >= 0 ? toExcelDate(row[c.booked]) : null, event_date: c.event >= 0 ? toExcelDate(row[c.event]) : null
  };
}

function parseTab(wb, name, def, base) {
  const grid = xlsx.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
  const hi = headerIndex(grid);
  if (hi < 0) return [];
  const c = contactColumns((grid[hi] || []).map(norm));
  const rows = [];
  for (let r = hi + 1; r < grid.length; r++) {
    const out = contactRow(grid[r] || [], c, { ...base, tab: def.tab, source_row: r + 1 });
    if (out) rows.push(out);
  }
  return rows;
}

/** @returns {{ rows: object[], tabs: Record<string, number> }} rows per tab = named clients with an email. */
export function parseContactTabs(wb, { propertyUrl, sourceFile = null } = {}) {
  const base = { property_url: propertyUrl, imported_at: new Date().toISOString(), source_file: sourceFile };
  const rows = [];
  const tabs = {};
  for (const name of wb.SheetNames || []) {
    const def = CONTACT_TABS.find((d) => d.match.test(String(name).trim()));
    if (!def) continue;
    const got = parseTab(wb, name, def, base);
    tabs[def.tab] = (tabs[def.tab] || 0) + got.length;
    rows.push(...got);
  }
  return { rows, tabs };
}

/** Replace this property's contact rows (a sheet without these tabs leaves the table empty for it). */
export async function persistContactTabs(supabase, propertyUrl, parsed) {
  const { error: delErr } = await supabase.from('booking_sheet_tab_contacts').delete().eq('property_url', propertyUrl);
  if (delErr) throw delErr;
  let written = 0;
  for (let i = 0; i < parsed.rows.length; i += 200) {
    const slice = parsed.rows.slice(i, i + 200);
    const { error } = await supabase.from('booking_sheet_tab_contacts').insert(slice);
    if (error) throw error;
    written += slice.length;
  }
  return { written, tabs: parsed.tabs };
}

/** Upload step: parse + persist; never throws (the upload reports the error beside the other tabs). */
export async function syncContactTabs(supabase, propertyUrl, wb, filename) {
  try {
    return await persistContactTabs(supabase, propertyUrl, parseContactTabs(wb, { propertyUrl, sourceFile: filename || null }));
  } catch (e) {
    return { written: 0, tabs: {}, error: e.message || String(e) };
  }
}

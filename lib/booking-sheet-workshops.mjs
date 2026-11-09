/**
 * Parse Booking Sheet "Workshops" tab → booking_sheet_workshop_attendees rows.
 * Header uses "Event Date" (not Start) + First/Last Name + "Email Address" (trimmed, lower-cased for matching).
 */
import xlsx from 'xlsx';
import { toExcelDate } from './excel-date.mjs';

function toNum(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[£,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function isMultiDay(start, end, durationText) {
  if (start && end && end > start) return true;
  const m = String(durationText || '').match(/(\d+)\s*Days?/i);
  return m ? Number(m[1]) >= 2 : false;
}

function findWorkshopsSheet(wb) {
  const names = wb.SheetNames || [];
  return names.find((n) => /^workshops$/i.test(String(n).trim()))
    || names.find((n) => /^workshops\b/i.test(String(n).trim()));
}

/** A sheet email, trimmed and lower-cased; anything without "@" is not an address. */
export function sheetEmail(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}

function headerRow(grid) {
  for (let i = 0; i < Math.min(10, grid.length); i++) {
    const line = (grid[i] || []).map((c) => String(c).toLowerCase()).join('|');
    if (/event date|start date|^start/.test(line) && (/theme|location|workshop|first name|client|paid/.test(line))) return i;
  }
  return 0;
}

/** Column indexes ("Event Date" must NOT be captured as theme via /event/). */
function workshopColumns(header) {
  const col = (re) => header.findIndex((h) => re.test(h));
  return {
    start: col(/^event date$|event date|start date|^start$/), end: col(/^end$|end date/), theme: col(/workshop-location|theme\/|location\/theme|^theme|location/),
    dur: col(/duration/), source: col(/^source$/), order: col(/order|ref/), paid: col(/^paid$/), bal: col(/balance/),
    first: col(/^first name$/), last: col(/^last name$/), client: col(/^client$|customer/), email: col(/^email address$|^e-?mail$/)
  };
}

const at = (row, i) => (i >= 0 ? row[i] : null);
const text = (row, i) => String(at(row, i) ?? '').trim();

function workshopRow(row, c, base) {
  const event_start = c.start >= 0 ? toExcelDate(row[c.start]) : null;
  const event_end = c.end >= 0 ? toExcelDate(row[c.end]) : null;
  const duration_text = text(row, c.dur);
  const client_name = text(row, c.client) || [text(row, c.first), text(row, c.last)].filter(Boolean).join(' ').trim();
  if (!event_start && !client_name) return null;
  return {
    ...base, event_start, event_end, theme_location: text(row, c.theme) || null, duration_text: duration_text || null,
    source: text(row, c.source) || null, order_ref: text(row, c.order) || null, paid: c.paid >= 0 ? toNum(row[c.paid]) : null,
    balance: c.bal >= 0 ? toNum(row[c.bal]) : null, client_name: client_name || null, email: sheetEmail(at(row, c.email)),
    is_multi_day: isMultiDay(event_start, event_end, duration_text)
  };
}

function multiDayEvents(rows) {
  const byEvent = new Map();
  for (const r of rows) {
    if (!r.is_multi_day || !r.event_start) continue;
    const key = `${r.event_start}|${r.event_end || ''}|${r.theme_location || ''}`;
    if (!byEvent.has(key)) byEvent.set(key, { event_start: r.event_start, event_end: r.event_end, theme_location: r.theme_location, paying_clients: 0 });
    if (r.client_name) byEvent.get(key).paying_clients += 1;
  }
  return [...byEvent.values()].sort((a, b) => String(a.event_start).localeCompare(String(b.event_start)));
}

/**
 * @returns {{ rows: object[], sheet: string|null, multiDayEvents: object[], dateNullPct: number }}
 */
export function parseWorkshopsTab(wb, { propertyUrl, sourceFile = null } = {}) {
  const sheetName = findWorkshopsSheet(wb);
  if (!sheetName) return { rows: [], sheet: null, multiDayEvents: [], dateNullPct: 0 };
  const grid = xlsx.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: '' });
  if (!grid.length) return { rows: [], sheet: sheetName, multiDayEvents: [], dateNullPct: 0 };
  const headerIdx = headerRow(grid);
  const c = workshopColumns((grid[headerIdx] || []).map((h) => String(h || '').trim().toLowerCase()));
  const base = { property_url: propertyUrl, imported_at: new Date().toISOString(), source_file: sourceFile };
  const rows = [];
  for (let r = headerIdx + 1; r < grid.length; r++) {
    const row = grid[r] || [];
    if (!row.some((x) => String(x || '').trim())) continue;
    const out = workshopRow(row, c, base);
    if (out) rows.push(out);
  }
  const dateNull = rows.filter((r) => !r.event_start).length;
  const dateNullPct = rows.length ? Math.round((dateNull / rows.length) * 1000) / 10 : 0;
  return { rows, sheet: sheetName, multiDayEvents: multiDayEvents(rows), dateNullPct };
}

export async function persistWorkshopAttendees(supabase, propertyUrl, parsed) {
  if (!parsed?.rows?.length) {
    return {
      written: 0,
      sheet: parsed?.sheet || null,
      multiDayEvents: parsed?.multiDayEvents || [],
      dateNullPct: parsed?.dateNullPct || 0
    };
  }
  await supabase.from('booking_sheet_workshop_attendees').delete().eq('property_url', propertyUrl);
  const chunk = 200;
  let written = 0;
  for (let i = 0; i < parsed.rows.length; i += chunk) {
    const slice = parsed.rows.slice(i, i + chunk);
    const { error } = await supabase.from('booking_sheet_workshop_attendees').insert(slice);
    if (error) throw error;
    written += slice.length;
  }
  return {
    written,
    sheet: parsed.sheet,
    multiDayEvents: parsed.multiDayEvents,
    dateNullPct: parsed.dateNullPct || 0
  };
}

/**
 * Parse Booking Sheet "Workshops" tab → booking_sheet_workshop_attendees rows.
 * Header uses "Event Date" (not Start) + First/Last Name.
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

/**
 * @returns {{ rows: object[], sheet: string|null, multiDayEvents: object[], dateNullPct: number }}
 */
export function parseWorkshopsTab(wb, { propertyUrl, sourceFile = null } = {}) {
  const sheetName = findWorkshopsSheet(wb);
  if (!sheetName) return { rows: [], sheet: null, multiDayEvents: [], dateNullPct: 0 };
  const ws = wb.Sheets[sheetName];
  const grid = xlsx.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  if (!grid.length) return { rows: [], sheet: sheetName, multiDayEvents: [], dateNullPct: 0 };

  let headerIdx = 0;
  for (let i = 0; i < Math.min(10, grid.length); i++) {
    const line = (grid[i] || []).map((c) => String(c).toLowerCase()).join('|');
    if (/event date|start date|^start/.test(line) && (/theme|location|workshop|first name|client|paid/.test(line))) {
      headerIdx = i;
      break;
    }
  }
  const header = (grid[headerIdx] || []).map((c) => String(c || '').trim().toLowerCase());
  const col = (re) => header.findIndex((h) => re.test(h));
  // "Event Date" must NOT be captured as theme via /event/
  const cStart = col(/^event date$|event date|start date|^start$/);
  const cEnd = col(/^end$|end date/);
  const cTheme = col(/workshop-location|theme\/|location\/theme|^theme|location/);
  const cDur = col(/duration/);
  const cSource = col(/^source$/);
  const cOrder = col(/order|ref/);
  const cPaid = col(/^paid$/);
  const cBal = col(/balance/);
  const cFirst = col(/^first name$/);
  const cLast = col(/^last name$/);
  const cClient = col(/^client$|customer/);

  const importedAt = new Date().toISOString();
  const rows = [];
  let dateNull = 0;
  for (let r = headerIdx + 1; r < grid.length; r++) {
    const row = grid[r] || [];
    if (!row.some((c) => String(c || '').trim())) continue;
    const event_start = cStart >= 0 ? toExcelDate(row[cStart]) : null;
    const event_end = cEnd >= 0 ? toExcelDate(row[cEnd]) : null;
    const duration_text = cDur >= 0 ? String(row[cDur] || '') : '';
    const first = cFirst >= 0 ? String(row[cFirst] || '').trim() : '';
    const last = cLast >= 0 ? String(row[cLast] || '').trim() : '';
    const client_name = (cClient >= 0 ? String(row[cClient] || '').trim() : '')
      || [first, last].filter(Boolean).join(' ').trim();
    if (!event_start && !client_name) continue;
    if (!event_start) dateNull += 1;
    rows.push({
      property_url: propertyUrl,
      event_start,
      event_end,
      theme_location: cTheme >= 0 ? String(row[cTheme] || '').trim() || null : null,
      duration_text: duration_text || null,
      source: cSource >= 0 ? String(row[cSource] || '').trim() || null : null,
      order_ref: cOrder >= 0 ? String(row[cOrder] || '').trim() || null : null,
      paid: cPaid >= 0 ? toNum(row[cPaid]) : null,
      balance: cBal >= 0 ? toNum(row[cBal]) : null,
      client_name: client_name || null,
      is_multi_day: isMultiDay(event_start, event_end, duration_text),
      imported_at: importedAt,
      source_file: sourceFile
    });
  }

  const byEvent = new Map();
  for (const r of rows) {
    if (!r.is_multi_day || !r.event_start) continue;
    const key = `${r.event_start}|${r.event_end || ''}|${r.theme_location || ''}`;
    if (!byEvent.has(key)) {
      byEvent.set(key, {
        event_start: r.event_start,
        event_end: r.event_end,
        theme_location: r.theme_location,
        paying_clients: 0
      });
    }
    if (r.client_name) byEvent.get(key).paying_clients += 1;
  }
  const multiDayEvents = [...byEvent.values()]
    .sort((a, b) => String(a.event_start).localeCompare(String(b.event_start)));
  const dateNullPct = rows.length ? Math.round((dateNull / rows.length) * 1000) / 10 : 0;
  return { rows, sheet: sheetName, multiDayEvents, dateNullPct };
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

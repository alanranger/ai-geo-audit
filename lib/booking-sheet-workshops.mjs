/**
 * Parse Booking Sheet "Workshops" tab → booking_sheet_workshop_attendees rows.
 */
import xlsx from 'xlsx';

function toDate(v) {
  if (!v) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

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
    || names.find((n) => /workshop/i.test(String(n)));
}

/**
 * @returns {{ rows: object[], sheet: string|null, multiDayEvents: object[] }}
 */
export function parseWorkshopsTab(wb, { propertyUrl, sourceFile = null } = {}) {
  const sheetName = findWorkshopsSheet(wb);
  if (!sheetName) return { rows: [], sheet: null, multiDayEvents: [] };
  const ws = wb.Sheets[sheetName];
  const grid = xlsx.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  if (!grid.length) return { rows: [], sheet: sheetName, multiDayEvents: [] };

  // Header row: find columns by fuzzy header names
  let headerIdx = 0;
  for (let i = 0; i < Math.min(10, grid.length); i++) {
    const line = (grid[i] || []).map((c) => String(c).toLowerCase()).join('|');
    if (/start/.test(line) && (/end|client|name|paid|theme|location/.test(line))) {
      headerIdx = i;
      break;
    }
  }
  const header = (grid[headerIdx] || []).map((c) => String(c || '').trim().toLowerCase());
  const col = (re) => header.findIndex((h) => re.test(h));
  const cStart = col(/start/);
  const cEnd = col(/^end$|end date/);
  const cTheme = col(/theme|location|event|workshop/);
  const cDur = col(/duration/);
  const cSource = col(/^source$/);
  const cOrder = col(/order|ref/);
  const cPaid = col(/^paid$/);
  const cBal = col(/balance/);
  const cClient = col(/client|name|customer/);

  const importedAt = new Date().toISOString();
  const rows = [];
  for (let r = headerIdx + 1; r < grid.length; r++) {
    const row = grid[r] || [];
    if (!row.some((c) => String(c || '').trim())) continue;
    const event_start = cStart >= 0 ? toDate(row[cStart]) : null;
    const event_end = cEnd >= 0 ? toDate(row[cEnd]) : null;
    const duration_text = cDur >= 0 ? String(row[cDur] || '') : '';
    const client_name = cClient >= 0 ? String(row[cClient] || '').trim() : '';
    if (!event_start && !client_name) continue;
    rows.push({
      property_url: propertyUrl,
      event_start,
      event_end,
      theme_location: cTheme >= 0 ? String(row[cTheme] || '').trim() : null,
      duration_text: duration_text || null,
      source: cSource >= 0 ? String(row[cSource] || '').trim() : null,
      order_ref: cOrder >= 0 ? String(row[cOrder] || '').trim() : null,
      paid: cPaid >= 0 ? toNum(row[cPaid]) : null,
      balance: cBal >= 0 ? toNum(row[cBal]) : null,
      client_name: client_name || null,
      is_multi_day: isMultiDay(event_start, event_end, duration_text),
      imported_at: importedAt,
      source_file: sourceFile
    });
  }

  // Multi-day event client counts (paid clients)
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
    const paid = (Number(r.paid) || 0) > 0 || (r.client_name && (Number(r.balance) || 0) === 0);
    if (r.client_name && paid) byEvent.get(key).paying_clients += 1;
    else if (r.client_name) byEvent.get(key).paying_clients += 1;
  }
  const multiDayEvents = [...byEvent.values()].sort((a, b) => String(a.event_start).localeCompare(String(b.event_start)));
  return { rows, sheet: sheetName, multiDayEvents };
}

export async function persistWorkshopAttendees(supabase, propertyUrl, parsed) {
  if (!parsed?.rows?.length) return { written: 0, sheet: parsed?.sheet || null, multiDayEvents: parsed?.multiDayEvents || [] };
  // Replace-all for property (simple; additive table, full refresh on each upload)
  await supabase.from('booking_sheet_workshop_attendees').delete().eq('property_url', propertyUrl);
  const chunk = 200;
  let written = 0;
  for (let i = 0; i < parsed.rows.length; i += chunk) {
    const slice = parsed.rows.slice(i, i + chunk);
    const { error } = await supabase.from('booking_sheet_workshop_attendees').insert(slice);
    if (error) throw error;
    written += slice.length;
  }
  return { written, sheet: parsed.sheet, multiDayEvents: parsed.multiDayEvents };
}

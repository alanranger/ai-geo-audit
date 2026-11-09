/**
 * Re-sync the Booking Sheet Workshops tab (with "Email Address") and the other email-bearing tabs
 * (booking_sheet_tab_contacts) from a local workbook, with the same parsers as POST /api/aigeo/booking-sheet-upload.
 * The workbook is only read. Prints counts only.
 *   node scripts/resync-booking-sheet-contacts.mjs ["<path to Booking Sheet .xlsm>"]
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import xlsx from 'xlsx';
import { serviceClient } from '../lib/marketing/store.mjs';
import { parseWorkshopsTab, persistWorkshopAttendees } from '../lib/booking-sheet-workshops.mjs';
import { syncContactTabs } from '../lib/booking-sheet-contacts.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
for (const name of ['.env.vercel.prod', '.env.local']) {
  try {
    for (const line of readFileSync(resolve(root, name), 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '');
    }
  } catch { /* optional */ }
}

const FILE = process.argv[2] || 'G:/Dropbox/1. Bookings/Booking_Sheet_2026_-_WITH_PRODUCT_MAPPING_3.xlsm';
const PROP = 'https://www.alanranger.com';

const sb = serviceClient();
const wb = xlsx.read(readFileSync(FILE), { type: 'buffer', cellDates: false, raw: true });
const filename = basename(FILE);
const parsed = parseWorkshopsTab(wb, { propertyUrl: PROP, sourceFile: filename });
const workshops = await persistWorkshopAttendees(sb, PROP, parsed);
await sb.from('booking_sheet_sheet_presence').upsert({ property_url: PROP, sheet_key: 'workshops', present: !!parsed.sheet, sheet_name: parsed.sheet || null, row_count: Number(workshops.written) || 0, seen_at: new Date().toISOString() });
const contacts = await syncContactTabs(sb, PROP, wb, filename);
console.log(JSON.stringify({
  workbook: filename, workshops_written: workshops.written, workshops_with_email: parsed.rows.filter((r) => r.email).length, workshops_date_null_pct: parsed.dateNullPct,
  contact_rows_written: contacts.written, contact_rows_by_tab: contacts.tabs, contact_error: contacts.error || null
}, null, 2));

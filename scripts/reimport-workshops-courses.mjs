/**
 * Re-parse Workshops + Courses-Classes from local Booking Sheet and upsert Supabase.
 * node scripts/reimport-workshops-courses.mjs
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import xlsx from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import { parseWorkshopsTab, persistWorkshopAttendees } from '../lib/booking-sheet-workshops.mjs';
import { parseCoursesClassesTab, persistCourseAttendees } from '../lib/booking-sheet-plans-courses.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
for (const name of ['.env.vercel.prod', '.env.local', '.env']) {
  try {
    for (const line of readFileSync(resolve(root, name), 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!m) continue;
      const val = m[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '');
      if (!process.env[m[1]] || (name === '.env.vercel.prod' && val.startsWith('sb_'))) {
        process.env[m[1]] = val;
      }
    }
  } catch { /* optional */ }
}

const prop = 'https://www.alanranger.com';
const file = resolve(root, 'Docs/Booking Sheet 2026 - Alan Ranger Photography.xlsm');
const wb = xlsx.read(readFileSync(file), { type: 'buffer', cellDates: false, raw: true });
const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE,
  { auth: { persistSession: false } }
);

const parsedWs = parseWorkshopsTab(wb, { propertyUrl: prop, sourceFile: file });
const ws = await persistWorkshopAttendees(sb, prop, parsedWs);
const parsedC = parseCoursesClassesTab(wb, { propertyUrl: prop, sourceFile: file });
const courses = await persistCourseAttendees(sb, prop, parsedC);

const withStart = parsedWs.rows.filter((r) => r.event_start).length;
const withCourseDate = parsedC.rows.filter((r) => r.from_date || r.to_date).length;
const multi = parsedWs.rows.filter((r) => r.is_multi_day && r.event_start).length;

await sb.from('booking_sheet_sheet_presence').upsert([
  {
    property_url: prop,
    sheet_key: 'workshops',
    present: true,
    sheet_name: parsedWs.sheet,
    row_count: ws.written,
    seen_at: new Date().toISOString()
  },
  {
    property_url: prop,
    sheet_key: 'courses',
    present: true,
    sheet_name: parsedC.sheet,
    row_count: courses.written,
    seen_at: new Date().toISOString()
  },
  {
    property_url: prop,
    sheet_key: 'attendee_date_health',
    present: (parsedWs.dateNullPct || 0) <= 10 && (parsedC.dateNullPct || 0) <= 10,
    sheet_name: (parsedWs.dateNullPct || 0) > 10 || (parsedC.dateNullPct || 0) > 10
      ? `Workshops:${parsedWs.dateNullPct}%; Courses:${parsedC.dateNullPct}%`
      : 'ok',
    row_count: 0,
    seen_at: new Date().toISOString()
  }
]);

console.log(JSON.stringify({
  workshops_written: ws.written,
  workshops_with_event_start: withStart,
  workshops_date_null_pct: parsedWs.dateNullPct,
  multi_day_with_date: multi,
  sample_ws: parsedWs.rows.filter((r) => r.event_start).slice(0, 3),
  courses_written: courses.written,
  courses_with_date: withCourseDate,
  courses_date_null_pct: parsedC.dateNullPct,
  sample_c: parsedC.rows.filter((r) => r.is_beginners && (r.from_date || r.to_date)).slice(0, 3)
}, null, 2));

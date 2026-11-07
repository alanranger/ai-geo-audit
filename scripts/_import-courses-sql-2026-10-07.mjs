import fs from 'fs';

const rows = JSON.parse(fs.readFileSync('outputs/_courses-classes-import-2026-10-07.json', 'utf8'));

function esc(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

const cols = [
  'property_url', 'from_date', 'to_date', 'date_booked', 'event_name', 'location',
  'duration_text', 'paid', 'balance', 'source_raw', 'source_bucket', 'booking_ref',
  'prefix', 'first_name', 'last_name', 'client_name', 'email', 'is_beginners',
  'is_booking_row', 'source_row', 'imported_at', 'source_file'
];

const values = rows.map((r) => `(${cols.map((c) => {
  const v = r[c];
  if (v == null || v === '') return 'NULL';
  if (c.endsWith('_date')) return `${esc(v)}::date`;
  if (c === 'imported_at') return `${esc(v)}::timestamptz`;
  return esc(v);
}).join(',')})`).join(',\n');

const sql = `DELETE FROM public.booking_sheet_course_attendees WHERE property_url = 'https://www.alanranger.com';
INSERT INTO public.booking_sheet_course_attendees (${cols.join(',')}) VALUES
${values};`;

fs.writeFileSync('outputs/_courses-classes-import-2026-10-07.sql', sql);
console.log('rows', rows.length, 'bytes', sql.length);

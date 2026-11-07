import fs from 'fs';

const rows = JSON.parse(fs.readFileSync('outputs/_courses-classes-import-2026-10-07.json', 'utf8'));

function esc(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
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

function rowSql(r) {
  return `(${cols.map((c) => {
    const v = r[c];
    if (v == null || v === '') return 'NULL';
    if (c.endsWith('_date') || c === 'date_booked') return `${esc(v)}::date`;
    if (c === 'imported_at') return `${esc(v)}::timestamptz`;
    return esc(v);
  }).join(',')})`;
}

fs.mkdirSync('outputs/_course_chunks', { recursive: true });
fs.writeFileSync(
  'outputs/_course_chunks/00_delete.sql',
  "DELETE FROM public.booking_sheet_course_attendees WHERE property_url = 'https://www.alanranger.com';"
);

const size = 20;
let n = 0;
for (let i = 0; i < rows.length; i += size) {
  const slice = rows.slice(i, i + size);
  const sql = `INSERT INTO public.booking_sheet_course_attendees (${cols.join(',')}) VALUES\n${slice.map(rowSql).join(',\n')};`;
  n += 1;
  fs.writeFileSync(`outputs/_course_chunks/${String(n).padStart(2, '0')}.sql`, sql);
}
console.log('chunks', n);

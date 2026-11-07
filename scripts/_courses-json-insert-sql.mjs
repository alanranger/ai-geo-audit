import fs from 'fs';

const rows = JSON.parse(fs.readFileSync('outputs/_courses-classes-import-2026-10-07.json', 'utf8'));
const slim = rows.map((r) => ({
  property_url: r.property_url,
  from_date: r.from_date || null,
  to_date: r.to_date || null,
  date_booked: r.date_booked || null,
  event_name: r.event_name,
  location: r.location,
  duration_text: r.duration_text,
  paid: r.paid,
  balance: r.balance,
  source_raw: r.source_raw,
  source_bucket: r.source_bucket,
  booking_ref: r.booking_ref,
  prefix: r.prefix,
  first_name: r.first_name,
  last_name: r.last_name,
  client_name: r.client_name,
  email: r.email,
  is_beginners: r.is_beginners,
  is_booking_row: r.is_booking_row,
  source_row: r.source_row,
  imported_at: r.imported_at,
  source_file: r.source_file
}));

const json = JSON.stringify(slim).replace(/'/g, "''");
const sql = `DELETE FROM public.booking_sheet_course_attendees WHERE property_url = 'https://www.alanranger.com';
INSERT INTO public.booking_sheet_course_attendees (
  property_url, from_date, to_date, date_booked, event_name, location, duration_text,
  paid, balance, source_raw, source_bucket, booking_ref, prefix, first_name, last_name,
  client_name, email, is_beginners, is_booking_row, source_row, imported_at, source_file
)
SELECT
  property_url, from_date::date, to_date::date, date_booked::date, event_name, location, duration_text,
  paid, balance, source_raw, source_bucket, booking_ref, prefix, first_name, last_name,
  client_name, email, is_beginners, is_booking_row, source_row, imported_at::timestamptz, source_file
FROM jsonb_to_recordset('${json}'::jsonb) AS x(
  property_url text,
  from_date text,
  to_date text,
  date_booked text,
  event_name text,
  location text,
  duration_text text,
  paid numeric,
  balance numeric,
  source_raw text,
  source_bucket text,
  booking_ref text,
  prefix text,
  first_name text,
  last_name text,
  client_name text,
  email text,
  is_beginners boolean,
  is_booking_row boolean,
  source_row integer,
  imported_at text,
  source_file text
);`;

fs.writeFileSync('outputs/_courses-jsonb-insert.sql', sql);
console.log('bytes', sql.length, 'rows', slim.length);

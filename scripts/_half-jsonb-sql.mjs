import fs from 'fs';

function build(rows) {
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
  return `INSERT INTO public.booking_sheet_course_attendees (
  property_url, from_date, to_date, date_booked, event_name, location, duration_text,
  paid, balance, source_raw, source_bucket, booking_ref, prefix, first_name, last_name,
  client_name, email, is_beginners, is_booking_row, source_row, imported_at, source_file
)
SELECT
  property_url, from_date::date, to_date::date, date_booked::date, event_name, location, duration_text,
  paid, balance, source_raw, source_bucket, booking_ref, prefix, first_name, last_name,
  client_name, email, is_beginners, is_booking_row, source_row, imported_at::timestamptz, source_file
FROM jsonb_to_recordset('${json}'::jsonb) AS x(
  property_url text, from_date text, to_date text, date_booked text, event_name text, location text,
  duration_text text, paid numeric, balance numeric, source_raw text, source_bucket text, booking_ref text,
  prefix text, first_name text, last_name text, client_name text, email text, is_beginners boolean,
  is_booking_row boolean, source_row integer, imported_at text, source_file text
);`;
}

const rows = JSON.parse(fs.readFileSync('outputs/_courses-classes-import-2026-10-07.json', 'utf8'));
const half = Math.ceil(rows.length / 2);
fs.writeFileSync('outputs/_course_half1.sql', build(rows.slice(0, half)));
fs.writeFileSync('outputs/_course_half2.sql', build(rows.slice(half)));
console.log(fs.statSync('outputs/_course_half1.sql').size, fs.statSync('outputs/_course_half2.sql').size);

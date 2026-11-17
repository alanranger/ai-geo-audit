-- Outstanding JLR invoices (17 Nov 2026). Replaced on every Booking Sheet upload.
-- Names and amounts only. No email column. Service role reads and writes it.
-- Strategy adds invoiced rows to Cash to collect in the due month.

create table if not exists public.booking_sheet_jlr_invoices (
  id bigserial primary key,
  property_url text not null,
  source_row integer,
  client_name text not null,
  event_name text,
  event_date date,
  invoice_no text,
  invoice_date date,
  due_date date,
  outstanding numeric not null,
  imported_at timestamptz not null default now(),
  source_file text
);

create index if not exists booking_sheet_jlr_invoices_property_idx
  on public.booking_sheet_jlr_invoices (property_url);

alter table public.booking_sheet_jlr_invoices enable row level security;
revoke all on public.booking_sheet_jlr_invoices from anon, authenticated;

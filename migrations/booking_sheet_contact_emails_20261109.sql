-- Booking Sheet client emails for identity matching (9 Nov 2026, QUESTION d, Alan option 1).
-- Workshops tab "Email Address" (column N) → booking_sheet_workshop_attendees.email (trimmed, lower-cased).
-- Email-bearing tabs with no table of their own (1-2-1's, Mentoring, Gift Vouchers, Master Classes, RPS Course,
-- Intentions, JLR Bookings) → booking_sheet_tab_contacts: name ↔ email evidence only, never bookings or money.
-- Read by lib/marketing/rebuild.mjs (service role). The new table holds personal emails: RLS on, no policies,
-- no anon / authenticated grants.

alter table public.booking_sheet_workshop_attendees add column if not exists email text;

create table if not exists public.booking_sheet_tab_contacts (
  id bigserial primary key,
  property_url text not null,
  tab text not null,
  source_row integer,
  first_name text,
  last_name text,
  client_name text not null,
  email text not null,
  order_ref text,
  date_booked date,
  event_date date,
  imported_at timestamptz not null default now(),
  source_file text
);

create index if not exists booking_sheet_tab_contacts_property_idx on public.booking_sheet_tab_contacts (property_url);

alter table public.booking_sheet_tab_contacts enable row level security;
revoke all on public.booking_sheet_tab_contacts from anon, authenticated;

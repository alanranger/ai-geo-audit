-- Allow booking_sheet as a valid revenue_snapshots.source so the local
-- scripts/import-booking-sheet.mjs can upsert Bank + PayPal direct payments
-- (which aren't visible to Stripe or Squarespace Commerce APIs).

alter table public.revenue_snapshots
  drop constraint if exists revenue_snapshots_source_check;

alter table public.revenue_snapshots
  add constraint revenue_snapshots_source_check
  check (source in ('manual', 'squarespace_csv', 'squarespace_api', 'stripe_supplemental', 'booking_sheet', 'other'));

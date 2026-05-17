-- Allow stripe_supplemental as a valid source for revenue_snapshots.
-- Used by api/aigeo/stripe-revenue-sync.js to record Acuity + Academy revenue
-- that the Squarespace Orders API cannot see.

alter table public.revenue_snapshots
  drop constraint if exists revenue_snapshots_source_check;

alter table public.revenue_snapshots
  add constraint revenue_snapshots_source_check
  check (source in ('manual', 'squarespace_csv', 'squarespace_api', 'stripe_supplemental', 'other'));

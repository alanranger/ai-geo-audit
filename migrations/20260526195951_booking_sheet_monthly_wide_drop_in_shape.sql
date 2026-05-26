-- 2026-05-26 19:59 UTC -- Phase L follow-up.
-- Rebuild booking_sheet_monthly_wide so its column set is a drop-in
-- replacement for revenue_snapshots reads (adds tier_transactions, currency,
-- transactions, source, notes alongside the existing tier_revenue +
-- revenue_amount). Lets the dashboard readers switch source with minimal
-- surgery.
--
-- NOTE: this version of the view was itself superseded later the same day
-- by Phase L1 (migrations 20260526204321 .. 20260526204559) which deletes
-- booking_sheet_monthly (the invented 5-tier rollup) entirely and rebuilds
-- this view on top of the verbatim 12-category truth + 3-market mapping.
-- This migration is kept on disk for historical/replay completeness.

DROP MATERIALIZED VIEW IF EXISTS public.booking_sheet_monthly_wide;

CREATE MATERIALIZED VIEW public.booking_sheet_monthly_wide AS
SELECT
  property_url,
  year,
  month,
  make_date(year, month, 1)                                                AS period_start,
  (make_date(year, month, 1) + interval '1 month' - interval '1 day')::date AS period_end,
  jsonb_object_agg(tier_id, revenue_amount)                                AS tier_revenue,
  NULL::jsonb                                                              AS tier_transactions,
  SUM(revenue_amount)::numeric(12,2)                                       AS revenue_amount,
  NULL::integer                                                            AS transactions,
  'GBP'::text                                                              AS currency,
  'booking_sheet_truth'::text                                              AS source,
  'Booking Sheet row-18 Totals (single source of truth)'::text             AS notes
FROM public.booking_sheet_monthly
GROUP BY property_url, year, month;

CREATE UNIQUE INDEX IF NOT EXISTS booking_sheet_monthly_wide_pk
  ON public.booking_sheet_monthly_wide(property_url, year, month);

CREATE INDEX IF NOT EXISTS booking_sheet_monthly_wide_period_idx
  ON public.booking_sheet_monthly_wide(period_end DESC);

COMMENT ON MATERIALIZED VIEW public.booking_sheet_monthly_wide IS
  'Drop-in replacement for revenue_snapshots reads. One row per (property, year, month) with the same column set, sourced from the Booking Sheet (single source of truth). tier_transactions and transactions are NULL because the Booking Sheet does not track order counts -- callers should default to 0 / null-safe paths.';

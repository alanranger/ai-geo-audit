-- 2026-05-26 20:43 UTC -- Phase L1 correction (step 1 of 4).
--
-- Phase L (committed 6faa5f1) introduced booking_sheet_monthly as a per-tier
-- rollup of the 12 verbatim Booking Sheet categories into 5 invented "tiers"
-- (courses / workshops_nonres / workshops_residential / services / academy).
-- The `services` bucket merged 8 unrelated D2C, B2B and ADJUSTMENT
-- categories into one figure that corresponded to nothing real. Phase L1
-- deletes that rollup and rebuilds the wide view on the verbatim 12-category
-- truth (booking_sheet_monthly_category) joined to a 3-market mapping table
-- (booking_sheet_category_market, created in step 2).
--
-- The booking_sheet_monthly_wide view depends on booking_sheet_monthly, so
-- drop the function and view first, then the table.

DROP FUNCTION IF EXISTS public.refresh_booking_sheet_monthly_wide();

DROP MATERIALIZED VIEW IF EXISTS public.booking_sheet_monthly_wide;

DROP TABLE IF EXISTS public.booking_sheet_monthly;

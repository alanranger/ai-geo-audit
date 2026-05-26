-- 2026-05-26 20:45 UTC -- Phase L1 correction (step 4 of 4).
--
-- booking_sheet_monthly_category.tier_id was the parser's preview of the
-- 5-tier rollup that Phase L1 has now deleted. With the rollup gone and the
-- 12-category to 3-market mapping moved to booking_sheet_category_market,
-- the column is unused. Drop it so future inserts can't accidentally
-- repopulate stale data.

ALTER TABLE public.booking_sheet_monthly_category
  DROP COLUMN IF EXISTS tier_id;

COMMENT ON TABLE public.booking_sheet_monthly_category IS 'Verbatim 12-category monthly revenue from the Booking Sheet (canonical truth layer). The category -> market (D2C/B2B/ADJUSTMENT) mapping lives in booking_sheet_category_market and is joined in by the booking_sheet_monthly_wide view.';

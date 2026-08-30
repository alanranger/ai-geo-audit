-- Per-month transaction COUNTS from the Booking Sheet.
--
-- booking_sheet_monthly_wide hardcodes NULL::integer AS transactions, so the
-- Revenue Funnel had no sale count and every sale-rate KPI read 0.00% while
-- revenue was populated. This view supplies the count without touching that
-- materialised view (it has a dependent view, revenue_gsc_joined, so a DROP
-- would cascade, and matviews cannot be CREATE OR REPLACE'd).
--
-- What counts as a sale:
--   * amount > 0            -- excludes the negative voucher offset rows
--   * NOT is_redemption     -- "Gift Vouchers Out" / "Pick n Mix Out" are
--                              accounting offsets against an earlier sale, not
--                              new conversions. Counting them would both
--                              double-count the conversion and subtract value.
-- JLR is counted separately so the funnel's existing JLR toggle can pick.

CREATE OR REPLACE VIEW public.booking_sheet_monthly_txn_counts AS
SELECT
  property_url,
  year,
  month,
  make_date(year, month, 1) AS period_start,
  count(*) FILTER (WHERE amount > 0 AND NOT is_redemption) AS transactions_all,
  count(*) FILTER (WHERE amount > 0 AND NOT is_redemption AND NOT is_jlr) AS transactions_nonjlr,
  count(*) FILTER (WHERE amount > 0 AND NOT is_redemption AND is_jlr) AS transactions_jlr,
  count(*) FILTER (WHERE is_redemption) AS redemptions_excluded,
  count(*) FILTER (WHERE amount <= 0 AND NOT is_redemption) AS non_positive_excluded
FROM public.booking_sheet_transactions
GROUP BY property_url, year, month;

COMMENT ON VIEW public.booking_sheet_monthly_txn_counts IS
  'Per-month Booking Sheet sale counts for the Revenue Funnel sale-rate KPIs. A sale is amount > 0 AND NOT is_redemption; voucher redemption offsets are excluded and reported separately. transactions_nonjlr matches the funnel default (JLR toggle off).';

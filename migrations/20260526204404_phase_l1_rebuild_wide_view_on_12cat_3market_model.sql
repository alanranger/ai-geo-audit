-- 2026-05-26 20:44 UTC -- Phase L1 correction (step 3 of 4).
--
-- Rebuild booking_sheet_monthly_wide on the corrected model:
--
-- Source = booking_sheet_monthly_category (verbatim 12-category truth)
--          LEFT JOIN booking_sheet_category_market (the 12 to 3 mapping).
--
-- Per-month columns exposed:
--   - category_revenue jsonb -- 12 verbatim category keys
--   - market_revenue   jsonb -- {D2C, B2B, ADJUSTMENT}
--   - d2c_revenue / b2b_revenue / operational_revenue (= d2c + b2b)
--   - adjustment_net -- voucher / deferred-spend timing line
--   - revenue_amount -- full 12-category sum (= YTD Actual cell)
--
-- Headline rule (revised by Alan same day, see
-- Docs/REVENUE-TRUTH-FROM-BOOKING-SHEET.md): the dashboard headline figure
-- AND the tier-band comparison basis is `revenue_amount` (= the spreadsheet
-- YTD Actual cell J47/J48). operational_revenue (D2C + B2B) is the
-- "service revenue excl. voucher timing" secondary breakdown line shown
-- beneath the headline. adjustment_net is shown as its own labelled line so
-- the arithmetic `headline = operational + adjustment` is visible.
--
-- An earlier draft made operational_revenue the headline; reversed before
-- any UI shipped because the user reads the Booking Sheet daily and the
-- on-screen number must equal the figure they read there -- trust beats
-- theoretical purity.

CREATE MATERIALIZED VIEW public.booking_sheet_monthly_wide AS
WITH per_month AS (
  SELECT
    c.property_url,
    c.year,
    c.month,
    jsonb_object_agg(c.category_label, c.revenue_amount)             AS category_revenue,
    SUM(c.revenue_amount) FILTER (WHERE m.market = 'D2C')            AS d2c_revenue,
    SUM(c.revenue_amount) FILTER (WHERE m.market = 'B2B')            AS b2b_revenue,
    SUM(c.revenue_amount) FILTER (WHERE m.market = 'ADJUSTMENT')     AS adjustment_net,
    SUM(c.revenue_amount)                                            AS revenue_amount_full_12cat
  FROM public.booking_sheet_monthly_category c
  LEFT JOIN public.booking_sheet_category_market m USING (category_order)
  GROUP BY c.property_url, c.year, c.month
)
SELECT
  property_url,
  year,
  month,
  make_date(year, month, 1)                                                 AS period_start,
  (make_date(year, month, 1) + interval '1 month' - interval '1 day')::date AS period_end,
  category_revenue,
  jsonb_build_object(
    'D2C',        COALESCE(d2c_revenue, 0),
    'B2B',        COALESCE(b2b_revenue, 0),
    'ADJUSTMENT', COALESCE(adjustment_net, 0)
  )                                                                         AS market_revenue,
  COALESCE(d2c_revenue, 0)::numeric(12,2)                                   AS d2c_revenue,
  COALESCE(b2b_revenue, 0)::numeric(12,2)                                   AS b2b_revenue,
  (COALESCE(d2c_revenue, 0) + COALESCE(b2b_revenue, 0))::numeric(12,2)      AS operational_revenue,
  COALESCE(adjustment_net, 0)::numeric(12,2)                                AS adjustment_net,
  COALESCE(revenue_amount_full_12cat, 0)::numeric(12,2)                     AS revenue_amount,
  NULL::jsonb                                                               AS tier_transactions,
  NULL::integer                                                             AS transactions,
  'GBP'::text                                                               AS currency,
  'booking_sheet_truth'::text                                               AS source,
  'Booking Sheet truth: operational_revenue = D2C+B2B (headline); adjustment_net = voucher/deferred-spend timing line; revenue_amount = full 12-category sum (= YTD Actual cell, the reconciliation basis).'::text AS notes
FROM per_month;

CREATE UNIQUE INDEX booking_sheet_monthly_wide_pk
  ON public.booking_sheet_monthly_wide(property_url, year, month);

CREATE INDEX booking_sheet_monthly_wide_period_idx
  ON public.booking_sheet_monthly_wide(period_end DESC);

COMMENT ON MATERIALIZED VIEW public.booking_sheet_monthly_wide IS 'Dashboard-shaped view of the Booking Sheet single-source-of-truth data. Built on booking_sheet_monthly_category (verbatim 12-category truth) joined to booking_sheet_category_market (the 12 to 3 market mapping). Exposes per-month: category_revenue jsonb (12 keys verbatim), market_revenue jsonb (D2C/B2B/ADJUSTMENT), operational_revenue (D2C+B2B = headline), adjustment_net (voucher timing line, never silently in headline), revenue_amount (full 12-cat sum = YTD Actual reconciliation basis). No invented tier rollup.';

CREATE OR REPLACE FUNCTION public.refresh_booking_sheet_monthly_wide()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.booking_sheet_monthly_wide;
  EXCEPTION
    WHEN OTHERS THEN
      REFRESH MATERIALIZED VIEW public.booking_sheet_monthly_wide;
  END;
END;
$$;

-- Phase A: rebuild booking_sheet_monthly_wide to ADD per-product + per-page
-- revenue jsonb columns and _nonjlr / _jlr slices of every money column,
-- while preserving EVERY existing column bit-for-bit (V7 invariant: Phase L1
-- readers must not change values).
--
-- Architecture:
--   per_month_cat        -- existing CTE: reads booking_sheet_monthly_category
--                           grouped per (property_url, year, month), produces
--                           category_revenue jsonb + d2c/b2b/adjustment money.
--                           This is the SINGLE TRUTH for revenue_amount,
--                           operational_revenue, adjustment_net (per Phase L1).
--   per_month_txn        -- NEW: reads booking_sheet_transactions, produces
--                           per-month JLR-stripped slices grouped by market.
--   per_month_product    -- NEW: reads booking_sheet_transactions grouped by
--                           canonical_product per month, with _nonjlr/_jlr
--                           sub-totals per product.
--   per_month_product_json -- NEW: rolls per_month_product up to a jsonb
--                           map keyed by canonical_product.
--   per_month_page       -- NEW: same shape but grouped by landing_page_url.
--   per_month_page_json  -- NEW: rolls per_month_page to a jsonb map.
--
-- The final SELECT LEFT JOINs the four transaction-derived CTEs onto the
-- existing per_month_cat result. Existing columns come unchanged from
-- per_month_cat -- new columns are pulled from the joined CTEs and default
-- to 0 / NULL when no transactions exist for a (property_url, year, month).
--
-- IMPORTANT: the JLR-stripped category-level money columns
-- (operational_revenue_nonjlr, d2c_revenue_nonjlr, etc) come from the
-- TRANSACTIONS table, not from booking_sheet_monthly_category, because the
-- category grid has no JLR/non-JLR dimension. Where transactions reconcile
-- to the category grid (which they do, per Phase L1 + the Phase A V5 check
-- proving 2025 transactions sum to £46,572.46), the _nonjlr + _jlr columns
-- sum back to the existing operational_revenue / d2c_revenue / b2b_revenue.
-- Where they don't reconcile, the _nonjlr/_jlr columns will be slightly
-- lower (e.g. if a category-grid month has a manual adjustment with no
-- backing transaction); this is treated as a soft warning, not an error.

DROP MATERIALIZED VIEW IF EXISTS public.booking_sheet_monthly_wide;

CREATE MATERIALIZED VIEW public.booking_sheet_monthly_wide AS
WITH per_month_cat AS (
  SELECT c.property_url,
         c.year,
         c.month,
         jsonb_object_agg(c.category_label, c.revenue_amount) AS category_revenue,
         sum(c.revenue_amount) FILTER (WHERE m.market = 'D2C')        AS d2c_revenue,
         sum(c.revenue_amount) FILTER (WHERE m.market = 'B2B')        AS b2b_revenue,
         sum(c.revenue_amount) FILTER (WHERE m.market = 'ADJUSTMENT') AS adjustment_net,
         sum(c.revenue_amount)                                        AS revenue_amount_full_12cat
    FROM booking_sheet_monthly_category c
    LEFT JOIN booking_sheet_category_market m USING (category_order)
   GROUP BY c.property_url, c.year, c.month
),
per_month_txn AS (
  SELECT t.property_url,
         t.year,
         t.month,
         sum(t.amount)                                                    AS amount_total,
         sum(t.amount) FILTER (WHERE NOT t.is_jlr)                        AS amount_nonjlr,
         sum(t.amount) FILTER (WHERE t.is_jlr)                            AS amount_jlr,
         sum(t.amount) FILTER (WHERE m.market = 'D2C' AND NOT t.is_jlr)   AS d2c_nonjlr,
         sum(t.amount) FILTER (WHERE m.market = 'D2C' AND t.is_jlr)       AS d2c_jlr,
         sum(t.amount) FILTER (WHERE m.market = 'B2B' AND NOT t.is_jlr)   AS b2b_nonjlr,
         sum(t.amount) FILTER (WHERE m.market = 'B2B' AND t.is_jlr)       AS b2b_jlr,
         sum(t.amount) FILTER (WHERE m.market = 'ADJUSTMENT')             AS adjustment_total
    FROM booking_sheet_transactions t
    LEFT JOIN booking_sheet_category_market m USING (category_order)
   GROUP BY t.property_url, t.year, t.month
),
per_month_product AS (
  SELECT property_url, year, month, canonical_product,
         sum(amount)                            AS revenue,
         sum(amount) FILTER (WHERE NOT is_jlr)  AS revenue_nonjlr,
         sum(amount) FILTER (WHERE is_jlr)      AS revenue_jlr
    FROM booking_sheet_transactions
   WHERE canonical_product IS NOT NULL
   GROUP BY property_url, year, month, canonical_product
),
per_month_product_json AS (
  SELECT property_url, year, month,
         jsonb_object_agg(canonical_product, revenue) AS product_revenue,
         jsonb_object_agg(canonical_product, coalesce(revenue_nonjlr, 0))
           FILTER (WHERE revenue_nonjlr IS NOT NULL AND revenue_nonjlr > 0) AS product_revenue_nonjlr,
         jsonb_object_agg(canonical_product, coalesce(revenue_jlr, 0))
           FILTER (WHERE revenue_jlr IS NOT NULL AND revenue_jlr > 0)       AS product_revenue_jlr
    FROM per_month_product
   GROUP BY property_url, year, month
),
per_month_page AS (
  SELECT property_url, year, month, landing_page_url,
         sum(amount)                            AS revenue,
         sum(amount) FILTER (WHERE NOT is_jlr)  AS revenue_nonjlr,
         sum(amount) FILTER (WHERE is_jlr)      AS revenue_jlr
    FROM booking_sheet_transactions
   WHERE landing_page_url IS NOT NULL
   GROUP BY property_url, year, month, landing_page_url
),
per_month_page_json AS (
  SELECT property_url, year, month,
         jsonb_object_agg(landing_page_url, revenue) AS page_revenue,
         jsonb_object_agg(landing_page_url, coalesce(revenue_nonjlr, 0))
           FILTER (WHERE revenue_nonjlr IS NOT NULL AND revenue_nonjlr > 0) AS page_revenue_nonjlr,
         jsonb_object_agg(landing_page_url, coalesce(revenue_jlr, 0))
           FILTER (WHERE revenue_jlr IS NOT NULL AND revenue_jlr > 0)       AS page_revenue_jlr
    FROM per_month_page
   GROUP BY property_url, year, month
)
SELECT pmc.property_url,
       pmc.year,
       pmc.month,
       make_date(pmc.year, pmc.month, 1)                                       AS period_start,
       (((make_date(pmc.year, pmc.month, 1) + '1 mon'::interval) - '1 day'::interval))::date AS period_end,
       pmc.category_revenue,
       jsonb_build_object(
         'D2C',        COALESCE(pmc.d2c_revenue, 0::numeric),
         'B2B',        COALESCE(pmc.b2b_revenue, 0::numeric),
         'ADJUSTMENT', COALESCE(pmc.adjustment_net, 0::numeric)
       )                                                                       AS market_revenue,
       (COALESCE(pmc.d2c_revenue, 0::numeric))::numeric(12,2)                  AS d2c_revenue,
       (COALESCE(pmc.b2b_revenue, 0::numeric))::numeric(12,2)                  AS b2b_revenue,
       ((COALESCE(pmc.d2c_revenue, 0::numeric) + COALESCE(pmc.b2b_revenue, 0::numeric)))::numeric(12,2)
                                                                               AS operational_revenue,
       (COALESCE(pmc.adjustment_net, 0::numeric))::numeric(12,2)               AS adjustment_net,
       (COALESCE(pmc.revenue_amount_full_12cat, 0::numeric))::numeric(12,2)    AS revenue_amount,
       NULL::jsonb                                                              AS tier_transactions,
       NULL::integer                                                            AS transactions,
       'GBP'::text                                                              AS currency,
       'booking_sheet_truth'::text                                              AS source,
       'Booking Sheet truth: operational_revenue = D2C+B2B (headline); adjustment_net = voucher/deferred-spend timing line; revenue_amount = full 12-category sum (= YTD Actual cell, the reconciliation basis). _nonjlr and _jlr slices come from booking_sheet_transactions and reconcile to revenue_amount where the transactions reconcile to the category grid.'::text
                                                                               AS notes,
       -- NEW: per-product + per-page jsonb maps (transactions-derived)
       pmpj.product_revenue,
       pmpj.product_revenue_nonjlr,
       pmpj.product_revenue_jlr,
       pmpgj.page_revenue,
       pmpgj.page_revenue_nonjlr,
       pmpgj.page_revenue_jlr,
       -- NEW: _nonjlr and _jlr slices of every money field (transactions-derived)
       (COALESCE(pmt.amount_nonjlr, 0::numeric))::numeric(12,2)                AS revenue_amount_nonjlr,
       (COALESCE(pmt.amount_jlr, 0::numeric))::numeric(12,2)                   AS revenue_amount_jlr,
       ((COALESCE(pmt.d2c_nonjlr, 0::numeric) + COALESCE(pmt.b2b_nonjlr, 0::numeric)))::numeric(12,2)
                                                                               AS operational_revenue_nonjlr,
       ((COALESCE(pmt.d2c_jlr, 0::numeric) + COALESCE(pmt.b2b_jlr, 0::numeric)))::numeric(12,2)
                                                                               AS operational_revenue_jlr,
       (COALESCE(pmt.d2c_nonjlr, 0::numeric))::numeric(12,2)                   AS d2c_revenue_nonjlr,
       (COALESCE(pmt.d2c_jlr, 0::numeric))::numeric(12,2)                      AS d2c_revenue_jlr,
       (COALESCE(pmt.b2b_nonjlr, 0::numeric))::numeric(12,2)                   AS b2b_revenue_nonjlr,
       (COALESCE(pmt.b2b_jlr, 0::numeric))::numeric(12,2)                      AS b2b_revenue_jlr
  FROM per_month_cat pmc
  LEFT JOIN per_month_txn          pmt   USING (property_url, year, month)
  LEFT JOIN per_month_product_json pmpj  USING (property_url, year, month)
  LEFT JOIN per_month_page_json    pmpgj USING (property_url, year, month);

-- Preserve the CONCURRENTLY-refresh index that lived on the old matview.
-- Without a unique index, REFRESH CONCURRENTLY raises an error and the
-- refresh function falls back to a blocking refresh (still correct, just
-- slower). With this index the refresh is concurrent.
CREATE UNIQUE INDEX booking_sheet_monthly_wide_pkey_idx
  ON public.booking_sheet_monthly_wide (property_url, year, month);

CREATE INDEX booking_sheet_monthly_wide_period_idx
  ON public.booking_sheet_monthly_wide (property_url, period_start);

COMMENT ON MATERIALIZED VIEW public.booking_sheet_monthly_wide IS
  'Wide per-month revenue view. Phase L1 columns (category_revenue, market_revenue, d2c_revenue, b2b_revenue, operational_revenue, adjustment_net, revenue_amount) read from booking_sheet_monthly_category -- the single reconciliation truth (full 12-cat sum = YTD Actual). Phase A columns (product_revenue, page_revenue, *_nonjlr, *_jlr) read from booking_sheet_transactions. The two layers reconcile where transactions reconcile to the category grid; soft deltas surface as small mismatches in the JLR slices (manual category-grid adjustments without backing transactions).';

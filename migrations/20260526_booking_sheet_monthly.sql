-- 2026-05-26  Authoritative monthly revenue from the Booking Sheet.
--
-- Background: the Revenue Funnel + Scenario Planning dashboards were summing
-- revenue_snapshots across three sources (squarespace_api + stripe_supplemental
-- + booking_sheet) on the assumption that they were independent streams. They
-- are not -- a Squarespace order paid by Bank Transfer appears in BOTH the SQ
-- Orders API AND the Booking Sheet's Bank receipts, with no transaction-level
-- join to de-dup. The headline figures were therefore double-counting.
--
-- The business owner has confirmed: the Booking Sheet "Sales YYYY" tab row-18
-- "Totals" line is THE single source of truth for total revenue. The SQ + Stripe
-- APIs are useful only for transaction-level DETAIL (product names, dates),
-- never as additive revenue totals.
--
-- This migration introduces two new authoritative tables (per-tier + per-raw-
-- category audit trail) and a materialised view that mirrors the legacy
-- revenue_snapshots wide shape so the dashboard readers can switch over with
-- minimal surgery. See Docs/REVENUE-TRUTH-FROM-BOOKING-SHEET.md for the spec
-- and the 12-category to 5-tier mapping rationale.

-- ---------------------------------------------------------------------------
-- 1. Per-month per-tier truth (5 dashboard tiers)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.booking_sheet_monthly (
  property_url     text          NOT NULL DEFAULT 'https://www.alanranger.com',
  year             int           NOT NULL,
  month            int           NOT NULL CHECK (month BETWEEN 1 AND 12),
  tier_id          text          NOT NULL CHECK (tier_id IN (
                                   'courses',
                                   'workshops_nonres',
                                   'workshops_residential',
                                   'services',
                                   'academy')),
  revenue_amount   numeric(12,2) NOT NULL,
  imported_at      timestamptz   NOT NULL DEFAULT now(),
  source_workbook  text          NOT NULL,
  PRIMARY KEY (property_url, year, month, tier_id)
);

COMMENT ON TABLE public.booking_sheet_monthly IS
  'Authoritative monthly revenue per tier, sourced from the Booking Sheet '
  'Sales YYYY tab row-18 Totals + per-category grid. SINGLE SOURCE OF TRUTH '
  'for the headline revenue figure. revenue_snapshots is detail-only.';

COMMENT ON COLUMN public.booking_sheet_monthly.revenue_amount IS
  'Net of the Pick n Mix Inc/Out and Gift Vouchers Inc/Out re-attribution. '
  'Can be slightly different from the raw category sum because the Out rows '
  'cancel double-counted redemption revenue.';

-- ---------------------------------------------------------------------------
-- 2. Per-month per-RAW-CATEGORY audit trail (12 Booking Sheet categories)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.booking_sheet_monthly_category (
  property_url     text          NOT NULL DEFAULT 'https://www.alanranger.com',
  year             int           NOT NULL,
  month            int           NOT NULL CHECK (month BETWEEN 1 AND 12),
  category_order   smallint      NOT NULL CHECK (category_order BETWEEN 1 AND 20),
  category_label   text          NOT NULL,
  tier_id          text          NOT NULL,
  revenue_amount   numeric(12,2) NOT NULL,
  imported_at      timestamptz   NOT NULL DEFAULT now(),
  source_workbook  text          NOT NULL,
  source_cell_range text,
  PRIMARY KEY (property_url, year, month, category_order)
);

COMMENT ON TABLE public.booking_sheet_monthly_category IS
  'Audit-trail companion to booking_sheet_monthly. Holds each of the 12 raw '
  'Booking Sheet categories (1. Courses, 2. Workshops Non Res, ..., 12. '
  'Academy) before the tier mapping is applied. Used for drilldowns and to '
  'verify the per-tier sums in booking_sheet_monthly.';

-- ---------------------------------------------------------------------------
-- 3. Wide-format view (mirrors revenue_snapshots shape for minimal reader churn)
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS public.booking_sheet_monthly_wide;

CREATE MATERIALIZED VIEW public.booking_sheet_monthly_wide AS
SELECT
  property_url,
  year,
  month,
  make_date(year, month, 1)                                      AS period_start,
  (make_date(year, month, 1) + interval '1 month' - interval '1 day')::date AS period_end,
  jsonb_object_agg(tier_id, revenue_amount)                      AS tier_revenue,
  SUM(revenue_amount)::numeric(12,2)                             AS revenue_amount,
  'booking_sheet_truth'::text                                    AS source
FROM public.booking_sheet_monthly
GROUP BY property_url, year, month;

CREATE UNIQUE INDEX IF NOT EXISTS booking_sheet_monthly_wide_pk
  ON public.booking_sheet_monthly_wide(property_url, year, month);

CREATE INDEX IF NOT EXISTS booking_sheet_monthly_wide_period_idx
  ON public.booking_sheet_monthly_wide(period_end DESC);

COMMENT ON MATERIALIZED VIEW public.booking_sheet_monthly_wide IS
  'Dashboard-shaped view of booking_sheet_monthly: one row per (property, '
  'year, month) with tier_revenue as a jsonb map. Mirrors the legacy '
  'revenue_snapshots shape so endpoints can switch source without API churn. '
  'Refresh after every booking-sheet import.';

-- ---------------------------------------------------------------------------
-- 4. Helper: refresh function (called by the importer)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_booking_sheet_monthly_wide()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- CONCURRENTLY requires a unique index (we have one), but it fails on the
  -- very first refresh when the view is empty. Catch that case and fall back
  -- to a plain REFRESH.
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.booking_sheet_monthly_wide;
  EXCEPTION
    WHEN OTHERS THEN
      REFRESH MATERIALIZED VIEW public.booking_sheet_monthly_wide;
  END;
END;
$$;

COMMENT ON FUNCTION public.refresh_booking_sheet_monthly_wide IS
  'Refreshes the booking_sheet_monthly_wide materialised view. Call from the '
  'importer after every successful upsert into booking_sheet_monthly.';

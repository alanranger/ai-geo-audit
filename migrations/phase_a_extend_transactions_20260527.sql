-- Phase A: extend booking_sheet_transactions with the per-transaction
-- canonical product tag + landing page url tag, both read DIRECTLY from
-- the WITH_PRODUCT_MAPPING workbook (col I + col J) -- never re-derived.
--
-- Also adds two generated boolean columns (is_jlr, is_redemption) so the
-- JLR-stripped + redemption slices are first-class queries against the
-- transactions table, not downstream-computed filters.
--
-- Plus a generated month smallint column so the matview + per-month
-- aggregates don't have to extract from txn_date repeatedly.
--
-- The PK and all existing columns are unchanged -- Phase L1 readers still
-- work bit-for-bit.

ALTER TABLE public.booking_sheet_transactions
  ADD COLUMN IF NOT EXISTS canonical_product text,
  ADD COLUMN IF NOT EXISTS landing_page_url  text,
  ADD COLUMN IF NOT EXISTS is_jlr boolean
    GENERATED ALWAYS AS (upper(coalesce(booking_source, '')) = 'JLR') STORED,
  ADD COLUMN IF NOT EXISTS is_redemption boolean
    GENERATED ALWAYS AS (
      canonical_product IS NOT NULL
      AND position('Redemption' IN canonical_product) > 0
    ) STORED,
  ADD COLUMN IF NOT EXISTS month smallint
    GENERATED ALWAYS AS (EXTRACT(MONTH FROM txn_date)::smallint) STORED;

COMMENT ON COLUMN public.booking_sheet_transactions.canonical_product IS
  'Verbatim from the Booking Sheet Sales YYYY tab column I ("Canonical Product"). Authoritative tag -- not derived from event_text via event_product_mapping at ingest time, because the workbook also applies client-name and category-level overrides (e.g. Outdoor Photography client -> commercial page, Guest Blog/Judging -> specific pages) that the flat lookup cannot express.';

COMMENT ON COLUMN public.booking_sheet_transactions.landing_page_url IS
  'Verbatim from the Booking Sheet Sales YYYY tab column J ("Landing Page URL"). NULL for redemption rows (which legitimately have no landing page); non-NULL for every other row in the WITH_PRODUCT_MAPPING workbook.';

COMMENT ON COLUMN public.booking_sheet_transactions.is_jlr IS
  'Generated: TRUE when booking_source = "JLR" (case-insensitive). The JLR contract is a corporate B2B revenue stream that materially distorts the D2C narrative when blended in -- JLR-stripped slices are first-class queries via this column.';

COMMENT ON COLUMN public.booking_sheet_transactions.is_redemption IS
  'Generated: TRUE when canonical_product contains "Redemption" (i.e. the user-tagged row is "Voucher/Plan Redemption - not a product sale", a deferred-spend timing line, not a product sale). Excluding is_redemption rows isolates real product revenue from voucher/Pick-n-Mix accounting noise.';

COMMENT ON COLUMN public.booking_sheet_transactions.month IS
  'Generated: EXTRACT(MONTH FROM txn_date). Lets the wide matview group per-month without re-evaluating the date function.';

CREATE INDEX IF NOT EXISTS booking_sheet_transactions_canonical_product_idx
  ON public.booking_sheet_transactions (property_url, year, canonical_product);

CREATE INDEX IF NOT EXISTS booking_sheet_transactions_landing_page_idx
  ON public.booking_sheet_transactions (property_url, year, landing_page_url);

CREATE INDEX IF NOT EXISTS booking_sheet_transactions_jlr_idx
  ON public.booking_sheet_transactions (property_url, year, is_jlr);

CREATE INDEX IF NOT EXISTS booking_sheet_transactions_month_idx
  ON public.booking_sheet_transactions (property_url, year, month);

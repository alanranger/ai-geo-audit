-- Phase A of the per-product / per-page Revenue Truth extension:
-- ingest the canonical product list + event-text mapping.
--
-- Two new reference tables, both reload-from-CSV on every run.
--
-- 1. canonical_products  -- the 99-row master product list, loaded verbatim
--    from canonical-products-amended.csv. product_title is the primary key
--    (it is the human-readable label that appears verbatim in the workbook's
--    "Canonical Product" column, so it is the natural join key).
--
--    is_retired is derived once at load time from the title or sources field
--    containing 'RETIRED' or 'historical' (case-insensitive). is_redemption
--    is true only for the single "Voucher/Plan Redemption - not a product
--    sale" row (which legitimately has no service page).
--
-- 2. event_product_mapping  -- the 276-row event-text -> canonical_product
--    lookup, loaded from event-product-mapping-FINAL.csv. This is a
--    REFERENCE table only -- the per-transaction canonical product comes
--    DIRECTLY from the workbook's col I tag, not derived via this table at
--    ingest time (the workbook also applies client-name and category-level
--    overrides that this flat mapping cannot express).

CREATE TABLE IF NOT EXISTS public.canonical_products (
  product_title       text         PRIMARY KEY,
  product_url         text,
  category            text,
  typical_price_gbp   numeric(10,2),
  service_page_url    text,
  service_page_title  text,
  is_redemption       boolean      NOT NULL DEFAULT false,
  is_retired          boolean      NOT NULL DEFAULT false,
  known_variants      text,
  notes               text,
  imported_at         timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.canonical_products IS
  'Master product list (99 rows) loaded from canonical-products-amended.csv. product_title is the primary key -- it matches the Workbook col I "Canonical Product" tag verbatim. is_retired = title or sources contains "RETIRED" or "historical". is_redemption = true only for the single "Voucher/Plan Redemption" row (no service page).';

CREATE INDEX IF NOT EXISTS canonical_products_service_page_idx
  ON public.canonical_products (service_page_url);

CREATE INDEX IF NOT EXISTS canonical_products_category_idx
  ON public.canonical_products (category);

-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.event_product_mapping (
  event_text         text         PRIMARY KEY,
  booking_category   text,
  canonical_product  text         NOT NULL REFERENCES public.canonical_products (product_title) ON UPDATE CASCADE,
  confidence         text         CHECK (confidence IN ('HIGH','MED','LOW')),
  note               text,
  imported_at        timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.event_product_mapping IS
  'Flat event_text -> canonical_product lookup (276 rows) from event-product-mapping-FINAL.csv. REFERENCE ONLY: transactions are tagged directly via the workbook col I, never re-derived from this table at ingest time. Confidence is HIGH/MED/LOW per the source CSV.';

CREATE INDEX IF NOT EXISTS event_product_mapping_canonical_idx
  ON public.event_product_mapping (canonical_product);

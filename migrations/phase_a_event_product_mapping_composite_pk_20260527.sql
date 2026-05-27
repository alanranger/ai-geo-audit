-- Phase A correction: event_product_mapping needs a COMPOSITE primary key
-- (booking_category, event_text), not event_text alone.
--
-- The source CSV (event-product-mapping-FINAL.csv) intentionally has the
-- same event_text under multiple booking_category buckets when the workbook
-- disambiguates by both fields. Examples:
--   "Batsford" appears under 2. Workshops Non-Res (-> BATSFORD product),
--     7. 1-2-1 (-> 1-2-1 Single Session product) and 8. Gift Vouchers Inc
--     (-> Gift Voucher product) -- 3 genuinely different canonical_products.
--   "Academy", "Sensor Clean", "Print Sales" and 20+ more appear in two or
--     more booking_category buckets pointing at the same canonical_product
--     but the user keeps the duplication to express the bucket coverage.
--
-- The table is REFERENCE-ONLY (transactions are tagged via the workbook
-- col I, not via this table at ingest time), so duplicate-handling here
-- has no downstream effect -- it just preserves the source semantics.

ALTER TABLE public.event_product_mapping
  DROP CONSTRAINT IF EXISTS event_product_mapping_pkey;

ALTER TABLE public.event_product_mapping
  ALTER COLUMN booking_category SET NOT NULL;

ALTER TABLE public.event_product_mapping
  ADD CONSTRAINT event_product_mapping_pkey
  PRIMARY KEY (booking_category, event_text);

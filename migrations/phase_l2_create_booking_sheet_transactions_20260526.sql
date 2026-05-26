-- Phase L2 / Gate 2 of the Revenue Truth project: per-booking transactional
-- rows from the Sales YYYY tab detail block (cols A..G below the summary
-- grids). Header is "Date | Client | Category | Funding | Amount | Event |
-- Source" at ~row 167-169 depending on sheet layout.
--
-- One row per booking line item. Joins to booking_sheet_category_market for
-- D2C / B2B / ADJUSTMENT (market dimension), and to booking_sheet_category_gp
-- for year-specific gross profit.
--
-- Channel / funding / client splits MUST be computed FROM this table, never
-- from the cached summary-grid cells in the workbook (those cells were
-- proven unreliable -- they can sit stale after a manual save). The Revenue
-- Truth dashboard tab uses this table for sections 5 (units / avg price),
-- 6 (channel mix), 7 (new vs existing clients), 8 (funding & fees).
--
-- client_type is derived from booking_source: 'Existing' if source is
-- literally 'Existing' else 'New'. channel is the booking source for new
-- clients only (NULL for Existing -- existing clients have no acquisition
-- channel for the new booking).
--
-- Idempotent on (property_url, year, source_workbook, source_row) so the
-- backfill can re-run safely and updates rather than duplicates.

CREATE TABLE IF NOT EXISTS public.booking_sheet_transactions (
  property_url     text          NOT NULL DEFAULT 'https://www.alanranger.com',
  year             int           NOT NULL,
  source_workbook  text          NOT NULL,
  source_row       int           NOT NULL,
  txn_date         date          NOT NULL,
  client_name      text,
  category_label   text          NOT NULL,
  category_order   smallint,
  funding          text,
  amount           numeric(12,2) NOT NULL,
  event_label      text,
  booking_source   text,
  client_type      text          NOT NULL CHECK (client_type IN ('Existing','New')),
  channel          text,
  imported_at      timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (property_url, year, source_workbook, source_row)
);

COMMENT ON TABLE public.booking_sheet_transactions IS
  'Per-booking transactional rows from the Booking Sheet Sales YYYY detail block (cols A-G below the summary grids). One row per booking line item. category_order joins to booking_sheet_category_market for D2C/B2B/ADJUSTMENT. client_type is derived: Existing if booking_source = Existing else New. channel is the booking source for new clients only (NULL for Existing). Funding is the banking source (Stripe / Bank / PayPal / Gift Voucher Out etc). Idempotent on (property_url, year, source_workbook, source_row) so re-imports update without duplicating.';

CREATE INDEX IF NOT EXISTS booking_sheet_transactions_year_date_idx
  ON public.booking_sheet_transactions (property_url, year, txn_date);

CREATE INDEX IF NOT EXISTS booking_sheet_transactions_category_idx
  ON public.booking_sheet_transactions (property_url, year, category_order);

CREATE INDEX IF NOT EXISTS booking_sheet_transactions_channel_idx
  ON public.booking_sheet_transactions (property_url, year, channel);

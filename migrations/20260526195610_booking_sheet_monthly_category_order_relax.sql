-- 2026-05-26 19:56 UTC -- Phase L follow-up.
-- Relax booking_sheet_monthly_category.category_order CHECK constraint from
-- (1..20) to (0..20) so the parser can record exceptional/header rows that
-- don't carry a numbered category position. Pure constraint widening -- no
-- existing rows are affected.

ALTER TABLE public.booking_sheet_monthly_category
  DROP CONSTRAINT IF EXISTS booking_sheet_monthly_category_category_order_check;

ALTER TABLE public.booking_sheet_monthly_category
  ADD CONSTRAINT booking_sheet_monthly_category_category_order_check
  CHECK (category_order BETWEEN 0 AND 20);

-- 2026-05-26 20:43 UTC -- Phase L1 correction (step 2 of 4).
--
-- Create the canonical 12-category to 3-market mapping table. This replaces
-- the hard-coded CATEGORY_TO_TIER constant that lived in
-- lib/booking-sheet-truth-parser.mjs in Phase L. Storing the mapping as DATA
-- means it can be edited (e.g. a future "Workshops Online" category added by
-- the user) without a code release -- a refresh of booking_sheet_monthly_wide
-- is then enough.
--
-- D2C (direct-to-consumer):  Courses, Workshops Non Res, Workshops Res,
--                            Mentoring, 1-2-1, Academy.
-- B2B (business-to-business): Prints & Royalties, Commissions.
-- ADJUSTMENT (deferred-spend accounting plumbing, NOT revenue):
--                            Pick n Mix Inc, Pick n Mix Out,
--                            Gift Vouchers Inc, Gift Vouchers Out.
--
-- ADJUSTMENT rows are voucher / pre-payment timing pairs (cash IN booked
-- against an Inc row, attendance later credited via the corresponding Out
-- row so the workshop revenue is not double-counted). The pair nets toward
-- zero across the calendar year. ADJUSTMENT is NEVER a headline revenue
-- line and is always shown on the dashboard as a separate labelled figure.

CREATE TABLE public.booking_sheet_category_market (
  category_order  smallint PRIMARY KEY CHECK (category_order BETWEEN 1 AND 20),
  category_label  text     NOT NULL UNIQUE,
  market          text     NOT NULL CHECK (market IN ('D2C','B2B','ADJUSTMENT')),
  is_revenue      boolean  NOT NULL,
  notes           text
);

COMMENT ON TABLE public.booking_sheet_category_market IS 'Single source of truth for the 12-category to 3-market mapping. D2C = direct-to-consumer (workshops/courses/mentoring/1-2-1/academy). B2B = business-to-business (prints, commissions). ADJUSTMENT = deferred-spend accounting plumbing (voucher Inc/Out pairs) -- NEVER a headline revenue line, always shown as a separate labelled figure.';

INSERT INTO public.booking_sheet_category_market
  (category_order, category_label, market, is_revenue, notes) VALUES
  (1,  '1. Courses/masterclasses',     'D2C',        true,  'Structured tuition courses delivered direct to learners.'),
  (2,  '2. Workshops Non Residential', 'D2C',        true,  'Day workshops delivered direct to attendees.'),
  (3,  '3. Workshops Residential',     'D2C',        true,  'Multi-day residential workshops delivered direct to attendees.'),
  (4,  '4. Pick n Mix Inc',            'ADJUSTMENT', false, 'Voucher sold: cash IN, attendance deferred. Counter-entry to row 5.'),
  (5,  '5. Pick n Mix Out',            'ADJUSTMENT', false, 'Voucher redeemed: counter-entry to row 4 so the workshop revenue does not double-count.'),
  (6,  '6. Mentoring',                 'D2C',        true,  '1-to-1 mentoring sessions delivered direct.'),
  (7,  '7. 1-2-1',                     'D2C',        true,  '1-to-1 tuition delivered direct.'),
  (8,  '8. Gift Vouchers Inc',         'ADJUSTMENT', false, 'Gift voucher sold: cash IN, attendance deferred. Counter-entry to row 9.'),
  (9,  '9. Gift Vouchers Out',         'ADJUSTMENT', false, 'Gift voucher redeemed: counter-entry to row 8.'),
  (10, '10. Prints & Royalties',       'B2B',        true,  'Print sales and image-licence royalties.'),
  (11, '11 Commissions',               'B2B',        true,  'Commercial photography commissions.'),
  (12, '12. Academy',                  'D2C',        true,  'Membership-based learning platform subscriptions.');

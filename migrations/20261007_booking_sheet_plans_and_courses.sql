-- Phase A Strategy data: Plans + Courses-Classes tabs from Booking Sheet upload.
-- PicknMix amounts already stored on booking_sheet_transactions (pairs net to £0).

CREATE TABLE IF NOT EXISTS public.booking_sheet_plans (
  id bigserial PRIMARY KEY,
  property_url text NOT NULL,
  plan_id text NULL,
  client_name text NULL,
  email text NULL,
  start_date date NULL,
  end_date date NULL,
  plan_type text NULL,
  plan_value numeric NULL,
  payment numeric NULL,
  discount_pct numeric NULL,
  residential_discount_pct numeric NULL,
  review_length_mins numeric NULL,
  academy_granted boolean NULL,
  academy_until date NULL,
  review_1_due date NULL,
  review_1_held date NULL,
  review_2_due date NULL,
  review_2_held date NULL,
  review_3_due date NULL,
  review_3_held date NULL,
  review_4_due date NULL,
  review_4_held date NULL,
  status text NULL,
  came_from text NULL,
  course_attended text NULL,
  notes text NULL,
  source_row integer NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  source_file text NULL
);

CREATE INDEX IF NOT EXISTS booking_sheet_plans_prop_start_idx
  ON public.booking_sheet_plans (property_url, start_date);
CREATE INDEX IF NOT EXISTS booking_sheet_plans_email_idx
  ON public.booking_sheet_plans (property_url, lower(email));

CREATE TABLE IF NOT EXISTS public.booking_sheet_course_attendees (
  id bigserial PRIMARY KEY,
  property_url text NOT NULL,
  from_date date NULL,
  to_date date NULL,
  date_booked date NULL,
  event_name text NULL,
  location text NULL,
  duration_text text NULL,
  paid numeric NULL,
  balance numeric NULL,
  source_raw text NULL,
  source_bucket text NULL,
  booking_ref text NULL,
  prefix text NULL,
  first_name text NULL,
  last_name text NULL,
  client_name text NULL,
  email text NULL,
  is_beginners boolean NOT NULL DEFAULT false,
  is_booking_row boolean NOT NULL DEFAULT true,
  source_row integer NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  source_file text NULL
);

CREATE INDEX IF NOT EXISTS booking_sheet_course_attendees_prop_from_idx
  ON public.booking_sheet_course_attendees (property_url, from_date);
CREATE INDEX IF NOT EXISTS booking_sheet_course_attendees_beginners_idx
  ON public.booking_sheet_course_attendees (property_url, is_beginners)
  WHERE is_beginners = true;

COMMENT ON TABLE public.booking_sheet_plans IS
  'One row per Pick n Mix plan from Booking Sheet Plans tab. Synced on booking-sheet-upload.';
COMMENT ON TABLE public.booking_sheet_course_attendees IS
  'Courses-Classes tab rows. source_bucket = Google|Gift|Existing & referral|JLR|Other.';

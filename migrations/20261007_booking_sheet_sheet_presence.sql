-- Last Booking Sheet upload: which optional tabs were present (Plans, etc.).

CREATE TABLE IF NOT EXISTS public.booking_sheet_sheet_presence (
  property_url text NOT NULL,
  sheet_key text NOT NULL,
  present boolean NOT NULL DEFAULT false,
  sheet_name text NULL,
  row_count integer NOT NULL DEFAULT 0,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (property_url, sheet_key)
);

COMMENT ON TABLE public.booking_sheet_sheet_presence IS
  'Per-upload presence of optional Booking Sheet tabs (e.g. plans). Used for Strategy empty-state wording.';

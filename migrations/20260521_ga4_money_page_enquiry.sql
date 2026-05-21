ALTER TABLE public.ga4_site_metrics_28d
  ADD COLUMN IF NOT EXISTS money_page_enquiry_events_28d NUMERIC NOT NULL DEFAULT 0;

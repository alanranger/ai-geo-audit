-- GA4 rolling 28d site snapshot (Revenue Funnel middle stage)
CREATE TABLE IF NOT EXISTS public.ga4_site_metrics_28d (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_url TEXT NOT NULL,
  ga4_property_id TEXT NOT NULL,
  date_start DATE NOT NULL,
  date_end DATE NOT NULL,
  sessions_28d NUMERIC NOT NULL DEFAULT 0,
  page_views_28d NUMERIC NOT NULL DEFAULT 0,
  enquiry_events_28d NUMERIC NOT NULL DEFAULT 0,
  event_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_ga4_site_metrics_28d_property_end UNIQUE (property_url, date_end)
);

CREATE INDEX IF NOT EXISTS idx_ga4_site_metrics_28d_property_end
  ON public.ga4_site_metrics_28d(property_url, date_end DESC);

CREATE INDEX IF NOT EXISTS idx_ga4_site_metrics_28d_captured
  ON public.ga4_site_metrics_28d(captured_at DESC);

ALTER TABLE public.ga4_site_metrics_28d ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ga4_site_metrics_28d_select_all" ON public.ga4_site_metrics_28d;
CREATE POLICY "ga4_site_metrics_28d_select_all"
ON public.ga4_site_metrics_28d FOR SELECT USING (true);

DROP POLICY IF EXISTS "ga4_site_metrics_28d_write_service" ON public.ga4_site_metrics_28d;
CREATE POLICY "ga4_site_metrics_28d_write_service"
ON public.ga4_site_metrics_28d FOR ALL USING (true) WITH CHECK (true);

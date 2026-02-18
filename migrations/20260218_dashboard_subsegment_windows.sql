-- =========================================
-- Dashboard Sub-segment Window Metrics
-- =========================================
-- Purpose: Store exact dashboard windows (Latest / 7d / 28d)
-- for Landing, Event, Product, Other, reconciled to top GSC totals.

CREATE TABLE IF NOT EXISTS public.dashboard_subsegment_windows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  run_id TEXT NOT NULL,
  site_url TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'all_pages',
  window_days INTEGER NOT NULL, -- 1, 7, 28
  date_start DATE NOT NULL,
  date_end DATE NOT NULL,
  segment TEXT NOT NULL, -- landing | event | product | other
  pages_count INTEGER NOT NULL DEFAULT 0,
  clicks NUMERIC NOT NULL DEFAULT 0,
  impressions NUMERIC NOT NULL DEFAULT 0,
  ctr NUMERIC NOT NULL DEFAULT 0, -- ratio (0..1)
  avg_position NUMERIC,
  CONSTRAINT dashboard_subsegment_windows_unique
    UNIQUE (run_id, site_url, scope, window_days, segment)
);

CREATE INDEX IF NOT EXISTS idx_dash_subseg_windows_site_scope_end
  ON public.dashboard_subsegment_windows(site_url, scope, date_end DESC, window_days, segment);

CREATE INDEX IF NOT EXISTS idx_dash_subseg_windows_run
  ON public.dashboard_subsegment_windows(run_id, site_url, scope);

ALTER TABLE public.dashboard_subsegment_windows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dashboard_subsegment_windows_select_all" ON public.dashboard_subsegment_windows;
CREATE POLICY "dashboard_subsegment_windows_select_all"
ON public.dashboard_subsegment_windows
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "dashboard_subsegment_windows_insert_service" ON public.dashboard_subsegment_windows;
CREATE POLICY "dashboard_subsegment_windows_insert_service"
ON public.dashboard_subsegment_windows
FOR INSERT
WITH CHECK (true);


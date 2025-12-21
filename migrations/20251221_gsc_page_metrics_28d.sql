-- =========================================
-- GSC Page-Level 28d Metrics Table
-- =========================================
-- Purpose: Store page-level GSC metrics (rolling 28d) per audit run
-- Used by: Money Pages module to match GSC "Pages" tab exactly
-- Data source: GSC Search Analytics API (dimensions: ['page'], unfiltered)

CREATE TABLE IF NOT EXISTS public.gsc_page_metrics_28d (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Audit run identifier
  run_id TEXT NOT NULL, -- Can be audit_date or audit_results.id
  site_url TEXT NOT NULL,
  
  -- Page URL (normalized)
  page_url TEXT NOT NULL,
  
  -- Date range for this snapshot (rolling 28d)
  date_start DATE NOT NULL,
  date_end DATE NOT NULL,
  
  -- GSC metrics (unfiltered, all positions, all queries)
  clicks_28d NUMERIC NOT NULL DEFAULT 0,
  impressions_28d NUMERIC NOT NULL DEFAULT 0,
  ctr_28d NUMERIC NOT NULL DEFAULT 0, -- Stored as fraction (0.014), format as % in UI
  position_28d NUMERIC, -- Average position (can be null if no impressions)
  
  -- Metadata
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Uniqueness: one record per run_id + page_url
  CONSTRAINT uq_gsc_page_metrics_28d_run_page UNIQUE (run_id, page_url)
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_gsc_page_metrics_28d_run_id 
  ON public.gsc_page_metrics_28d(run_id);

CREATE INDEX IF NOT EXISTS idx_gsc_page_metrics_28d_page_url 
  ON public.gsc_page_metrics_28d(page_url);

CREATE INDEX IF NOT EXISTS idx_gsc_page_metrics_28d_dates 
  ON public.gsc_page_metrics_28d(date_start DESC, date_end DESC);

CREATE INDEX IF NOT EXISTS idx_gsc_page_metrics_28d_captured 
  ON public.gsc_page_metrics_28d(captured_at DESC);

-- RLS (if using Supabase Auth)
ALTER TABLE public.gsc_page_metrics_28d ENABLE ROW LEVEL SECURITY;

-- Allow all reads (page metrics are aggregated data, not user-specific)
DROP POLICY IF EXISTS "gsc_page_metrics_28d_select_all" ON public.gsc_page_metrics_28d;
CREATE POLICY "gsc_page_metrics_28d_select_all"
ON public.gsc_page_metrics_28d
FOR SELECT
USING (true);

-- Only service role can insert/update (via API)
DROP POLICY IF EXISTS "gsc_page_metrics_28d_insert_service" ON public.gsc_page_metrics_28d;
CREATE POLICY "gsc_page_metrics_28d_insert_service"
ON public.gsc_page_metrics_28d
FOR INSERT
WITH CHECK (true);

DROP POLICY IF EXISTS "gsc_page_metrics_28d_update_service" ON public.gsc_page_metrics_28d;
CREATE POLICY "gsc_page_metrics_28d_update_service"
ON public.gsc_page_metrics_28d
FOR UPDATE
USING (true)
WITH CHECK (true);


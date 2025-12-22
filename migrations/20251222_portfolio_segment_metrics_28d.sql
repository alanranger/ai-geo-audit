-- =========================================
-- Portfolio Segment Metrics 28d (Phase 3a)
-- =========================================
-- Purpose: Store segment-level snapshots per audit run for Portfolio tab trends
-- Used by: Portfolio tab (Median Delta Over Time chart & Monthly KPI Tracker)

CREATE TABLE IF NOT EXISTS public.portfolio_segment_metrics_28d (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  run_id TEXT NOT NULL,                    -- Must match audit run_id used elsewhere
  site_url TEXT NOT NULL,
  segment TEXT NOT NULL,                   -- 'money', 'landing', 'event', 'product', 'all_tracked'
  scope TEXT NOT NULL,                     -- 'active_cycles_only' | 'all_tracked' etc (match UI)
  date_start DATE NOT NULL,
  date_end DATE NOT NULL,
  pages_count INTEGER NOT NULL DEFAULT 0,
  clicks_28d NUMERIC NOT NULL DEFAULT 0,
  impressions_28d NUMERIC NOT NULL DEFAULT 0,
  ctr_28d NUMERIC NOT NULL DEFAULT 0,      -- Stored as ratio (0-1), format to % in UI
  position_28d NUMERIC,                    -- Weighted average position (nullable)
  
  CONSTRAINT uq_portfolio_segment_metrics_28d_run_segment_scope 
    UNIQUE (run_id, site_url, segment, scope)
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_portfolio_segment_metrics_28d_site_segment_scope_created 
  ON public.portfolio_segment_metrics_28d(site_url, segment, scope, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_portfolio_segment_metrics_28d_site_created 
  ON public.portfolio_segment_metrics_28d(site_url, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_portfolio_segment_metrics_28d_run_id 
  ON public.portfolio_segment_metrics_28d(run_id);

-- RLS (if using Supabase Auth)
ALTER TABLE public.portfolio_segment_metrics_28d ENABLE ROW LEVEL SECURITY;

-- Allow all reads (snapshots are aggregated data, not user-specific)
DROP POLICY IF EXISTS "portfolio_segment_metrics_28d_select_all" ON public.portfolio_segment_metrics_28d;
CREATE POLICY "portfolio_segment_metrics_28d_select_all"
ON public.portfolio_segment_metrics_28d
FOR SELECT
USING (true);

-- Only service role can insert/update (via API)
DROP POLICY IF EXISTS "portfolio_segment_metrics_28d_insert_service" ON public.portfolio_segment_metrics_28d;
CREATE POLICY "portfolio_segment_metrics_28d_insert_service"
ON public.portfolio_segment_metrics_28d
FOR INSERT
WITH CHECK (true);


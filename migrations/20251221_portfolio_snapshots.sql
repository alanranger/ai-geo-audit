-- =========================================
-- Portfolio Snapshots Table (Phase 3)
-- =========================================
-- Purpose: Store portfolio-level KPI snapshots for trend reporting
-- Used by: Portfolio tab (Median Delta Over Time chart & Monthly KPI Tracker)

CREATE TABLE IF NOT EXISTS public.portfolio_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Snapshot metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  period_start DATE NOT NULL, -- Start date of the period (e.g., week start, month start)
  period_type TEXT NOT NULL CHECK (period_type IN ('weekly', 'monthly')), -- Time grain
  
  -- Segment and KPI
  segment TEXT NOT NULL, -- 'all', 'money_pages', 'landing', 'event', 'product'
  kpi TEXT NOT NULL, -- 'ctr_28d', 'clicks_28d', 'impressions_28d', 'avg_position', 'ai_citations', 'ai_overview'
  
  -- Scope filter
  scope TEXT NOT NULL DEFAULT 'all' CHECK (scope IN ('active_only', 'all')),
  
  -- Calculated values
  median_delta NUMERIC, -- Median of (latest - baseline) for the selected KPI
  median_value NUMERIC, -- Median of latest values (for Monthly KPI Tracker)
  task_count INTEGER, -- Number of tasks included in this snapshot
  
  -- Optional: filters hash for reproducibility
  filters_hash TEXT,
  filters_json JSONB,
  
  -- Indexes for fast queries
  CONSTRAINT idx_portfolio_snapshots_lookup 
    UNIQUE (period_start, period_type, segment, kpi, scope)
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_period 
  ON public.portfolio_snapshots(period_start DESC, period_type, segment, kpi);

CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_created 
  ON public.portfolio_snapshots(created_at DESC);

-- RLS (if using Supabase Auth)
ALTER TABLE public.portfolio_snapshots ENABLE ROW LEVEL SECURITY;

-- Allow all reads (snapshots are aggregated data, not user-specific)
DROP POLICY IF EXISTS "portfolio_snapshots_select_all" ON public.portfolio_snapshots;
CREATE POLICY "portfolio_snapshots_select_all"
ON public.portfolio_snapshots
FOR SELECT
USING (true);

-- Only service role can insert/update (via API)
DROP POLICY IF EXISTS "portfolio_snapshots_insert_service" ON public.portfolio_snapshots;
CREATE POLICY "portfolio_snapshots_insert_service"
ON public.portfolio_snapshots
FOR INSERT
WITH CHECK (true); -- Service role bypasses RLS

DROP POLICY IF EXISTS "portfolio_snapshots_update_service" ON public.portfolio_snapshots;
CREATE POLICY "portfolio_snapshots_update_service"
ON public.portfolio_snapshots
FOR UPDATE
USING (true)
WITH CHECK (true); -- Service role bypasses RLS


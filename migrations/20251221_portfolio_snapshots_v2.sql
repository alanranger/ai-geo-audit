-- =========================================
-- Portfolio Snapshots v2 (Phase 3 - Real History)
-- =========================================
-- Purpose: Store portfolio-level KPI snapshots per audit run for trend reporting
-- Used by: Portfolio tab (Median Delta Over Time chart & Monthly KPI Tracker)

-- TABLE 1: portfolio_audit_runs
CREATE TABLE IF NOT EXISTS public.portfolio_audit_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  window_days INTEGER NOT NULL DEFAULT 28,
  window_start DATE NULL,
  window_end DATE NULL,
  note TEXT NULL
);

-- TABLE 2: portfolio_snapshots (new version with run_id)
CREATE TABLE IF NOT EXISTS public.portfolio_snapshots_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.portfolio_audit_runs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  segment TEXT NOT NULL, -- 'all_tracked' | 'money' | 'landing' | 'event' | 'product'
  scope TEXT NOT NULL, -- 'active_only' | 'all'
  kpi TEXT NOT NULL, -- 'ctr_28d' | 'clicks_28d' | 'impressions_28d' | 'avg_position' | 'ai_citations' | 'ai_overview' | 'median_delta_ctr_28d' | etc.
  value NUMERIC NULL,
  unit TEXT NULL, -- 'ratio' | 'count' | 'position' | 'pp' (optional)
  meta JSONB NULL -- optional (filters, counts, etc.)
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_v2_kpi_segment_scope_created 
  ON public.portfolio_snapshots_v2(kpi, segment, scope, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_v2_run_id 
  ON public.portfolio_snapshots_v2(run_id);

CREATE INDEX IF NOT EXISTS idx_portfolio_audit_runs_created 
  ON public.portfolio_audit_runs(created_at DESC);

-- RLS (if using Supabase Auth)
ALTER TABLE public.portfolio_audit_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio_snapshots_v2 ENABLE ROW LEVEL SECURITY;

-- Allow all reads (snapshots are aggregated data, not user-specific)
DROP POLICY IF EXISTS "portfolio_audit_runs_select_all" ON public.portfolio_audit_runs;
CREATE POLICY "portfolio_audit_runs_select_all"
ON public.portfolio_audit_runs
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "portfolio_snapshots_v2_select_all" ON public.portfolio_snapshots_v2;
CREATE POLICY "portfolio_snapshots_v2_select_all"
ON public.portfolio_snapshots_v2
FOR SELECT
USING (true);

-- Only service role can insert/update (via API)
DROP POLICY IF EXISTS "portfolio_audit_runs_insert_service" ON public.portfolio_audit_runs;
CREATE POLICY "portfolio_audit_runs_insert_service"
ON public.portfolio_audit_runs
FOR INSERT
WITH CHECK (true);

DROP POLICY IF EXISTS "portfolio_snapshots_v2_insert_service" ON public.portfolio_snapshots_v2;
CREATE POLICY "portfolio_snapshots_v2_insert_service"
ON public.portfolio_snapshots_v2
FOR INSERT
WITH CHECK (true);



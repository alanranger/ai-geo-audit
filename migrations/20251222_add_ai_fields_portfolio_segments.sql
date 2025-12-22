-- =========================================
-- Add AI Citations and AI Overview fields to portfolio_segment_metrics_28d
-- =========================================
-- Purpose: Store AI citations and AI overview counts per segment for Portfolio tab
-- Used by: Portfolio tab (AI Citations and AI Overview KPIs)

ALTER TABLE public.portfolio_segment_metrics_28d
  ADD COLUMN IF NOT EXISTS ai_citations_28d INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_overview_present_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.portfolio_segment_metrics_28d.ai_citations_28d IS 'Total AI citations from alanranger.com in AI Overviews for keywords in this segment';
COMMENT ON COLUMN public.portfolio_segment_metrics_28d.ai_overview_present_count IS 'Number of keywords in this segment that have AI Overview present';


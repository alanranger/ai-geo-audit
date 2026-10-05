-- Ranking incompleteness guard (2026-10-05)
-- Incomplete keyword_rankings days must not be treated as latest for dials/CEO.
ALTER TABLE public.audit_results
  ADD COLUMN IF NOT EXISTS ranking_incomplete boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS ranking_quality text,
  ADD COLUMN IF NOT EXISTS ranking_quality_detail jsonb;

COMMENT ON COLUMN public.audit_results.ranking_incomplete IS
  'True when keyword_rankings for this audit_date has >10% null serp_surface_stack (or empty/incomplete captures).';
COMMENT ON COLUMN public.audit_results.ranking_quality IS 'complete | incomplete';

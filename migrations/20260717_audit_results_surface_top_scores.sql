-- Persist Surface Visibility + Top of Page headline scores per audit (trend chart SoT)
ALTER TABLE public.audit_results
  ADD COLUMN IF NOT EXISTS surface_visibility_score integer,
  ADD COLUMN IF NOT EXISTS top_of_page_score integer;

COMMENT ON COLUMN public.audit_results.surface_visibility_score IS
  'Demand-weighted Surface Visibility rollup (0-100) from keyword_rankings serp_surface_stack at save time';
COMMENT ON COLUMN public.audit_results.top_of_page_score IS
  'Top of page rollup (0-100) from keyword_rankings serp_surface_stack at save time';

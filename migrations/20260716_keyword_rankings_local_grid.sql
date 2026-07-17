-- 5×5 local grid aggregates for Local-tier keywords (Alan 2026-07-16)
ALTER TABLE public.keyword_rankings
  ADD COLUMN IF NOT EXISTS local_grid jsonb NULL;

COMMENT ON COLUMN public.keyword_rankings.local_grid IS
  'GBP-centred grid capture: pack/organic best+average+coverage and per_point samples. NULL = single-pin or national.';

-- Hyperlocal SERP capture audit metadata (Alan green-light 2026-07-16)
ALTER TABLE public.keyword_rankings
  ADD COLUMN IF NOT EXISTS location_coordinate text NULL,
  ADD COLUMN IF NOT EXISTS location_code integer NULL,
  ADD COLUMN IF NOT EXISTS device text NULL,
  ADD COLUMN IF NOT EXISTS os text NULL,
  ADD COLUMN IF NOT EXISTS serp_depth integer NULL;

COMMENT ON COLUMN public.keyword_rankings.location_coordinate IS
  'DataForSEO location_coordinate used for this row (Local-tier hyperlocal only). NULL = not used.';

COMMENT ON COLUMN public.keyword_rankings.location_code IS
  'DataForSEO location_code used for this SERP pull (e.g. 9215523 Coventry, 2826 UK).';

-- Release 0: ordered SERP surface stack (schema_version 3 foundation)
ALTER TABLE public.keyword_rankings
  ADD COLUMN IF NOT EXISTS serp_surface_stack jsonb NULL;

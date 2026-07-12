-- keyword_rankings_surface_fields_r1 (applied via Supabase MCP 2026-07-12)
ALTER TABLE public.keyword_rankings
  ADD COLUMN IF NOT EXISTS local_pack_position integer NULL,
  ADD COLUMN IF NOT EXISTS kp_present boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS kp_ours boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS featured_snippet_ours boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paa_ours boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS keyword_class text NULL,
  ADD COLUMN IF NOT EXISTS class_unmapped boolean NOT NULL DEFAULT false;

ALTER TABLE public.audit_results
  ADD COLUMN IF NOT EXISTS knowledge_panel_source text NULL;

-- Stage 1: target-keyword master SoT columns (applied via Supabase MCP 2026-07-18)
DO $$ BEGIN
  CREATE TYPE public.target_keyword_class AS ENUM (
    'tracked',
    'longtail_by_design',
    'none_utility',
    'cannibal_candidate'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.traditional_seo_target_keyword_overrides
  ADD COLUMN IF NOT EXISTS target_class public.target_keyword_class,
  ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '';

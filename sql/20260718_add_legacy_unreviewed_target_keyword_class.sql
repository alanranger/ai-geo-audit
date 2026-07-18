-- Stage 1b: CSV-07 backlog migration class (applied via Supabase MCP 2026-07-18)
DO $$ BEGIN
  ALTER TYPE public.target_keyword_class ADD VALUE IF NOT EXISTS 'legacy_unreviewed';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

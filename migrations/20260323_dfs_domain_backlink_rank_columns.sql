-- DataForSEO domain index: persist linking-domain / page ranks for UI sort + display.
-- Idempotent; run in Supabase SQL editor.

ALTER TABLE public.dfs_domain_backlink_rows
  ADD COLUMN IF NOT EXISTS domain_from_rank INTEGER,
  ADD COLUMN IF NOT EXISTS page_from_rank INTEGER;

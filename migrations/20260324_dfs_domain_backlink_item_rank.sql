-- DataForSEO backlinks/live item field `rank` (backlink rank) for modal + sort.
ALTER TABLE public.dfs_domain_backlink_rows
  ADD COLUMN IF NOT EXISTS backlink_rank INTEGER;

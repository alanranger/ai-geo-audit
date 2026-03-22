-- Mirror of migrations/20260323_dfs_domain_backlink_rank_columns.sql for manual runs.

ALTER TABLE public.dfs_domain_backlink_rows
  ADD COLUMN IF NOT EXISTS domain_from_rank INTEGER,
  ADD COLUMN IF NOT EXISTS page_from_rank INTEGER;

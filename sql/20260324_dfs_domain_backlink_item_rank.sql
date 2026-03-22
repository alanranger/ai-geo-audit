-- Mirror of migrations/20260324_dfs_domain_backlink_item_rank.sql

ALTER TABLE public.dfs_domain_backlink_rows
  ADD COLUMN IF NOT EXISTS backlink_rank INTEGER;

-- Per-link snapshot at "Save baseline" for wins/losses vs current dfs_domain_backlink_rows.
-- Apply in Supabase SQL editor. APIs: dfs-backlink-tile-baseline (POST/DELETE), dfs-domain-backlink-baseline-diff (GET).

CREATE TABLE IF NOT EXISTS public.dfs_backlink_baseline_edges (
  domain_host TEXT NOT NULL,
  row_hash TEXT NOT NULL,
  url_from TEXT NOT NULL DEFAULT '',
  url_to TEXT NOT NULL DEFAULT '',
  domain_from_rank INTEGER,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (domain_host, row_hash)
);

CREATE INDEX IF NOT EXISTS idx_dfs_backlink_baseline_edges_domain
  ON public.dfs_backlink_baseline_edges (domain_host);

CREATE OR REPLACE FUNCTION public.dfs_refresh_backlink_baseline_edges(p_domain TEXT)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.dfs_backlink_baseline_edges WHERE domain_host = p_domain;
  INSERT INTO public.dfs_backlink_baseline_edges (domain_host, row_hash, url_from, url_to, domain_from_rank, saved_at)
  SELECT r.domain_host, r.row_hash, r.url_from, r.url_to, r.domain_from_rank, NOW()
  FROM public.dfs_domain_backlink_rows r
  WHERE r.domain_host = p_domain;
$$;

CREATE OR REPLACE FUNCTION public.dfs_backlink_baseline_diff_new(p_domain TEXT, p_limit INTEGER DEFAULT 25)
RETURNS TABLE (url_from TEXT, url_to TEXT, domain_from_rank INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.url_from, c.url_to, c.domain_from_rank::INTEGER
  FROM public.dfs_domain_backlink_rows c
  WHERE c.domain_host = p_domain
    AND NOT EXISTS (
      SELECT 1
      FROM public.dfs_backlink_baseline_edges b
      WHERE b.domain_host = p_domain AND b.row_hash = c.row_hash
    )
  ORDER BY c.domain_from_rank DESC NULLS LAST, c.url_from
  LIMIT GREATEST(1, LEAST(p_limit, 200));
$$;

CREATE OR REPLACE FUNCTION public.dfs_backlink_baseline_diff_lost(p_domain TEXT, p_limit INTEGER DEFAULT 25)
RETURNS TABLE (url_from TEXT, url_to TEXT, domain_from_rank INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.url_from, b.url_to, b.domain_from_rank::INTEGER
  FROM public.dfs_backlink_baseline_edges b
  WHERE b.domain_host = p_domain
    AND NOT EXISTS (
      SELECT 1 FROM public.dfs_domain_backlink_rows c WHERE c.row_hash = b.row_hash
    )
  ORDER BY b.domain_from_rank DESC NULLS LAST, b.url_from
  LIMIT GREATEST(1, LEAST(p_limit, 200));
$$;

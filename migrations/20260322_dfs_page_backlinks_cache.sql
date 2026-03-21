-- DataForSEO backlinks caches: domain summary + per-page rows.
-- Safe if summary table already exists (older deploy): extra columns added with IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS public.dfs_backlink_summary_cache (
  domain_host TEXT PRIMARY KEY,
  include_subdomains BOOLEAN NOT NULL DEFAULT TRUE,
  backlinks INTEGER,
  referring_domains INTEGER,
  referring_main_domains INTEGER,
  broken_backlinks INTEGER,
  broken_pages INTEGER,
  backlinks_spam_score INTEGER,
  target_spam_score INTEGER,
  rank INTEGER,
  crawled_pages INTEGER,
  internal_links_count INTEGER,
  external_links_count INTEGER,
  dofollow_backlinks INTEGER,
  nofollow_backlinks INTEGER,
  cost_last NUMERIC(14, 6),
  raw_result JSONB,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dfs_backlink_summary_cache_fetched_at
  ON public.dfs_backlink_summary_cache (fetched_at DESC);

ALTER TABLE public.dfs_backlink_summary_cache
  ADD COLUMN IF NOT EXISTS dofollow_backlinks INTEGER,
  ADD COLUMN IF NOT EXISTS nofollow_backlinks INTEGER;

CREATE TABLE IF NOT EXISTS public.dfs_page_backlinks_cache (
  page_url TEXT PRIMARY KEY,
  domain_host TEXT NOT NULL,
  include_subdomains BOOLEAN NOT NULL DEFAULT TRUE,
  backlink_rows JSONB NOT NULL DEFAULT '[]'::JSONB,
  row_count INTEGER,
  dofollow_count INTEGER,
  nofollow_count INTEGER,
  api_total_count INTEGER,
  cost_last NUMERIC(14, 6),
  raw_meta JSONB,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dfs_page_backlinks_cache_domain_fetched
  ON public.dfs_page_backlinks_cache (domain_host, fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_dfs_page_backlinks_cache_fetched_at
  ON public.dfs_page_backlinks_cache (fetched_at DESC);

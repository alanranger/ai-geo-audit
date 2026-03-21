-- DataForSEO Backlinks API — summary/live cache (domain-level index metrics)
-- Run in Supabase SQL editor (service role reads/writes via API).

create table if not exists public.dfs_backlink_summary_cache (
  domain_host text primary key,
  include_subdomains boolean not null default true,
  backlinks integer,
  referring_domains integer,
  referring_main_domains integer,
  broken_backlinks integer,
  broken_pages integer,
  backlinks_spam_score integer,
  target_spam_score integer,
  rank integer,
  crawled_pages integer,
  internal_links_count integer,
  external_links_count integer,
  dofollow_backlinks integer,
  nofollow_backlinks integer,
  cost_last numeric(14, 6),
  raw_result jsonb,
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_dfs_backlink_summary_cache_fetched_at
  on public.dfs_backlink_summary_cache (fetched_at desc);

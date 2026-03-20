-- Cached keyword demand (e.g. Keywords Everywhere) + optional rank/Moz for Traditional SEO table.
-- API: /api/aigeo/keyword-target-metrics (lookup = DB only; refresh = external API + upsert).

create table if not exists public.keyword_target_metrics_cache (
  id uuid primary key default gen_random_uuid(),
  page_url text not null,
  keyword text not null,
  search_volume integer,
  cpc numeric(14, 6),
  competition numeric(14, 6),
  rank_position numeric(10, 2),
  moz_domain_authority integer,
  provider text not null default 'keywordseverywhere',
  raw_payload jsonb,
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint keyword_target_metrics_cache_page_keyword unique (page_url, keyword)
);

create index if not exists idx_keyword_target_metrics_cache_page_url
  on public.keyword_target_metrics_cache (page_url);

create index if not exists idx_keyword_target_metrics_cache_fetched_at
  on public.keyword_target_metrics_cache (fetched_at desc);

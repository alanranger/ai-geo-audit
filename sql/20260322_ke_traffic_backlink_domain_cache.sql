-- Keywords Everywhere: URL traffic + keyword traffic/SERP + page backlink sample + domain cache (Moz DA / referring domains sample).
-- Apply in Supabase SQL editor (project: AI GEO Audit / igzvwbvgvmzvvzoclufx).

alter table public.keyword_target_metrics_cache
  add column if not exists estimated_traffic integer,
  add column if not exists url_estimated_traffic integer,
  add column if not exists page_backlinks_sample integer;

create table if not exists public.ke_domain_metrics_cache (
  domain_host text primary key,
  moz_domain_authority integer,
  referring_domains_sample integer,
  raw_payload jsonb,
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ke_domain_metrics_cache_fetched_at
  on public.ke_domain_metrics_cache (fetched_at desc);

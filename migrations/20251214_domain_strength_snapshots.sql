-- Add table: domain_strength_snapshots
-- Purpose: Store monthly Domain Strength snapshots (DataForSEO Labs domain_rank_overview)

create table if not exists public.domain_strength_snapshots (
  id uuid primary key default gen_random_uuid(),
  domain text not null,
  engine text not null default 'google',
  snapshot_date date not null,
  score numeric(5,2) not null,
  band text not null,
  vis_component numeric(5,4) not null,
  breadth_component numeric(5,4) not null,
  quality_component numeric(5,4) not null,
  organic_etv_raw bigint,
  organic_keywords_total_raw bigint,
  top3_keywords_raw bigint,
  top10_keywords_raw bigint,
  created_at timestamptz not null default now()
);

create index if not exists idx_domain_strength_domain_date
  on public.domain_strength_snapshots (domain, snapshot_date);

create index if not exists idx_domain_strength_snapshot_date
  on public.domain_strength_snapshots (snapshot_date);



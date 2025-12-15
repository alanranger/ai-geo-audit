-- Domain Strength v1.4a: Pending queue and domain mapping tables
-- Purpose: Track domains that need snapshots and provide label/segment mapping

-- 1) domain_rank_pending: Track domains that appear in citations/competitors but don't yet have a snapshot
create table if not exists public.domain_rank_pending (
  domain text primary key,
  search_engine text not null default 'google',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  seen_count int not null default 1,
  source text null
);

create index if not exists idx_domain_rank_pending_engine_last_seen
  on public.domain_rank_pending (search_engine, last_seen_at desc);

-- 2) domain_strength_domains: Mapping table for domain_type and (optionally) a nicer label
create table if not exists public.domain_strength_domains (
  domain text primary key,
  label text null,
  domain_type text null, -- Changed from segment to domain_type, nullable (null = unmapped)
  segment text null, -- Keep for backward compatibility, but prefer domain_type
  notes text null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_domain_strength_domains_domain_type
  on public.domain_strength_domains (domain_type);

create index if not exists idx_domain_strength_domains_segment
  on public.domain_strength_domains (segment);

-- RPC function to increment seen_count for pending domains
create or replace function public.domain_rank_pending_bump(domains text[], engine text)
returns void
language plpgsql
as $$
begin
  update public.domain_rank_pending
  set
    seen_count = seen_count + 1,
    last_seen_at = now()
  where domain = any(domains) and search_engine = engine;
end;
$$;


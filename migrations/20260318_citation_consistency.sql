-- Citation consistency monitor (core directories + NAP drift)
-- Polling cadence: daily (job_key = 'citation_consistency')

create extension if not exists pgcrypto;

create table if not exists public.citation_consistency_runs (
  id uuid primary key default gen_random_uuid(),
  run_started_at timestamptz not null default now(),
  run_completed_at timestamptz not null default now(),
  status text not null default 'ok',
  polling_frequency text not null default 'daily',
  directories_checked integer not null default 0,
  entries_checked integer not null default 0,
  drift_count integer not null default 0,
  alerts_count integer not null default 0,
  average_score integer not null default 0,
  canonical_nap jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_citation_consistency_runs_started_at
  on public.citation_consistency_runs (run_started_at desc);

create table if not exists public.citation_consistency_entries (
  id uuid primary key default gen_random_uuid(),
  directory_domain text not null,
  source_url text not null,
  title text null,
  snippet text null,
  status text not null default 'watch',
  consistency_score integer not null default 0,
  matched_signals jsonb not null default '[]'::jsonb,
  missing_signals jsonb not null default '[]'::jsonb,
  alert_level text not null default 'watch',
  fetch_error text null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_seen_run_id uuid null references public.citation_consistency_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_citation_domain_url unique(directory_domain, source_url)
);

create index if not exists idx_citation_consistency_entries_last_seen
  on public.citation_consistency_entries (last_seen_at desc);

create index if not exists idx_citation_consistency_entries_alert
  on public.citation_consistency_entries (alert_level);

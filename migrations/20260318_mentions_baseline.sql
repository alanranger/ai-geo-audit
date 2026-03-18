-- Mentions ingestion baseline (Reddit / LinkedIn / YouTube)
-- Polling cadence: daily (managed via audit_cron_schedule job_key = 'mentions_baseline')

create extension if not exists pgcrypto;

create table if not exists public.mentions_baseline_runs (
  id uuid primary key default gen_random_uuid(),
  run_started_at timestamptz not null default now(),
  run_completed_at timestamptz not null default now(),
  status text not null default 'ok',
  polling_frequency text not null default 'daily',
  keywords_total integer not null default 0,
  keywords_used integer not null default 0,
  mentions_found integer not null default 0,
  new_mentions integer not null default 0,
  alerts_count integer not null default 0,
  platform_breakdown jsonb not null default '{}'::jsonb,
  keyword_source text null,
  error_message text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_mentions_baseline_runs_started_at
  on public.mentions_baseline_runs (run_started_at desc);

create table if not exists public.mentions_baseline_entries (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  source_domain text null,
  source_url text not null,
  title text null,
  snippet text null,
  published_at timestamptz null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_seen_run_id uuid null references public.mentions_baseline_runs(id) on delete set null,
  mention_score integer not null default 0,
  alert_level text not null default 'low',
  is_brand_mention boolean not null default false,
  matched_keywords text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_mentions_platform_source unique(platform, source_url)
);

create index if not exists idx_mentions_baseline_entries_last_seen
  on public.mentions_baseline_entries (last_seen_at desc);

create index if not exists idx_mentions_baseline_entries_alert_level
  on public.mentions_baseline_entries (alert_level);

create index if not exists idx_mentions_baseline_entries_platform
  on public.mentions_baseline_entries (platform);

create index if not exists idx_mentions_baseline_entries_score
  on public.mentions_baseline_entries (mention_score desc);

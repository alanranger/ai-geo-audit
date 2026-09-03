-- Monday CEO weekly report support tables
create table if not exists public.ceo_weekly_refresh_runs (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  steps jsonb not null default '[]'::jsonb,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists idx_ceo_weekly_refresh_week on public.ceo_weekly_refresh_runs (week_start desc);
create index if not exists idx_ceo_weekly_refresh_status on public.ceo_weekly_refresh_runs (status, finished_at desc);

create table if not exists public.ceo_weekly_report_snapshots (
  id uuid primary key default gen_random_uuid(),
  week_start date not null unique,
  property_url text not null,
  metrics jsonb not null,
  html_preview text,
  refresh_run_id uuid references public.ceo_weekly_refresh_runs(id) on delete set null,
  send_status text not null default 'built',
  send_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_ceo_weekly_snapshots_week on public.ceo_weekly_report_snapshots (week_start desc);

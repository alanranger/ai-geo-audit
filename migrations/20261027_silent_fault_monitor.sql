-- Silent fault monitor (approved 2026-10-27).
-- Server-side only: RLS on, no policies, so the publishable key can read/write none of it.

create extension if not exists pgcrypto;

create table if not exists public.fault_monitor_runs (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  source text not null default 'manual',
  status text not null default 'running',
  rotation_slot integer,
  plan jsonb not null default '[]'::jsonb,
  cursor integer not null default 0,
  retry jsonb not null default '[]'::jsonb,
  not_checked jsonb not null default '[]'::jsonb,
  site_errors jsonb not null default '{}'::jsonb,
  pages_planned integer not null default 0,
  pages_checked integer not null default 0,
  pages_not_checked integer not null default 0,
  site_checks_done boolean not null default false,
  started_at timestamptz not null default now(),
  last_tick_at timestamptz,
  finished_at timestamptz,
  error text
);
create index if not exists idx_fault_monitor_runs_started on public.fault_monitor_runs (started_at desc);

create table if not exists public.fault_monitor_findings (
  fault_key text primary key,
  check_id text not null,
  area text not null,
  url text,
  page_type text,
  severity text not null,
  title text not null,
  detail jsonb not null default '{}'::jsonb,
  fix_hint text,
  status text not null default 'open',
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  last_checked timestamptz not null default now(),
  resolved_at timestamptz,
  run_id uuid
);
create index if not exists idx_fault_monitor_findings_open on public.fault_monitor_findings (status, severity);

create table if not exists public.fault_monitor_page_baseline (
  url_key text primary key,
  url text not null,
  blocks jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.tool_run_reports (
  id uuid primary key default gen_random_uuid(),
  tool text not null,
  flow text,
  run_id text,
  run_at timestamptz not null default now(),
  started_at timestamptz,
  version text,
  state text,
  items_processed integer not null default 0,
  failed jsonb not null default '[]'::jsonb,
  not_published jsonb not null default '[]'::jsonb,
  supabase_errors integer not null default 0,
  errors integer not null default 0,
  summary jsonb not null default '{}'::jsonb
);
create index if not exists idx_tool_run_reports_tool_run_at on public.tool_run_reports (tool, run_at desc);

alter table public.fault_monitor_runs enable row level security;
alter table public.fault_monitor_findings enable row level security;
alter table public.fault_monitor_page_baseline enable row level security;
alter table public.tool_run_reports enable row level security;

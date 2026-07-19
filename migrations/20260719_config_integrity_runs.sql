-- Config integrity checker runs (Phase 3 GO unification)
-- Persists findings history across dashboard reloads.

create extension if not exists pgcrypto;

create table if not exists public.config_integrity_runs (
  id uuid primary key default gen_random_uuid(),
  property_url text not null default 'https://www.alanranger.com',
  run_at timestamptz not null default now(),
  run_source text not null default 'manual',
  status text not null default 'ok',
  chip_rag text not null default 'green',
  finding_count integer not null default 0,
  structural_count integer not null default 0,
  findings jsonb not null default '[]'::jsonb,
  stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_config_integrity_runs_property_run_at
  on public.config_integrity_runs (property_url, run_at desc);

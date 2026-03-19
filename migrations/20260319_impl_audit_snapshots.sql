-- Cross-device persistence for implementation-tab audit payloads
-- Stores latest payload per property + audit key + mode (sample/full).

create extension if not exists pgcrypto;

create table if not exists public.impl_audit_snapshots (
  id uuid primary key default gen_random_uuid(),
  property_url text not null,
  snapshot_key text not null,
  mode text not null default 'full',
  payload jsonb not null default '{}'::jsonb,
  generated_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_impl_audit_snapshot unique(property_url, snapshot_key, mode)
);

create index if not exists idx_impl_audit_snapshots_lookup
  on public.impl_audit_snapshots (property_url, snapshot_key, mode, updated_at desc);

create index if not exists idx_impl_audit_snapshots_updated
  on public.impl_audit_snapshots (updated_at desc);

-- Saved customer groups (structured query, versioned) + membership checks for "who joined / left since last check".
-- Groups live in marketing_segments (definition.query) so snapshots and list loads use them unchanged; every edit adds
-- a version row; nothing is overwritten. Service-role only (RLS on, no anon / authenticated access).
create table if not exists public.marketing_segment_versions (
  segment_id text not null,
  version integer not null,
  name text not null,
  description text,
  purpose text,
  query jsonb not null,
  english text not null,
  set_by text,
  created_at timestamptz not null default now(),
  primary key (segment_id, version)
);

create table if not exists public.marketing_segment_evaluations (
  eval_id uuid primary key default gen_random_uuid(),
  segment_id text not null,
  version integer not null,
  evaluated_at timestamptz not null default now(),
  person_ids uuid[] not null,
  counts jsonb not null,
  set_by text
);
create index if not exists marketing_segment_evaluations_seg_idx on public.marketing_segment_evaluations (segment_id, evaluated_at desc);

alter table public.marketing_segment_versions enable row level security;
alter table public.marketing_segment_evaluations enable row level security;
revoke all on public.marketing_segment_versions from anon, authenticated;
revoke all on public.marketing_segment_evaluations from anon, authenticated;

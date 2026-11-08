-- Owner / test addresses and manual snapshot exclusions (health badges + owner address question, 8 Nov 2026).
-- marketing_owner_addresses: Alan's own addresses (his business @alanranger.com records are owners already by domain;
-- this adds his personal address(es)). Set / cleared by a typed, logged dashboard action and read into
-- customer_person.facts.owner at rebuild. Owners are counted apart from clients in every count, segment and snapshot;
-- their customer records, orders and consent are never changed.
create table if not exists public.marketing_owner_addresses (
  owner_id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email) and position('@' in email) > 1),
  kind text not null default 'personal' check (kind in ('business', 'personal', 'test')),
  reason text not null check (char_length(reason) >= 10),
  set_by text not null,
  set_at timestamptz not null default now(),
  cleared_at timestamptz,
  cleared_by text,
  clear_reason text
);
create unique index if not exists marketing_owner_addresses_one_active on public.marketing_owner_addresses (email) where cleared_at is null;
alter table public.marketing_owner_addresses enable row level security;
revoke all on public.marketing_owner_addresses from anon, authenticated;

-- marketing_snapshot_exclusions: "don't send this one to X" on an unloaded audience snapshot (typed reason, logged).
-- The member row is kept here (member_row) and taken out of marketing_segment_export_members; restoring puts back only
-- that original row. Nothing here can add anyone: CSV download and list loads re-check consent for every member.
create table if not exists public.marketing_snapshot_exclusions (
  exclusion_id uuid primary key default gen_random_uuid(),
  export_id uuid not null,
  person_id uuid,
  member_row jsonb not null,
  reason text not null check (char_length(reason) >= 10),
  set_by text not null,
  set_at timestamptz not null default now(),
  restored_at timestamptz,
  restored_by text,
  restore_reason text
);
create index if not exists marketing_snapshot_exclusions_export on public.marketing_snapshot_exclusions (export_id);
create unique index if not exists marketing_snapshot_exclusions_one_active on public.marketing_snapshot_exclusions (export_id, person_id) where restored_at is null;
alter table public.marketing_snapshot_exclusions enable row level security;
revoke all on public.marketing_snapshot_exclusions from anon, authenticated;

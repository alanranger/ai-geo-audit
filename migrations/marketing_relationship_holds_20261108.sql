-- Relationship hold (client list health, 8 Nov 2026): Alan's manual flag on a person, with a typed reason. Read into
-- customer_person.facts.relationship_hold at rebuild (and patched on that one person when set / cleared). It protects
-- the person from clean-up and changes the suggested action; it never changes a health tag or consent.
create table if not exists public.marketing_relationship_holds (
  hold_id uuid primary key default gen_random_uuid(),
  person_id uuid not null,
  anchor_key text not null,
  reason text not null check (char_length(reason) >= 10),
  set_by text not null,
  set_at timestamptz not null default now(),
  cleared_at timestamptz,
  cleared_by text,
  clear_reason text
);
create unique index if not exists marketing_relationship_holds_one_active on public.marketing_relationship_holds (person_id) where cleared_at is null;
create index if not exists marketing_relationship_holds_anchor on public.marketing_relationship_holds (anchor_key) where cleared_at is null;
alter table public.marketing_relationship_holds enable row level security;
revoke all on public.marketing_relationship_holds from anon, authenticated;

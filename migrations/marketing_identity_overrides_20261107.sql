-- Reversible identity decisions (Claude C10, 7 Nov 2026). A Booking Sheet name-only record that exactly matches one
-- contact is shown under that contact as probable history; 'separate' keeps it as its own record instead.
create table if not exists public.marketing_identity_overrides (
  name_anchor text primary key,
  action text not null check (action in ('separate')),
  reason text not null,
  set_by text not null,
  set_at timestamptz not null default now()
);
alter table public.marketing_identity_overrides enable row level security;
revoke all on public.marketing_identity_overrides from anon, authenticated;

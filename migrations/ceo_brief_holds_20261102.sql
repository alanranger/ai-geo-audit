-- Monday CEO brief held by the pre-send sense-check (batch 8 task 8). One unreleased hold per week;
-- "send anyway" sets released_at. alert_exported_at: the PC handoff cycle wrote ALERT-ceo-brief-held-LATEST.md.
create table if not exists public.ceo_brief_holds (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  property_url text not null,
  held_at timestamptz not null default now(),
  failures jsonb not null default '[]'::jsonb,
  checks jsonb not null default '[]'::jsonb,
  note_sent_at timestamptz,
  released_at timestamptz,
  released_by text,
  alert_exported_at timestamptz
);
create unique index if not exists ceo_brief_holds_one_open on public.ceo_brief_holds (week_start) where released_at is null;
alter table public.ceo_brief_holds enable row level security;

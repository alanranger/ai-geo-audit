-- Alan-approved per-person frequency exceptions (8 Nov 2026): per campaign and week, never blanket. Read by
-- lib/marketing/frequency.mjs alongside a snapshot's definition_snapshot.frequency_policy (frozen snapshots are never
-- edited). Revoking sets revoked_at; rows are never deleted. history = append-only log [{ action, by, at, note }].
create table if not exists public.marketing_frequency_exceptions (
  exception_id uuid primary key default gen_random_uuid(),
  property_url text not null default 'https://www.alanranger.com',
  week_start date not null,
  window_from date not null,
  window_to date not null,
  campaign_keys text[] not null,
  reason text not null,
  approved_by text not null,
  approved_at timestamptz not null,
  set_by text not null,
  set_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by text,
  revoke_reason text,
  history jsonb not null default '[]'::jsonb,
  check (window_to >= window_from),
  check (cardinality(campaign_keys) between 1 and 20)
);
create index if not exists marketing_frequency_exceptions_window_idx on public.marketing_frequency_exceptions (property_url, window_from, window_to);
alter table public.marketing_frequency_exceptions enable row level security;
comment on table public.marketing_frequency_exceptions is 'Alan-approved exceptions to the 2-emails-per-person-per-7-days rule: the listed campaigns, sending within window_from..window_to, only. Not blanket; revoked_at instead of delete.';

-- Campaign steps: done / skipped / not needed with who + when, and a register of the steps each week was given
-- (8 Nov 2026). Automatic states (email sent, sold out / withdrawn, quarter-action evidence) are derived from evidence on
-- every load and are not stored; these columns hold only what Alan or ChatGPT set by hand.
alter table public.strategy_campaign_ticks
  add column if not exists status text check (status in ('done', 'skipped', 'not_needed')),
  add column if not exists reason text,
  add column if not exists set_by text,
  add column if not exists set_at timestamptz,
  add column if not exists history jsonb not null default '[]'::jsonb;

comment on column public.strategy_campaign_ticks.status is 'Manual step state: done (also is_ticked) / skipped (reason) / not_needed. Null = no manual state.';
comment on column public.strategy_campaign_ticks.history is 'Append-only log of tick / untick / skip / move: [{ action, by, at, reason?, moved_to? }] (last 50).';

-- The steps a week was given, kept after the week ends so late / older-not-done steps don't vanish.
create table if not exists public.strategy_campaign_steps (
  property_url text not null default 'https://www.alanranger.com',
  step_key text not null,
  week_start date not null,
  scheduled_day date not null,
  channel text not null,
  step text not null,
  brief text,
  is_email boolean not null default false,
  plan_id bigint,
  covers text[] not null default '{}',
  featured jsonb not null default '[]'::jsonb,
  lead_names text[] not null default '{}',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (property_url, step_key)
);
create index if not exists strategy_campaign_steps_week_idx on public.strategy_campaign_steps (property_url, week_start);
alter table public.strategy_campaign_steps enable row level security;
comment on table public.strategy_campaign_steps is 'Register of campaign steps as shown during their week (upserted by the strategy summary for the current week only).';

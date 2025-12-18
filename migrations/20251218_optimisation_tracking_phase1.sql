-- =========================================
-- Optimisation Tracking — Phase 1 (Supabase)
-- =========================================

-- 0) Extensions
create extension if not exists pgcrypto;

-- 1) Enums
do $$ begin
  create type public.optim_task_type as enum (
    'on_page',        -- titles, headings, copy, internal links, schema tweaks
    'content',        -- new sections, new page, major rewrite
    'internal_links', -- linking improvements across site
    'links_pr',       -- outreach, digital PR, backlinks
    'technical',      -- speed, indexing, canonicals, redirects, etc.
    'local',          -- GBP/local pack actions
    'other'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.optim_task_status as enum (
    'planned',      -- created but not started
    'in_progress',  -- actively working
    'monitoring',   -- changes deployed, watching impact
    'done',         -- completed and no longer monitoring
    'paused',       -- intentionally paused
    'cancelled'     -- abandoned / no longer relevant
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.optim_event_type as enum (
    'created',
    'note',
    'change_deployed',   -- a concrete optimisation change was made (cycle marker)
    'measurement',       -- recorded snapshot / observation
    'status_changed'
  );
exception when duplicate_object then null;
end $$;

-- 2) Helper functions (DB-side normalisation, lightweight)
-- NOTE: app should still do canonical cleaning; this is a safety net.
create or replace function public.arp_clean_url(input_url text)
returns text
language sql
immutable
as $$
  select
    case
      when input_url is null or btrim(input_url) = '' then null
      else
        -- remove querystring and fragment, trim trailing slash
        regexp_replace(
          regexp_replace(split_part(split_part(input_url, '#', 1), '?', 1), '/+$', ''),
          '^https?://', ''
        )
    end
$$;

create or replace function public.arp_keyword_key(input_keyword text)
returns text
language sql
immutable
as $$
  select
    case
      when input_keyword is null or btrim(input_keyword) = '' then null
      else lower(regexp_replace(btrim(input_keyword), '\s+', ' ', 'g'))
    end
$$;

-- 3) Core table: optimisation_tasks
create table if not exists public.optimisation_tasks (
  id uuid primary key default gen_random_uuid(),

  -- Ownership / multi-user safety
  owner_user_id uuid not null default auth.uid(),

  -- Canonical identifiers (app supplies; DB also normalises)
  keyword_text text not null,
  keyword_key text generated always as (public.arp_keyword_key(keyword_text)) stored,

  target_url text not null,
  target_url_clean text generated always as (public.arp_clean_url(target_url)) stored,

  -- Optional: store chosen canonical "rank URL" separately if you want later
  -- classic_ranking_url text null,

  task_type public.optim_task_type not null default 'on_page',
  status public.optim_task_status not null default 'planned',

  -- Freeform planning
  title text null,              -- short label (e.g. "Rewrite title/H1 + FAQ schema")
  hypothesis text null,         -- why we think this will help
  notes text null,

  -- Tracking / workflow
  cycle_active int not null default 1,       -- current optimisation cycle number (1..n)
  next_review_date date null,                -- optional reminder
  monitoring_window_days int null,           -- optional (e.g. 30/60/90)
  started_at timestamptz null,
  completed_at timestamptz null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Update timestamp trigger
create or replace function public.arp_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_optimisation_tasks_updated_at on public.optimisation_tasks;
create trigger trg_optimisation_tasks_updated_at
before update on public.optimisation_tasks
for each row execute function public.arp_set_updated_at();

-- 4) Task events table: optimisation_task_events
create table if not exists public.optimisation_task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.optimisation_tasks(id) on delete cascade,

  owner_user_id uuid not null default auth.uid(),

  event_type public.optim_event_type not null,
  event_at timestamptz not null default now(),

  -- Optional numeric fields for measurements (keep flexible)
  gsc_clicks int null,
  gsc_impressions int null,
  gsc_ctr numeric null,
  gsc_avg_position numeric null,

  note text null,

  created_at timestamptz not null default now()
);

-- 5) Indexes
create index if not exists idx_opt_tasks_owner on public.optimisation_tasks(owner_user_id);
create index if not exists idx_opt_tasks_keyword on public.optimisation_tasks(keyword_key);
create index if not exists idx_opt_tasks_url_clean on public.optimisation_tasks(target_url_clean);
create index if not exists idx_opt_tasks_status on public.optimisation_tasks(status);
create index if not exists idx_opt_events_task on public.optimisation_task_events(task_id);
create index if not exists idx_opt_events_owner on public.optimisation_task_events(owner_user_id);
create index if not exists idx_opt_events_type on public.optimisation_task_events(event_type);

-- 6) Prevent duplicate *open* tasks for same keyword/url/type per user
-- Open = not (done/cancelled). Allow multiple historical done tasks, but only one active.
create unique index if not exists uq_opt_open_task_per_key
on public.optimisation_tasks(owner_user_id, keyword_key, target_url_clean, task_type)
where status not in ('done', 'cancelled');

-- 7) A status view for the Ranking & AI table to join against
-- Returns one "best" row per (owner, keyword_key, target_url_clean, task_type),
-- preferring an open task over a closed one.
create or replace view public.vw_optimisation_task_status as
with base as (
  select
    t.*,
    (t.status not in ('done','cancelled')) as is_open
  from public.optimisation_tasks t
),
events_agg as (
  select
    e.task_id,
    max(e.event_at) as last_event_at,
    count(*) filter (where e.event_type = 'change_deployed') as deployed_changes_count
  from public.optimisation_task_events e
  group by e.task_id
),
ranked as (
  select
    b.id,
    b.owner_user_id,
    b.keyword_text,
    b.keyword_key,
    b.target_url,
    b.target_url_clean,
    b.task_type,
    b.status,
    b.cycle_active,
    b.next_review_date,
    b.monitoring_window_days,
    b.started_at,
    b.completed_at,
    b.created_at,
    b.updated_at,
    coalesce(a.last_event_at, b.updated_at) as last_activity_at,
    coalesce(a.deployed_changes_count, 0) as deployed_changes_count,
    row_number() over (
      partition by b.owner_user_id, b.keyword_key, b.target_url_clean, b.task_type
      order by b.is_open desc, b.updated_at desc
    ) as rn
  from base b
  left join events_agg a on a.task_id = b.id
)
select *
from ranked
where rn = 1;

-- 8) RLS (assumes app uses Supabase Auth)
alter table public.optimisation_tasks enable row level security;
alter table public.optimisation_task_events enable row level security;

-- Allow users to manage only their own rows
drop policy if exists "opt_tasks_select_own" on public.optimisation_tasks;
create policy "opt_tasks_select_own"
on public.optimisation_tasks
for select
using (owner_user_id = auth.uid());

drop policy if exists "opt_tasks_insert_own" on public.optimisation_tasks;
create policy "opt_tasks_insert_own"
on public.optimisation_tasks
for insert
with check (owner_user_id = auth.uid());

drop policy if exists "opt_tasks_update_own" on public.optimisation_tasks;
create policy "opt_tasks_update_own"
on public.optimisation_tasks
for update
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

drop policy if exists "opt_tasks_delete_own" on public.optimisation_tasks;
create policy "opt_tasks_delete_own"
on public.optimisation_tasks
for delete
using (owner_user_id = auth.uid());

drop policy if exists "opt_events_select_own" on public.optimisation_task_events;
create policy "opt_events_select_own"
on public.optimisation_task_events
for select
using (owner_user_id = auth.uid());

drop policy if exists "opt_events_insert_own" on public.optimisation_task_events;
create policy "opt_events_insert_own"
on public.optimisation_task_events
for insert
with check (owner_user_id = auth.uid());

drop policy if exists "opt_events_update_own" on public.optimisation_task_events;
create policy "opt_events_update_own"
on public.optimisation_task_events
for update
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

drop policy if exists "opt_events_delete_own" on public.optimisation_task_events;
create policy "opt_events_delete_own"
on public.optimisation_task_events
for delete
using (owner_user_id = auth.uid());

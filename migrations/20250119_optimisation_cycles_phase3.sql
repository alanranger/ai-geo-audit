-- Migration: Add Objectives + Cycles (Phase 3)
-- Date: 2025-01-19
-- Step 1: Create optimisation_task_cycles table

-- 1A) Create optimisation_task_cycles table
create table if not exists public.optimisation_task_cycles (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.optimisation_tasks(id) on delete cascade,
  cycle_no int not null,
  status public.optim_task_status not null default 'planned',
  objective_title text,
  primary_kpi text,
  target_value numeric,
  target_direction text,
  baseline_value numeric,
  timeframe_days int,
  hypothesis text,
  plan text,
  start_date timestamptz not null default now(),
  end_date timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_opt_task_cycle unique (task_id, cycle_no)
);

-- Indexes for optimisation_task_cycles
create index if not exists idx_opt_task_cycles_task_id on public.optimisation_task_cycles(task_id);
create index if not exists idx_opt_task_cycles_status on public.optimisation_task_cycles(status);

-- 1B) Add active_cycle_id to optimisation_tasks
alter table public.optimisation_tasks
  add column if not exists active_cycle_id uuid references public.optimisation_task_cycles(id) on delete set null;

create index if not exists idx_opt_tasks_active_cycle_id on public.optimisation_tasks(active_cycle_id);

-- 1C) Add cycle_id to optimisation_task_events
alter table public.optimisation_task_events
  add column if not exists cycle_id uuid references public.optimisation_task_cycles(id) on delete set null;

create index if not exists idx_opt_task_events_cycle_id on public.optimisation_task_events(cycle_id);

-- Step 2: Update vw_optimisation_task_status view to include cycle info
drop view if exists public.vw_optimisation_task_status;
create view public.vw_optimisation_task_status as
with base as (
  select
    t.*,
    (t.status not in ('done','cancelled','deleted')) as is_open
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
active_cycle_info as (
  select
    c.task_id,
    c.cycle_no,
    c.status as cycle_status,
    c.objective_title,
    c.primary_kpi,
    c.target_value,
    c.target_direction,
    c.timeframe_days,
    c.plan,
    c.start_date as cycle_start_date
  from public.optimisation_task_cycles c
  inner join public.optimisation_tasks t on t.active_cycle_id = c.id
),
cycle_counts as (
  select
    task_id,
    count(*) as cycle_count
  from public.optimisation_task_cycles
  group by task_id
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
    b.title,
    b.notes,
    b.cycle_active,
    b.active_cycle_id,
    b.next_review_date,
    b.monitoring_window_days,
    b.started_at,
    b.completed_at,
    b.created_at,
    b.updated_at,
    coalesce(a.last_event_at, b.updated_at) as last_activity_at,
    coalesce(a.deployed_changes_count, 0) as deployed_changes_count,
    coalesce(ac.cycle_no, b.cycle_active, 1) as cycle_no,
    coalesce(ac.cycle_status, b.status) as cycle_status,
    coalesce(cc.cycle_count, 0) as cycle_count,
    ac.objective_title,
    ac.primary_kpi,
    ac.target_value,
    ac.target_direction,
    ac.timeframe_days,
    ac.plan,
    ac.cycle_start_date,
    -- baseline = earliest event in current cycle that has metrics (prefer created)
    (
      select e.metrics
      from public.optimisation_task_events e
      where e.task_id = b.id
        and (e.cycle_id = b.active_cycle_id or (e.cycle_id is null and e.cycle_number = coalesce(ac.cycle_no, b.cycle_active, 1)))
        and e.metrics is not null
      order by e.created_at asc
      limit 1
    ) as baseline_metrics,
    -- latest measurement = most recent measurement event in current cycle
    (
      select e.metrics
      from public.optimisation_task_events e
      where e.task_id = b.id
        and (e.cycle_id = b.active_cycle_id or (e.cycle_id is null and e.event_type = 'measurement' and e.cycle_number = coalesce(ac.cycle_no, b.cycle_active, 1)))
        and e.event_type = 'measurement'
        and e.metrics is not null
      order by e.created_at desc
      limit 1
    ) as latest_metrics,
    row_number() over (
      partition by b.owner_user_id, b.keyword_key, b.target_url_clean, b.task_type
      order by b.is_open desc, b.updated_at desc
    ) as rn
  from base b
  left join events_agg a on a.task_id = b.id
  left join active_cycle_info ac on ac.task_id = b.id
  left join cycle_counts cc on cc.task_id = b.id
)
select * from ranked
where rn = 1;


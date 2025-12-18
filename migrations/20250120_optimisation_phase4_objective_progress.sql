-- Migration: Optimisation Tracking Phase 4 - Objective Progress
-- Date: 2025-01-20
-- Adds objective fields to optimisation_tasks and creates progress view

-- Step 1: Add objective fields to optimisation_tasks (only if they don't exist)
-- Note: These fields mirror cycle fields but are stored at task level for convenience
alter table public.optimisation_tasks
  add column if not exists objective_title text,
  add column if not exists objective_kpi text,
  add column if not exists objective_metric text,
  add column if not exists objective_direction text,
  add column if not exists objective_target_value numeric,
  add column if not exists objective_timeframe_days int,
  add column if not exists objective_plan text,
  add column if not exists cycle_started_at timestamptz;

-- Step 2: Create vw_optimisation_task_progress view
-- This view computes baseline, latest, due_at, days_remaining, and objective_state
drop view if exists public.vw_optimisation_task_progress;
create view public.vw_optimisation_task_progress as
with task_cycles as (
  select
    t.id as task_id,
    t.objective_title,
    t.objective_kpi,
    t.objective_metric,
    t.objective_direction,
    t.objective_target_value,
    t.objective_timeframe_days,
    t.objective_plan,
    t.cycle_started_at,
    t.active_cycle_id,
    c.cycle_no,
    c.start_date as cycle_start_date
  from public.optimisation_tasks t
  left join public.optimisation_task_cycles c on c.id = t.active_cycle_id
),
baseline_snapshots as (
  select
    e.task_id,
    e.cycle_id,
    e.cycle_number,
    e.metrics,
    e.created_at,
    row_number() over (
      partition by e.task_id, coalesce(e.cycle_id::text, e.cycle_number::text)
      order by e.created_at asc
    ) as rn
  from public.optimisation_task_events e
  where e.metrics is not null
),
latest_measurements as (
  select
    e.task_id,
    e.cycle_id,
    e.cycle_number,
    e.metrics,
    e.created_at,
    row_number() over (
      partition by e.task_id, coalesce(e.cycle_id::text, e.cycle_number::text)
      order by e.created_at desc
    ) as rn
  from public.optimisation_task_events e
  where e.event_type = 'measurement' and e.metrics is not null
),
baseline_latest as (
  select
    tc.task_id,
    tc.objective_title,
    tc.objective_kpi,
    tc.objective_metric,
    tc.objective_direction,
    tc.objective_target_value,
    tc.objective_timeframe_days,
    tc.objective_plan,
    coalesce(tc.cycle_started_at, tc.cycle_start_date, now()) as cycle_started_at,
    tc.active_cycle_id,
    tc.cycle_no,
    -- Get baseline (first metrics snapshot for current cycle)
    (
      select bs.metrics
      from baseline_snapshots bs
      where bs.task_id = tc.task_id
        and (
          (tc.active_cycle_id is not null and bs.cycle_id = tc.active_cycle_id)
          or (tc.active_cycle_id is null and bs.cycle_number = coalesce(tc.cycle_no, 1))
        )
        and bs.rn = 1
      limit 1
    ) as baseline_metrics,
    -- Get latest measurement (most recent measurement for current cycle)
    (
      select lm.metrics
      from latest_measurements lm
      where lm.task_id = tc.task_id
        and (
          (tc.active_cycle_id is not null and lm.cycle_id = tc.active_cycle_id)
          or (tc.active_cycle_id is null and lm.cycle_number = coalesce(tc.cycle_no, 1))
        )
        and lm.rn = 1
      limit 1
    ) as latest_metrics
  from task_cycles tc
),
computed_progress as (
  select
    bl.*,
    -- Compute due_at = cycle_started_at + objective_timeframe_days
    case
      when bl.cycle_started_at is not null and bl.objective_timeframe_days is not null
      then bl.cycle_started_at + (bl.objective_timeframe_days || ' days')::interval
      else null
    end as due_at,
    -- Compute days_remaining
    case
      when bl.cycle_started_at is not null and bl.objective_timeframe_days is not null
      then extract(day from (bl.cycle_started_at + (bl.objective_timeframe_days || ' days')::interval - now()))
      else null
    end as days_remaining,
    -- Extract metric values from JSONB
    case
      when bl.objective_metric = 'ai_citations' then (bl.baseline_metrics->>'ai_citations')::int
      when bl.objective_metric = 'ai_overview' then case when (bl.baseline_metrics->>'ai_overview')::boolean then 1 else 0 end
      when bl.objective_metric = 'ctr_28d' then (bl.baseline_metrics->>'ctr_28d')::numeric
      when bl.objective_metric = 'impressions_28d' then (bl.baseline_metrics->>'impressions_28d')::int
      when bl.objective_metric = 'clicks_28d' then (bl.baseline_metrics->>'clicks_28d')::int
      when bl.objective_metric = 'rank' then (bl.baseline_metrics->>'rank')::int
      when bl.objective_metric = 'opportunity_score' then (bl.baseline_metrics->>'opportunity_score')::int
      else null
    end as baseline_value,
    case
      when bl.objective_metric = 'ai_citations' then (bl.latest_metrics->>'ai_citations')::int
      when bl.objective_metric = 'ai_overview' then case when (bl.latest_metrics->>'ai_overview')::boolean then 1 else 0 end
      when bl.objective_metric = 'ctr_28d' then (bl.latest_metrics->>'ctr_28d')::numeric
      when bl.objective_metric = 'impressions_28d' then (bl.latest_metrics->>'impressions_28d')::int
      when bl.objective_metric = 'clicks_28d' then (bl.latest_metrics->>'clicks_28d')::int
      when bl.objective_metric = 'rank' then (bl.latest_metrics->>'rank')::int
      when bl.objective_metric = 'opportunity_score' then (bl.latest_metrics->>'opportunity_score')::int
      else null
    end as latest_value
  from baseline_latest bl
)
select
  cp.task_id,
  cp.objective_title,
  cp.objective_kpi,
  cp.objective_metric,
  cp.objective_direction,
  cp.objective_target_value,
  cp.objective_timeframe_days,
  cp.objective_plan,
  cp.cycle_started_at,
  cp.active_cycle_id,
  cp.cycle_no,
  cp.baseline_metrics,
  cp.latest_metrics,
  cp.baseline_value,
  cp.latest_value,
  cp.due_at,
  cp.days_remaining,
  -- Compute objective_state
  case
    -- not_set: no objective fields set
    when cp.objective_metric is null or cp.objective_metric = '' then 'not_set'
    -- no_measurement: baseline exists but latest missing (or latest == baseline and only one measurement)
    when cp.baseline_metrics is not null and (cp.latest_metrics is null or cp.latest_metrics = cp.baseline_metrics) then 'no_measurement'
    -- overdue: now > due_at AND not achieved
    when cp.due_at is not null and now() > cp.due_at and not (
      case
        -- Check if achieved based on direction
        when cp.objective_direction in ('increase', 'at_least') then
          (cp.latest_value is not null and cp.baseline_value is not null and cp.latest_value >= cp.baseline_value + coalesce(cp.objective_target_value, 0))
          or (cp.latest_value is not null and cp.baseline_value is null and cp.latest_value >= coalesce(cp.objective_target_value, 0))
        when cp.objective_direction in ('decrease', 'at_most') then
          -- For rank, decrease means lower number is better
          (cp.objective_metric = 'rank' and cp.latest_value is not null and cp.baseline_value is not null and cp.latest_value <= cp.baseline_value - coalesce(cp.objective_target_value, 0))
          or (cp.objective_metric != 'rank' and cp.latest_value is not null and cp.baseline_value is not null and cp.latest_value <= cp.baseline_value - coalesce(cp.objective_target_value, 0))
          or (cp.latest_value is not null and cp.baseline_value is null and cp.latest_value <= coalesce(cp.objective_target_value, 0))
        else false
      end
    ) then 'overdue'
    -- achieved: objective condition met (only if latest_value is different from baseline)
    when cp.latest_metrics is not null and cp.latest_metrics != cp.baseline_metrics and (
      case
        when cp.objective_direction in ('increase', 'at_least') then
          (cp.latest_value is not null and cp.baseline_value is not null and cp.latest_value >= cp.baseline_value + coalesce(cp.objective_target_value, 0))
          or (cp.latest_value is not null and cp.baseline_value is null and cp.latest_value >= coalesce(cp.objective_target_value, 0))
        when cp.objective_direction in ('decrease', 'at_most') then
          -- For rank, decrease means lower number is better
          (cp.objective_metric = 'rank' and cp.latest_value is not null and cp.baseline_value is not null and cp.latest_value <= cp.baseline_value - coalesce(cp.objective_target_value, 0))
          or (cp.objective_metric != 'rank' and cp.latest_value is not null and cp.baseline_value is not null and cp.latest_value <= cp.baseline_value - coalesce(cp.objective_target_value, 0))
          or (cp.latest_value is not null and cp.baseline_value is null and cp.latest_value <= coalesce(cp.objective_target_value, 0))
        else false
      end
    ) then 'achieved'
    -- on_track: not achieved and not overdue and some improvement in correct direction
    when (
      case
        when cp.objective_direction in ('increase', 'at_least') then
          cp.latest_value is not null and cp.baseline_value is not null and cp.latest_value > cp.baseline_value
        when cp.objective_direction in ('decrease', 'at_most') then
          -- For rank, decrease means lower number is better
          (cp.objective_metric = 'rank' and cp.latest_value is not null and cp.baseline_value is not null and cp.latest_value < cp.baseline_value)
          or (cp.objective_metric != 'rank' and cp.latest_value is not null and cp.baseline_value is not null and cp.latest_value < cp.baseline_value)
        else false
      end
    ) then 'on_track'
    -- at_risk: not achieved and not overdue and no improvement / wrong direction
    else 'at_risk'
  end as objective_state
from computed_progress cp;


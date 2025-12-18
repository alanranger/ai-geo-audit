-- Migration: Optimisation Tracking Phase B - Goal Tracking + Rollups
-- Date: 2025-01-20
-- Adds Phase B objective fields and creates goal status view

-- Step 1: Add Phase B objective fields (complement Phase 4 fields)
alter table public.optimisation_tasks
  add column if not exists objective_target_delta numeric, -- e.g. +1 citation, +0.5% CTR, -2 rank
  add column if not exists objective_due_at timestamptz;

-- Step 2: Create index for due date queries
create index if not exists idx_optim_tasks_due
  on public.optimisation_tasks (objective_due_at)
  where objective_due_at is not null;

-- Step 3: Create goal status view (adapts to our schema: metrics JSONB, cycle_number)
create or replace view public.vw_optimisation_task_goal_status as
with measurement_events as (
  select
    e.task_id,
    e.cycle_number,
    e.cycle_id,
    e.created_at,
    e.metrics
  from public.optimisation_task_events e
  where e.event_type = 'measurement' and e.metrics is not null
),
baseline as (
  select distinct on (task_id, coalesce(cycle_id::text, cycle_number::text))
    task_id,
    cycle_id,
    cycle_number,
    created_at as baseline_at,
    metrics as baseline_metrics
  from measurement_events
  order by task_id, coalesce(cycle_id::text, cycle_number::text), created_at asc
),
latest as (
  select distinct on (task_id, coalesce(cycle_id::text, cycle_number::text))
    task_id,
    cycle_id,
    cycle_number,
    created_at as latest_at,
    metrics as latest_metrics
  from measurement_events
  order by task_id, coalesce(cycle_id::text, cycle_number::text), created_at desc
)
select
  t.id as task_id,
  t.keyword_key,
  t.target_url_clean as target_url_key,
  t.status,
  t.task_type,
  t.cycle_active,
  t.updated_at as task_updated_at,

  -- Objective fields (support both Phase 4 and Phase B naming)
  t.objective_title,
  coalesce(t.objective_kpi, t.objective_metric) as objective_kpi,
  coalesce(t.objective_target_delta, t.objective_target_value) as objective_target_delta,
  t.objective_direction,
  coalesce(t.objective_due_at, 
    case 
      when t.cycle_started_at is not null and t.objective_timeframe_days is not null
      then t.cycle_started_at + (t.objective_timeframe_days || ' days')::interval
      else null
    end
  ) as objective_due_at,
  t.objective_plan,

  b.baseline_at,
  l.latest_at,

  -- Extract numeric KPI values from metrics JSONB
  (b.baseline_metrics->>'gsc_clicks_28d')::numeric as baseline_clicks_28d,
  (l.latest_metrics->>'gsc_clicks_28d')::numeric   as latest_clicks_28d,

  (b.baseline_metrics->>'gsc_impressions_28d')::numeric as baseline_impr_28d,
  (l.latest_metrics->>'gsc_impressions_28d')::numeric   as latest_impr_28d,

  (b.baseline_metrics->>'gsc_ctr_28d')::numeric as baseline_ctr_28d,
  (l.latest_metrics->>'gsc_ctr_28d')::numeric   as latest_ctr_28d,

  (b.baseline_metrics->>'current_rank')::numeric as baseline_rank,
  (l.latest_metrics->>'current_rank')::numeric   as latest_rank,

  (b.baseline_metrics->>'opportunity_score')::numeric as baseline_opp,
  (l.latest_metrics->>'opportunity_score')::numeric   as latest_opp,

  (b.baseline_metrics->>'ai_overview')::text as baseline_ai_overview,
  (l.latest_metrics->>'ai_overview')::text   as latest_ai_overview,

  (b.baseline_metrics->>'ai_citations')::numeric as baseline_ai_citations,
  (l.latest_metrics->>'ai_citations')::numeric   as latest_ai_citations,

      -- Computed: delta for the chosen objective KPI
      -- If latest_metrics is null, use baseline_metrics as latest (delta = 0)
      case
        when coalesce(t.objective_kpi, t.objective_metric) is null or coalesce(t.objective_kpi, t.objective_metric) = '' then null
        when coalesce(t.objective_kpi, t.objective_metric) in ('gsc_clicks_28d', 'clicks_28d') then 
          coalesce((l.latest_metrics->>'gsc_clicks_28d')::numeric, (b.baseline_metrics->>'gsc_clicks_28d')::numeric) - 
          coalesce((b.baseline_metrics->>'gsc_clicks_28d')::numeric, 0)
        when coalesce(t.objective_kpi, t.objective_metric) in ('gsc_impressions_28d', 'impressions_28d') then 
          coalesce((l.latest_metrics->>'gsc_impressions_28d')::numeric, (b.baseline_metrics->>'gsc_impressions_28d')::numeric) - 
          coalesce((b.baseline_metrics->>'gsc_impressions_28d')::numeric, 0)
        when coalesce(t.objective_kpi, t.objective_metric) in ('gsc_ctr_28d', 'ctr_28d') then 
          coalesce((l.latest_metrics->>'gsc_ctr_28d')::numeric, (b.baseline_metrics->>'gsc_ctr_28d')::numeric) - 
          coalesce((b.baseline_metrics->>'gsc_ctr_28d')::numeric, 0)
        when coalesce(t.objective_kpi, t.objective_metric) in ('current_rank', 'rank') then 
          coalesce((l.latest_metrics->>'current_rank')::numeric, (b.baseline_metrics->>'current_rank')::numeric) - 
          coalesce((b.baseline_metrics->>'current_rank')::numeric, 0)
        when coalesce(t.objective_kpi, t.objective_metric) in ('opportunity_score', 'opportunity') then 
          coalesce((l.latest_metrics->>'opportunity_score')::numeric, (b.baseline_metrics->>'opportunity_score')::numeric) - 
          coalesce((b.baseline_metrics->>'opportunity_score')::numeric, 0)
        when coalesce(t.objective_kpi, t.objective_metric) in ('ai_citations', 'citations') then 
          coalesce((l.latest_metrics->>'ai_citations')::numeric, (b.baseline_metrics->>'ai_citations')::numeric) - 
          coalesce((b.baseline_metrics->>'ai_citations')::numeric, 0)
        else null
      end as objective_delta,

  -- Computed: goal state
  case
    when coalesce(t.objective_kpi, t.objective_metric) is null or coalesce(t.objective_kpi, t.objective_metric) = '' then 'not_set'
    when b.baseline_metrics is null then 'no_measurement' -- No baseline measurement yet
    when coalesce(t.objective_due_at, 
      case 
        when t.cycle_started_at is not null and t.objective_timeframe_days is not null
        then t.cycle_started_at + (t.objective_timeframe_days || ' days')::interval
        else null
      end
    ) is not null and now() > coalesce(t.objective_due_at, 
      case 
        when t.cycle_started_at is not null and t.objective_timeframe_days is not null
        then t.cycle_started_at + (t.objective_timeframe_days || ' days')::interval
        else null
      end
    ) then
      -- Overdue: check if met
      case
        when coalesce(t.objective_target_delta, t.objective_target_value) is null then 'overdue'
        when t.objective_direction = 'decrease' then
          case 
            when coalesce(t.objective_kpi, t.objective_metric) in ('current_rank', 'rank') then
              case when coalesce(
                coalesce((l.latest_metrics->>'current_rank')::numeric, (b.baseline_metrics->>'current_rank')::numeric) - 
                coalesce((b.baseline_metrics->>'current_rank')::numeric, 0),
                0
              ) <= (coalesce(t.objective_target_delta, t.objective_target_value) * -1) then 'met' else 'overdue' end
            else 'overdue' -- decrease not supported for other metrics yet
          end
        else
          -- increase direction
          case when coalesce(
            case 
              when coalesce(t.objective_kpi, t.objective_metric) in ('ai_citations', 'citations') then 
                coalesce((l.latest_metrics->>'ai_citations')::numeric, (b.baseline_metrics->>'ai_citations')::numeric) - 
                coalesce((b.baseline_metrics->>'ai_citations')::numeric, 0)
              when coalesce(t.objective_kpi, t.objective_metric) in ('gsc_ctr_28d', 'ctr_28d') then 
                coalesce((l.latest_metrics->>'gsc_ctr_28d')::numeric, (b.baseline_metrics->>'gsc_ctr_28d')::numeric) - 
                coalesce((b.baseline_metrics->>'gsc_ctr_28d')::numeric, 0)
              when coalesce(t.objective_kpi, t.objective_metric) in ('gsc_clicks_28d', 'clicks_28d') then 
                coalesce((l.latest_metrics->>'gsc_clicks_28d')::numeric, (b.baseline_metrics->>'gsc_clicks_28d')::numeric) - 
                coalesce((b.baseline_metrics->>'gsc_clicks_28d')::numeric, 0)
              when coalesce(t.objective_kpi, t.objective_metric) in ('gsc_impressions_28d', 'impressions_28d') then 
                coalesce((l.latest_metrics->>'gsc_impressions_28d')::numeric, (b.baseline_metrics->>'gsc_impressions_28d')::numeric) - 
                coalesce((b.baseline_metrics->>'gsc_impressions_28d')::numeric, 0)
              else null
            end,
            0
          ) >= coalesce(t.objective_target_delta, t.objective_target_value) then 'met' else 'overdue' end
      end
    else
      -- Not overdue yet
      case
        when coalesce(t.objective_target_delta, t.objective_target_value) is null then 'on_track'
        when t.objective_direction = 'decrease' then 'on_track' -- UI will rely on delta/target display
        else
          -- increase direction, check if met
          case when coalesce(
            case 
              when coalesce(t.objective_kpi, t.objective_metric) in ('ai_citations', 'citations') then 
                coalesce((l.latest_metrics->>'ai_citations')::numeric, (b.baseline_metrics->>'ai_citations')::numeric) - 
                coalesce((b.baseline_metrics->>'ai_citations')::numeric, 0)
              when coalesce(t.objective_kpi, t.objective_metric) in ('gsc_ctr_28d', 'ctr_28d') then 
                coalesce((l.latest_metrics->>'gsc_ctr_28d')::numeric, (b.baseline_metrics->>'gsc_ctr_28d')::numeric) - 
                coalesce((b.baseline_metrics->>'gsc_ctr_28d')::numeric, 0)
              when coalesce(t.objective_kpi, t.objective_metric) in ('gsc_clicks_28d', 'clicks_28d') then 
                coalesce((l.latest_metrics->>'gsc_clicks_28d')::numeric, (b.baseline_metrics->>'gsc_clicks_28d')::numeric) - 
                coalesce((b.baseline_metrics->>'gsc_clicks_28d')::numeric, 0)
              when coalesce(t.objective_kpi, t.objective_metric) in ('gsc_impressions_28d', 'impressions_28d') then 
                coalesce((l.latest_metrics->>'gsc_impressions_28d')::numeric, (b.baseline_metrics->>'gsc_impressions_28d')::numeric) - 
                coalesce((b.baseline_metrics->>'gsc_impressions_28d')::numeric, 0)
              else null
            end,
            0
          ) >= coalesce(t.objective_target_delta, t.objective_target_value) then 'met' else 'on_track' end
      end
  end as goal_state
from public.optimisation_tasks t
left join baseline b on b.task_id = t.id 
  and (
    (t.active_cycle_id is not null and b.cycle_id = t.active_cycle_id)
    or (t.active_cycle_id is null and b.cycle_number = t.cycle_active)
  )
left join latest l on l.task_id = t.id 
  and (
    (t.active_cycle_id is not null and l.cycle_id = t.active_cycle_id)
    or (t.active_cycle_id is null and l.cycle_number = t.cycle_active)
  );


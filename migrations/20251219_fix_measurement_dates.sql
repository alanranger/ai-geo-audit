-- Migration: Fix measurement dates in view
-- Date: 2025-12-19
-- Updates vw_optimisation_task_status to include actual event timestamps for baseline and latest measurements

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
    -- baseline = earliest event in current cycle that has metrics (include created_at in metrics)
    (
      select 
        case 
          when e.metrics is not null then
            e.metrics || jsonb_build_object('captured_at', e.created_at)
          else null
        end
      from public.optimisation_task_events e
      where e.task_id = b.id
        and (e.cycle_id = b.active_cycle_id or (e.cycle_id is null and e.cycle_number = coalesce(ac.cycle_no, b.cycle_active, 1)))
        and e.metrics is not null
      order by e.created_at asc
      limit 1
    ) as baseline_metrics,
    -- latest measurement = most recent measurement event in current cycle (include created_at in metrics)
    (
      select 
        case 
          when e.metrics is not null then
            e.metrics || jsonb_build_object('captured_at', e.created_at)
          else null
        end
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


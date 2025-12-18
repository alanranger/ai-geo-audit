-- Migration: Add title and notes to vw_optimisation_task_status view
-- Date: 2025-01-19

-- Update the view to include title and notes fields
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
    b.next_review_date,
    b.monitoring_window_days,
    b.started_at,
    b.completed_at,
    b.created_at,
    b.updated_at,
    coalesce(a.last_event_at, b.updated_at) as last_activity_at,
    coalesce(a.deployed_changes_count, 0) as deployed_changes_count,
    -- baseline = earliest event in current cycle that has metrics (prefer created)
    (
      select e.metrics
      from public.optimisation_task_events e
      where e.task_id = b.id
        and e.cycle_number = b.cycle_active
        and e.metrics is not null
      order by e.created_at asc
      limit 1
    ) as baseline_metrics,
    -- latest measurement = most recent measurement event in current cycle
    (
      select e.metrics
      from public.optimisation_task_events e
      where e.task_id = b.id
        and e.cycle_number = b.cycle_active
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
)
select * from ranked
where rn = 1;


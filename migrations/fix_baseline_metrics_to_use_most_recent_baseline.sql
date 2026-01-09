-- Fix the view to use the most recent baseline, not the oldest measurement
-- This ensures that after rebaselining, the view returns the new baseline with all fields
CREATE OR REPLACE VIEW vw_optimisation_task_status AS
WITH base AS (
  SELECT t.id,
    t.owner_user_id,
    t.keyword_text,
    t.keyword_key,
    t.target_url,
    t.target_url_clean,
    t.task_type,
    t.status,
    t.title,
    t.hypothesis,
    t.notes,
    t.cycle_active,
    t.next_review_date,
    t.monitoring_window_days,
    t.started_at,
    t.completed_at,
    t.created_at,
    t.updated_at,
    t.active_cycle_id,
    t.objective_title,
    t.objective_kpi,
    t.objective_metric,
    t.objective_direction,
    t.objective_target_value,
    t.objective_timeframe_days,
    t.objective_plan,
    t.cycle_started_at,
    t.objective_target_delta,
    t.objective_due_at,
    t.status <> ALL (ARRAY['done'::optim_task_status, 'cancelled'::optim_task_status, 'deleted'::optim_task_status]) AS is_open
  FROM optimisation_tasks t
), events_agg AS (
  SELECT e.task_id,
    max(e.event_at) AS last_event_at,
    count(*) FILTER (WHERE e.event_type = 'change_deployed'::optim_event_type) AS deployed_changes_count
  FROM optimisation_task_events e
  GROUP BY e.task_id
), active_cycle_info AS (
  SELECT c.task_id,
    c.cycle_no,
    c.status AS cycle_status,
    c.objective_title,
    c.primary_kpi,
    c.target_value,
    c.target_direction,
    c.timeframe_days,
    c.plan,
    c.start_date AS cycle_start_date,
    c.objective,
    c.objective_status,
    c.objective_progress,
    c.due_at
  FROM optimisation_task_cycles c
    JOIN optimisation_tasks t ON t.active_cycle_id = c.id
), cycle_counts AS (
  SELECT optimisation_task_cycles.task_id,
    count(*) AS cycle_count
  FROM optimisation_task_cycles
  GROUP BY optimisation_task_cycles.task_id
), ranked AS (
  SELECT b.id,
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
    COALESCE(a.last_event_at, b.updated_at) AS last_activity_at,
    COALESCE(a.deployed_changes_count, 0::bigint) AS deployed_changes_count,
    COALESCE(ac.cycle_no, b.cycle_active, 1) AS cycle_no,
    COALESCE(ac.cycle_status, b.status) AS cycle_status,
    COALESCE(cc.cycle_count, 0::bigint) AS cycle_count,
    ac.objective_title,
    ac.primary_kpi,
    ac.target_value,
    ac.target_direction,
    ac.timeframe_days,
    ac.plan,
    ac.cycle_start_date,
    ac.objective,
    ac.objective_status,
    ac.objective_progress,
    ac.due_at AS cycle_due_at,
    -- FIXED: Use most recent baseline (is_baseline = true), fallback to first measurement
    ( SELECT
        CASE
          WHEN e.metrics IS NOT NULL THEN e.metrics || jsonb_build_object('captured_at', e.created_at)
          ELSE NULL::jsonb
        END AS "case"
      FROM optimisation_task_events e
      WHERE e.task_id = b.id 
        AND (e.cycle_id = b.active_cycle_id OR (e.cycle_id IS NULL AND e.cycle_number = COALESCE(ac.cycle_no, b.cycle_active, 1)))
        AND e.event_type = 'measurement'::optim_event_type
        AND e.metrics IS NOT NULL
        AND (
          -- Prefer most recent baseline
          (e.is_baseline = true)
          OR
          -- Fallback to first measurement if no baseline exists
          (NOT EXISTS (
            SELECT 1 FROM optimisation_task_events e2
            WHERE e2.task_id = b.id
              AND (e2.cycle_id = b.active_cycle_id OR (e2.cycle_id IS NULL AND e2.cycle_number = COALESCE(ac.cycle_no, b.cycle_active, 1)))
              AND e2.event_type = 'measurement'::optim_event_type
              AND e2.is_baseline = true
              AND e2.metrics IS NOT NULL
          ))
        )
      ORDER BY 
        -- Most recent baseline first, then oldest measurement if no baseline
        CASE WHEN e.is_baseline = true THEN 0 ELSE 1 END,
        CASE WHEN e.is_baseline = true THEN e.created_at END DESC NULLS LAST,
        e.created_at ASC
      LIMIT 1
    ) AS baseline_metrics,
    ( SELECT
        CASE
          WHEN e.metrics IS NOT NULL THEN e.metrics || jsonb_build_object('captured_at', e.created_at)
          ELSE NULL::jsonb
        END AS "case"
      FROM optimisation_task_events e
      WHERE e.task_id = b.id 
        AND (e.cycle_id = b.active_cycle_id OR (e.cycle_id IS NULL AND e.event_type = 'measurement'::optim_event_type AND e.cycle_number = COALESCE(ac.cycle_no, b.cycle_active, 1)))
        AND e.event_type = 'measurement'::optim_event_type
        AND e.metrics IS NOT NULL
      ORDER BY e.created_at DESC
      LIMIT 1
    ) AS latest_metrics,
    row_number() OVER (PARTITION BY b.owner_user_id, b.keyword_key, b.target_url_clean, b.task_type ORDER BY b.is_open DESC, b.updated_at DESC) AS rn
  FROM base b
    LEFT JOIN events_agg a ON a.task_id = b.id
    LEFT JOIN active_cycle_info ac ON ac.task_id = b.id
    LEFT JOIN cycle_counts cc ON cc.task_id = b.id
)
SELECT id,
  owner_user_id,
  keyword_text,
  keyword_key,
  target_url,
  target_url_clean,
  task_type,
  status,
  title,
  notes,
  cycle_active,
  active_cycle_id,
  next_review_date,
  monitoring_window_days,
  started_at,
  completed_at,
  created_at,
  updated_at,
  last_activity_at,
  deployed_changes_count,
  cycle_no,
  cycle_status,
  cycle_count,
  objective_title,
  primary_kpi,
  target_value,
  target_direction,
  timeframe_days,
  plan,
  cycle_start_date,
  objective,
  objective_status,
  objective_progress,
  cycle_due_at,
  baseline_metrics,
  latest_metrics,
  rn
FROM ranked
WHERE rn = 1;

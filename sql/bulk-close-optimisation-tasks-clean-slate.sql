-- Mark all open optimisation tasks (non-test) as done + close cycles + audit events.
-- Run in Supabase SQL editor (project igzvwbvgvmzvvzoclufx).

WITH to_close AS (
  SELECT id, status AS old_status, active_cycle_id, cycle_active, owner_user_id
  FROM optimisation_tasks
  WHERE status NOT IN ('done', 'cancelled', 'deleted')
    AND COALESCE(is_test_task, false) = false
),
updated_tasks AS (
  UPDATE optimisation_tasks t
  SET status = 'done',
      completed_at = COALESCE(t.completed_at, now()),
      updated_at = now()
  FROM to_close tc
  WHERE t.id = tc.id
  RETURNING t.id, tc.old_status, t.active_cycle_id, t.cycle_active, t.owner_user_id
),
updated_cycles AS (
  UPDATE optimisation_task_cycles c
  SET status = 'done',
      end_date = COALESCE(c.end_date, now()),
      updated_at = now()
  WHERE c.task_id IN (SELECT id FROM to_close)
    AND c.status NOT IN ('done', 'cancelled', 'deleted', 'completed', 'archived')
  RETURNING c.id
),
inserted_events AS (
  INSERT INTO optimisation_task_events (task_id, event_type, note, cycle_id, cycle_number, owner_user_id)
  SELECT id,
    'status_changed',
    'Clean slate (2026-05-21): ' || old_status || ' → done',
    active_cycle_id,
    cycle_active,
    owner_user_id
  FROM updated_tasks
  RETURNING id
)
SELECT
  (SELECT COUNT(*) FROM updated_tasks) AS tasks_closed,
  (SELECT COUNT(*) FROM updated_cycles) AS cycles_closed,
  (SELECT COUNT(*) FROM inserted_events) AS events_logged;

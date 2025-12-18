-- Query to check if measurement events are being saved correctly
-- Run this in Supabase SQL editor to verify measurements are in the database

-- 1. Check recent measurement events
SELECT 
  e.id,
  e.task_id,
  e.event_type,
  e.cycle_id,
  e.cycle_number,
  e.metrics,
  e.created_at,
  t.keyword_text,
  t.target_url
FROM public.optimisation_task_events e
LEFT JOIN public.optimisation_tasks t ON t.id = e.task_id
WHERE e.event_type = 'measurement'
ORDER BY e.created_at DESC
LIMIT 10;

-- 2. Check if latest_metrics is being returned by the view
SELECT 
  id,
  keyword_text,
  target_url,
  cycle_no,
  latest_metrics,
  baseline_metrics,
  active_cycle_id
FROM public.vw_optimisation_task_status
WHERE latest_metrics IS NOT NULL
ORDER BY updated_at DESC
LIMIT 10;

-- 3. Check a specific task's events and cycles
-- Replace 'YOUR_TASK_ID' with an actual task ID
/*
SELECT 
  e.id,
  e.event_type,
  e.cycle_id,
  e.cycle_number,
  e.metrics,
  e.created_at,
  c.cycle_no,
  c.id as cycle_id
FROM public.optimisation_task_events e
LEFT JOIN public.optimisation_task_cycles c ON c.id = e.cycle_id
WHERE e.task_id = 'YOUR_TASK_ID'
ORDER BY e.created_at DESC;
*/


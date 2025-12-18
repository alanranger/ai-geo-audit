-- Verification queries for 'deleted' status migration
-- Run these to confirm the migration was applied correctly

-- 1. Check if 'deleted' exists in the enum
SELECT 
    unnest(enum_range(NULL::public.optim_task_status)) AS enum_value
ORDER BY enum_value;

-- Expected result should include: planned, in_progress, monitoring, done, paused, cancelled, deleted

-- 2. Check the index definition to see if it excludes 'deleted'
SELECT 
    indexname,
    indexdef
FROM pg_indexes
WHERE indexname = 'uq_opt_open_task_per_key'
AND schemaname = 'public';

-- Expected: The WHERE clause should include: status not in ('done', 'cancelled', 'deleted')

-- 3. Check if the view exists and includes 'deleted' in the is_open calculation
SELECT 
    definition
FROM pg_views
WHERE viewname = 'vw_optimisation_task_status'
AND schemaname = 'public';

-- Expected: The definition should include: (t.status not in ('done','cancelled','deleted')) as is_open

-- 4. Test that 'deleted' is treated as a closed status (is_open = false)
-- This query should return no rows if a task with status 'deleted' exists
SELECT 
    id,
    status,
    keyword_text,
    target_url_clean
FROM public.optimisation_tasks
WHERE status = 'deleted'
AND EXISTS (
    SELECT 1 
    FROM public.vw_optimisation_task_status v
    WHERE v.id = optimisation_tasks.id
    AND v.is_open = true
);

-- Expected: Should return 0 rows (deleted tasks should not be considered open)


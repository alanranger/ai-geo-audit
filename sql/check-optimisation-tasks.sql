-- Query to check optimisation tasks and match against screenshot
-- Run this in Supabase SQL Editor or via MCP tool

SELECT 
  keyword_text,
  status,
  cycle_active,
  last_activity_at,
  target_url_clean,
  task_type,
  created_at,
  updated_at
FROM vw_optimisation_task_status
ORDER BY keyword_text;

-- Expected results based on screenshot:
-- 1. "photography courses" - Status: "cancelled", Cycle: 1
-- 2. "photography course near me" - Status: "in_progress", Cycle: 1
-- 3. "photography courses near me" - Status: "monitoring", Cycle: 1
-- 4. "photography lessons near me" - Status: "paused", Cycle: 1
-- 5. "photography classes near me" - Status: "in_progress", Cycle: 1
-- 6. "photography lessons online" - Should NOT have a task (status would be "Not tracked" in UI)
-- 7. "beginners photography class" - Should NOT have a task (status would be "Not tracked" in UI)



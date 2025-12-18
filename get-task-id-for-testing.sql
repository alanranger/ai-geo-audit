-- Get a task ID for testing the drawer
-- Run this in Supabase SQL Editor or via MCP tool

SELECT 
  id,
  keyword_text,
  status,
  target_url_clean,
  task_type
FROM vw_optimisation_task_status
ORDER BY updated_at DESC
LIMIT 5;



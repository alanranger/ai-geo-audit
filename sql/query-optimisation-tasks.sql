-- Query to check optimisation tasks matching the screenshot
SELECT 
  keyword_text,
  status,
  cycle_active,
  last_activity_at::date as last_activity_date,
  target_url_clean,
  task_type,
  created_at::date as created_date
FROM vw_optimisation_task_status
WHERE keyword_text IN (
  'photography courses',
  'photography course near me',
  'photography courses near me',
  'photography lessons near me',
  'photography classes near me',
  'photography lessons online',
  'beginners photography class'
)
ORDER BY keyword_text;



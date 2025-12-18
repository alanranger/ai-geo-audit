-- =========================================
-- Optimisation Tracking Phase 1 — Validation Queries
-- Run these in Supabase SQL Editor after migration
-- =========================================

-- 1) Create a task
insert into public.optimisation_tasks (keyword_text, target_url, task_type, status, title)
values ('photography lessons online', 'https://www.alanranger.com/free-online-photography-course?gclid=123', 'on_page', 'in_progress', 'Meta title + above-the-fold copy');

-- 2) Add events
insert into public.optimisation_task_events (task_id, event_type, note)
select id, 'created', 'Task created'
from public.optimisation_tasks
where keyword_key = public.arp_keyword_key('photography lessons online')
limit 1;

insert into public.optimisation_task_events (task_id, event_type, note)
select id, 'change_deployed', 'Deployed title/meta + FAQ tweaks'
from public.optimisation_tasks
where keyword_key = public.arp_keyword_key('photography lessons online')
limit 1;

-- 3) Confirm cleaned URL and status view output
select
  keyword_text, keyword_key, target_url, target_url_clean, task_type, status, cycle_active
from public.optimisation_tasks
order by created_at desc
limit 5;

select
  keyword_key, target_url_clean, task_type, status, deployed_changes_count, last_activity_at
from public.vw_optimisation_task_status
order by last_activity_at desc
limit 20;

-- 4) Confirm duplicate open-task prevention works
-- (This should FAIL with unique violation if you run it twice for same user+key+url_clean+type)
insert into public.optimisation_tasks (keyword_text, target_url, task_type, status)
values ('photography lessons online', 'https://www.alanranger.com/free-online-photography-course', 'on_page', 'planned');

-- Expected results:
-- - target_url_clean should not contain query parameters
-- - View should return a single row for that keyword/url/type with status in_progress
-- - Duplicate open insert should be blocked

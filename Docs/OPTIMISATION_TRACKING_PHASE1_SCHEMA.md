# Optimisation Tracking — Phase 1 Schema Documentation

## Overview

Phase 1 establishes the database foundation for tracking keyword optimisation tasks and their change cycles. This schema supports:

- Creating optimisation tasks per (keyword + target page + task type)
- Tracking multiple optimisation cycles over time for the same keyword/page
- Exposing a status view for the Ranking & AI module to query

## Tables

### `optimisation_tasks`

Core table storing optimisation work items.

**Key Fields**:
- `id` (uuid) - Primary key
- `owner_user_id` (uuid) - User who owns the task (RLS enforced)
- `keyword_text` (text) - Original keyword text
- `keyword_key` (text, generated) - Normalised keyword (lowercase, trimmed whitespace)
- `target_url` (text) - Original target URL
- `target_url_clean` (text, generated) - Cleaned URL (no query params, no fragment, no protocol)
- `task_type` (enum) - Type of optimisation: `on_page`, `content`, `internal_links`, `links_pr`, `technical`, `local`, `other`
- `status` (enum) - Current status: `planned`, `in_progress`, `monitoring`, `done`, `paused`, `cancelled`
- `cycle_active` (int) - Current optimisation cycle number (starts at 1, increments with each change)
- `title`, `hypothesis`, `notes` - Freeform planning fields
- `next_review_date`, `monitoring_window_days` - Optional workflow tracking
- `started_at`, `completed_at` - Timestamps for lifecycle tracking

**Constraints**:
- Unique partial index prevents duplicate open tasks: one open task per `(owner_user_id, keyword_key, target_url_clean, task_type)` where status is not `done` or `cancelled`
- This allows multiple historical completed tasks, but only one active task per combination

### `optimisation_task_events`

Stores discrete events/actions for each task (change deployments, notes, measurements).

**Key Fields**:
- `id` (uuid) - Primary key
- `task_id` (uuid) - Foreign key to `optimisation_tasks`
- `owner_user_id` (uuid) - User who created the event (RLS enforced)
- `event_type` (enum) - Type: `created`, `note`, `change_deployed`, `measurement`, `status_changed`
- `event_at` (timestamptz) - When the event occurred
- `note` (text) - Freeform note/description
- `gsc_clicks`, `gsc_impressions`, `gsc_ctr`, `gsc_avg_position` - Optional GSC metrics snapshot

**Usage**:
- Each `change_deployed` event represents a new optimisation cycle
- Events are used to compute cycle counts and last activity dates in the status view

## Helper Functions

### `arp_clean_url(input_url text)`

Normalises URLs by:
- Removing query parameters (everything after `?`)
- Removing fragments (everything after `#`)
- Removing protocol (`http://` or `https://`)
- Trimming trailing slashes

**Example**:
```
'https://www.alanranger.com/page?gclid=123#section' 
→ 'www.alanranger.com/page'
```

### `arp_keyword_key(input_keyword text)`

Normalises keywords by:
- Converting to lowercase
- Trimming whitespace
- Collapsing multiple spaces to single space

**Example**:
```
'Photography  Lessons  Online' 
→ 'photography lessons online'
```

## View

### `vw_optimisation_task_status`

Status view for the Ranking & AI module to join against.

**Returns**:
- One row per `(owner_user_id, keyword_key, target_url_clean, task_type)`
- Prefers open tasks over closed ones
- Includes aggregated event data:
  - `last_activity_at` - Most recent event or task update
  - `deployed_changes_count` - Count of `change_deployed` events (cycle count)

**Usage in Ranking & AI**:
```sql
SELECT 
  k.*,
  o.status as optimisation_status,
  o.deployed_changes_count as optimisation_cycles,
  o.last_activity_at
FROM keywords k
LEFT JOIN vw_optimisation_task_status o 
  ON o.keyword_key = arp_keyword_key(k.keyword_text)
  AND o.target_url_clean = arp_clean_url(k.target_url)
```

## Row Level Security (RLS)

Both tables enforce RLS policies:
- Users can only SELECT, INSERT, UPDATE, DELETE their own rows (where `owner_user_id = auth.uid()`)
- Policies are named with `opt_tasks_*` and `opt_events_*` prefixes

## Workflow: Multiple Optimisation Cycles

The schema supports tracking multiple optimisation cycles without creating duplicate tasks:

1. **First cycle**: Create task with `status = 'in_progress'`, `cycle_active = 1`
2. **Deploy change**: Insert event with `event_type = 'change_deployed'`
3. **Monitor**: Update task `status = 'monitoring'`
4. **Second cycle**: Increment `cycle_active = 2`, insert new `change_deployed` event
5. **Complete**: Set `status = 'done'` when finished

The unique partial index ensures only one open task exists, while allowing unlimited historical completed tasks.

## Validation Queries

After running the migration, test with:

```sql
-- Create a task
INSERT INTO public.optimisation_tasks (keyword_text, target_url, task_type, status, title)
VALUES ('photography lessons online', 'https://www.alanranger.com/free-online-photography-course?gclid=123', 'on_page', 'in_progress', 'Meta title + above-the-fold copy');

-- Add events
INSERT INTO public.optimisation_task_events (task_id, event_type, note)
SELECT id, 'created', 'Task created'
FROM public.optimisation_tasks
WHERE keyword_key = public.arp_keyword_key('photography lessons online')
LIMIT 1;

INSERT INTO public.optimisation_task_events (task_id, event_type, note)
SELECT id, 'change_deployed', 'Deployed title/meta + FAQ tweaks'
FROM public.optimisation_tasks
WHERE keyword_key = public.arp_keyword_key('photography lessons online')
LIMIT 1;

-- Verify cleaned URL and status view
SELECT keyword_text, keyword_key, target_url, target_url_clean, task_type, status, cycle_active
FROM public.optimisation_tasks
ORDER BY created_at DESC
LIMIT 5;

SELECT keyword_key, target_url_clean, task_type, status, deployed_changes_count, last_activity_at
FROM public.vw_optimisation_task_status
ORDER BY last_activity_at DESC
LIMIT 20;
```

## Next Steps (Phase 2+)

- UI integration in Ranking & AI module (status column, Add/Open/Log change actions)
- New Optimisation Tracking page for task management
- Performance delta computation and display
- Automated follow-up due calculations

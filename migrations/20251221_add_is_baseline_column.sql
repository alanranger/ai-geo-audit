-- Add is_baseline column to optimisation_task_events table
-- This column marks measurement events as baseline snapshots captured when a task/cycle is created

ALTER TABLE optimisation_task_events
ADD COLUMN IF NOT EXISTS is_baseline BOOLEAN DEFAULT FALSE;

-- Add comment to explain the column
COMMENT ON COLUMN optimisation_task_events.is_baseline IS 'Marks measurement events as baseline snapshots. Baseline measurements are captured when a task is created or a cycle starts, and are used as the reference point for tracking progress.';

-- Create index for faster queries when filtering by baseline
CREATE INDEX IF NOT EXISTS idx_optimisation_task_events_is_baseline 
ON optimisation_task_events(is_baseline) 
WHERE is_baseline = TRUE;


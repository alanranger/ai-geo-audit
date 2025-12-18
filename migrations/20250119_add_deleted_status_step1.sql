-- Migration Step 1: Add 'deleted' status to optim_task_status enum
-- Date: 2025-01-19
-- Run this FIRST, then commit, then run step 2

-- Add 'deleted' value to the enum
alter type public.optim_task_status add value if not exists 'deleted';


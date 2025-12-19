-- Migration: Phase 5 - Objective Integrity + Auto-Status
-- Date: 2025-12-19
-- Adds objective storage, status, and progress to cycles table

-- Step 1: Add objective fields to optimisation_task_cycles
alter table public.optimisation_task_cycles
  add column if not exists objective jsonb,
  add column if not exists objective_status text not null default 'not_set',
  add column if not exists objective_progress jsonb,
  add column if not exists due_at timestamptz,
  add column if not exists objective_updated_at timestamptz;

-- Step 2: Add constraint for objective_status
alter table public.optimisation_task_cycles
  drop constraint if exists chk_opt_cycle_objective_status;

alter table public.optimisation_task_cycles
  add constraint chk_opt_cycle_objective_status
  check (objective_status in ('not_set', 'on_track', 'overdue', 'met'));

-- Step 3: Create indexes
create index if not exists idx_opt_cycles_objective_status 
  on public.optimisation_task_cycles(objective_status);

create index if not exists idx_opt_cycles_due_at 
  on public.optimisation_task_cycles(due_at)
  where due_at is not null;

-- Step 4: Migrate existing objective data from tasks to cycles (if needed)
-- This will populate cycles with objective data from tasks for active cycles
update public.optimisation_task_cycles c
set
  objective = jsonb_build_object(
    'title', t.objective_title,
    'kpi', coalesce(t.objective_kpi, t.objective_metric),
    'target', coalesce(t.objective_target_delta, t.objective_target_value),
    'target_type', case 
      when coalesce(t.objective_kpi, t.objective_metric) in ('ai_overview', 'current_rank') then 'absolute'
      else 'delta'
    end,
    'due_at', coalesce(t.objective_due_at, 
      case 
        when t.cycle_started_at is not null and t.objective_timeframe_days is not null
        then t.cycle_started_at + (t.objective_timeframe_days || ' days')::interval
        else null
      end
    ),
    'plan', t.objective_plan
  ),
  due_at = coalesce(t.objective_due_at,
    case 
      when t.cycle_started_at is not null and t.objective_timeframe_days is not null
      then t.cycle_started_at + (t.objective_timeframe_days || ' days')::interval
      else null
    end
  )
from public.optimisation_tasks t
where c.task_id = t.id
  and c.id = t.active_cycle_id
  and (t.objective_title is not null or t.objective_kpi is not null or t.objective_metric is not null)
  and c.objective is null;

-- Step 5: Update constraint to allow null objective_status (will be computed)
alter table public.optimisation_task_cycles
  alter column objective_status drop not null;

alter table public.optimisation_task_cycles
  alter column objective_status set default 'not_set';


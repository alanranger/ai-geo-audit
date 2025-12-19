-- Migration: Add 'completed' and 'archived' status values to optim_task_status enum
-- Date: 2025-12-19
-- Phase 7: Cycle completion support

-- Add 'completed' to the enum (if not exists)
do $$ 
begin
  if not exists (
    select 1 from pg_enum 
    where enumlabel = 'completed' 
    and enumtypid = (select oid from pg_type where typname = 'optim_task_status')
  ) then
    alter type public.optim_task_status add value 'completed';
  end if;
end $$;

-- Add 'archived' to the enum (if not exists)
do $$ 
begin
  if not exists (
    select 1 from pg_enum 
    where enumlabel = 'archived' 
    and enumtypid = (select oid from pg_type where typname = 'optim_task_status')
  ) then
    alter type public.optim_task_status add value 'archived';
  end if;
end $$;


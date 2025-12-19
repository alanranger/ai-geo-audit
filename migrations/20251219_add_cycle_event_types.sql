-- Migration: Add 'cycle_completed' and 'cycle_archived' to optim_event_type enum
-- Date: 2025-12-19
-- Phase 7: Cycle completion support

-- Add 'cycle_completed' to the enum (if not exists)
do $$ 
begin
  if not exists (
    select 1 from pg_enum 
    where enumlabel = 'cycle_completed' 
    and enumtypid = (select oid from pg_type where typname = 'optim_event_type')
  ) then
    alter type public.optim_event_type add value 'cycle_completed';
  end if;
end $$;

-- Add 'cycle_archived' to the enum (if not exists)
do $$ 
begin
  if not exists (
    select 1 from pg_enum 
    where enumlabel = 'cycle_archived' 
    and enumtypid = (select oid from pg_type where typname = 'optim_event_type')
  ) then
    alter type public.optim_event_type add value 'cycle_archived';
  end if;
end $$;

-- Add 'cycle_start' to the enum (if not exists) - for consistency with Phase 6
do $$ 
begin
  if not exists (
    select 1 from pg_enum 
    where enumlabel = 'cycle_start' 
    and enumtypid = (select oid from pg_type where typname = 'optim_event_type')
  ) then
    alter type public.optim_event_type add value 'cycle_start';
  end if;
end $$;


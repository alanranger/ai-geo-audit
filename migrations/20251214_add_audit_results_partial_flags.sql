-- Adds flags to distinguish partial/invalid audit writes.
-- This prevents dashboards from treating refresh/failed saves as full audits.

alter table public.audit_results
  add column if not exists is_partial boolean not null default false;

alter table public.audit_results
  add column if not exists partial_reason text;


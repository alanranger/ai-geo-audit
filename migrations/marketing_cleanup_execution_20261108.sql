-- Clean-up real execution (QUESTION-2026-11-08 first-cleanup-unsubscribe-never-openers, option A): the approved
-- manifest is executed by Alan's PC (Squarespace's own opt-out) in bounded batches; every item gets one outcome.
-- Additive only: wider checks, nullable columns, one read-only view. Nothing here changes existing rows.

alter table public.marketing_cleanup_manifests drop constraint if exists marketing_cleanup_manifests_status_check;
alter table public.marketing_cleanup_manifests add constraint marketing_cleanup_manifests_status_check
  check (status in ('frozen','approved','executed_dry_run','executing','executed','verified','cancelled'));
alter table public.marketing_cleanup_manifests add column if not exists exec_state jsonb;

alter table public.marketing_cleanup_items drop constraint if exists marketing_cleanup_items_outcome_check;
alter table public.marketing_cleanup_items add constraint marketing_cleanup_items_outcome_check
  check (outcome in ('would_do','skipped_changed','needs_review','sending','done','skipped','failed'));
alter table public.marketing_cleanup_items add column if not exists profile_id text;
alter table public.marketing_cleanup_items add column if not exists skip_reason text;
alter table public.marketing_cleanup_items add column if not exists attempts int not null default 0;
alter table public.marketing_cleanup_items add column if not exists last_try_at timestamptz;
alter table public.marketing_cleanup_items add column if not exists last_error text;

-- Per address: campaigns delivered in fully collected history, and any recorded open or click (any campaign, any link).
create or replace view public.marketing_email_exposure_v with (security_invoker = true) as
select lower(e.email) as email,
  count(distinct e.email_id) filter (where e.event_type = 'DELIVERED' and c.events_complete) as delivered_campaigns,
  count(*) filter (where e.event_type in ('OPENED','CLICKED')) as engaged_events,
  max(e.event_at) filter (where e.event_type in ('OPENED','CLICKED')) as last_engaged_at
from public.sqs_email_events e
left join public.sqs_email_campaigns c using (email_id)
where e.email is not null
group by lower(e.email);
revoke all on public.marketing_email_exposure_v from anon, authenticated;

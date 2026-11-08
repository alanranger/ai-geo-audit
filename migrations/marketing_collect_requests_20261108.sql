-- Collect after every send (8 Nov 2026): when a send is recorded (a new sent campaign ingested from the report read,
-- a Squarespace email linked to a campaign record, or a record moved to "sent"), the email-report collector is asked
-- to run on Alan's PC about 15 minutes, 24 hours and 72 hours after the send so opens and clicks build up. The PC job
-- runner (collector.mjs --jobs, every 5 min) claims due rows through /api/aigeo/marketing ?action=collect-next and
-- reports back with collect-done. A row is skipped when the campaign was already collected after its due time.
-- Read-only on Squarespace: the queued run is the normal daily collector run.
create table if not exists public.marketing_collect_requests (
  request_id uuid primary key default gen_random_uuid(),
  email_id text,
  campaign_key text,
  target text generated always as (coalesce(email_id, 'campaign:' || campaign_key)) stored,
  slot text not null check (slot in ('15m', '24h', '72h', 'manual')),
  due_at timestamptz not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'skipped', 'failed')),
  source text,
  attempts integer not null default 0,
  claimed_at timestamptz,
  finished_at timestamptz,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  check (email_id is not null or campaign_key is not null)
);
create unique index if not exists marketing_collect_requests_target_slot on public.marketing_collect_requests (target, slot);
create index if not exists marketing_collect_requests_due on public.marketing_collect_requests (status, due_at);
alter table public.marketing_collect_requests enable row level security;
revoke all on public.marketing_collect_requests from anon, authenticated;

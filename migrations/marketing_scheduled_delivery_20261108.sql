-- Email capacity + Scheduled & planned delivery (question 2026-11-08 build-email-capacity-and-scheduled-delivery).
-- 1. Squarespace's Scheduled tab as read by the PC collector (read-only). A row is never deleted: a later complete read
--    that no longer lists it sets state = 'gone' (sent or cancelled is decided against sqs_email_campaigns). A failed or
--    partial read posts nothing, so nothing is released.
-- 2. The intended send instant of a campaign record as its own columns (it sat only in stage_history). The provider
--    draft / scheduled email id is kept apart from sqs_email_id: it is never evidence that anything was sent.

create table if not exists public.sqs_scheduled_emails (
  email_id text primary key,
  subject text,
  email_type text,
  scheduled_for timestamptz not null,
  scheduled_tz text not null default 'UTC',
  mailing_list_ids text[] not null default '{}',
  mailing_list_names text[] not null default '{}',
  recipients integer,
  recipients_basis text not null default 'unknown' check (recipients_basis in ('single_list_count', 'sum_of_lists_upper_bound', 'unknown')),
  state text not null default 'scheduled' check (state in ('scheduled', 'gone')),
  first_seen_at timestamptz not null default now(),
  collected_at timestamptz not null default now(),
  gone_at timestamptz,
  changed_at timestamptz,
  history jsonb not null default '[]'::jsonb,
  campaign_key text,
  link_state text not null default 'unlinked' check (link_state in ('linked', 'ambiguous', 'unlinked', 'external')),
  link_basis text,
  link_candidates text[] not null default '{}',
  link_set_by text,
  link_set_at timestamptz,
  run_id uuid
);
alter table public.sqs_scheduled_emails enable row level security;
comment on table public.sqs_scheduled_emails is 'Squarespace Scheduled tab (collector, read-only GET /api/newsletters/v1.0/composer/emails?emailState=SCHEDULED + /emails/{id}). Never deleted; gone = not listed on a later complete read.';

alter table public.strategy_campaigns
  add column if not exists scheduled_for timestamptz,
  add column if not exists scheduled_tz text,
  add column if not exists scheduled_recipients integer,
  add column if not exists sqs_draft_id text,
  add column if not exists schedule_evidence text,
  add column if not exists schedule_evidence_at timestamptz,
  add column if not exists schedule_evidence_by text;

do $$ begin
  alter table public.strategy_campaigns add constraint strategy_campaigns_schedule_evidence_chk check (schedule_evidence is null or schedule_evidence in ('operator_verified', 'seen', 'manual'));
exception when duplicate_object then null; end $$;

comment on column public.strategy_campaigns.scheduled_for is 'Intended send instant recorded on the campaign (app side). The platform time is sqs_scheduled_emails.scheduled_for; a difference is a warning.';
comment on column public.strategy_campaigns.sqs_draft_id is 'Squarespace draft / scheduled email id. NOT sent evidence (sent = sqs_email_id or the id appearing in sqs_email_campaigns).';
comment on column public.strategy_campaigns.schedule_evidence is 'operator_verified = Alan / ChatGPT saw Squarespace''s confirmation; seen = collector read; manual = typed without platform confirmation.';

-- Normalise: the latest "scheduled" stage_history entry that carries scheduled_for (only Pick n Mix on 8 Nov 2026).
with h as (
  select c.property_url, c.campaign_key,
    (select e from jsonb_array_elements(c.stage_history) e where e->>'stage' = 'scheduled' and e ? 'scheduled_for' order by e->>'at' desc limit 1) as e
  from public.strategy_campaigns c
  where c.stage = 'scheduled' and c.scheduled_for is null
)
update public.strategy_campaigns c set
  scheduled_for = (h.e->>'scheduled_for')::timestamptz,
  scheduled_tz = coalesce(h.e->>'timezone', 'Europe/London'),
  scheduled_recipients = nullif(h.e->>'recipients', '')::integer,
  sqs_draft_id = coalesce(c.sqs_draft_id, h.e->>'draft_id'),
  schedule_evidence = case when h.e->>'note' ilike '%squarespace confirmation%' then 'operator_verified' else 'manual' end,
  schedule_evidence_at = (h.e->>'at')::timestamptz,
  schedule_evidence_by = h.e->>'by'
from h
where c.property_url = h.property_url and c.campaign_key = h.campaign_key and h.e is not null;

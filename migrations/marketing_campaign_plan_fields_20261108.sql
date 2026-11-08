-- Campaign-plan fields for the email capacity lines (question 2026-11-08 quarter-action-tick-…-norfolk-weekly-campaigns,
-- Part 2). Written only by POST /api/aigeo/marketing { action: 'campaign-plan' } (admin key). No other table changes.
-- planned_send_on: the planned send DAY when no time is known (a day on a reset day stays unallocated; no midnight).
-- estimate_*: a labelled audience estimate (provisional, not frozen) when the audience rule is not a saved segment;
--   a live segment estimate or a frozen snapshot replaces it (one reservation per email).
alter table public.strategy_campaigns
  add column if not exists planned_send_on date,
  add column if not exists estimate_sends integer,
  add column if not exists estimate_as_of date,
  add column if not exists estimate_rule text;

do $$ begin
  alter table public.strategy_campaigns add constraint strategy_campaigns_estimate_sends_chk check (estimate_sends is null or estimate_sends >= 0);
exception when duplicate_object then null; end $$;

comment on column public.strategy_campaigns.planned_send_on is 'Planned send day (no time known). The app-intended instant, when known, is scheduled_for; the platform time is sqs_scheduled_emails.';
comment on column public.strategy_campaigns.estimate_sends is 'Audience estimate (unique addresses incl. business copy), provisional and not frozen; label = estimate_as_of + estimate_rule.';

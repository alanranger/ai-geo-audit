-- Part 2 / V02 (8 Nov 2026): stored campaign records carry their audience, featured events, send evidence and frozen
-- results; a step can be rescheduled without losing its planned date.
alter table public.strategy_campaigns
  add column if not exists audience text check (audience in ('full_list','segments')),
  add column if not exists audience_set_at timestamptz,
  add column if not exists event_keys text[],
  add column if not exists sent_on date,
  add column if not exists results_snapshot jsonb;
alter table public.strategy_campaign_ticks
  add column if not exists moved_to date;

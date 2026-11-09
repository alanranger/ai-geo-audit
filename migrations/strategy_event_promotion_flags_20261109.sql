-- "Retired from promotion" per event (QUESTION-2026-11-09 (q) item 11, Alan): set by Alan only. A flagged event stays in
-- stock and on sale (sales gap stock, likely and prime-window counts are unchanged) but is never recommended: excluded from
-- Remedy lever 1, the monthly "Events to push" lists, the Strategy push list and campaign pushes (read as "don't promote").
-- event_key = start date | page path, the same key as strategy_event_overrides (eventKeyOf in lib/strategy-campaigns.mjs).
-- Read by lib/strategy-promotion-flags.mjs and lib/strategy-campaigns.mjs (service role). Never written to the website.
create table if not exists public.strategy_event_promotion_flags (
  property_url text not null,
  event_key text not null,
  event_date date not null,
  event_title text,
  retired_from_promotion boolean not null default true,
  reason text,
  set_by text not null,
  set_at timestamptz not null default now(),
  history jsonb not null default '[]'::jsonb,
  primary key (property_url, event_key)
);
create index if not exists strategy_event_promotion_flags_date on public.strategy_event_promotion_flags (property_url, event_date);
alter table public.strategy_event_promotion_flags enable row level security;
revoke all on public.strategy_event_promotion_flags from anon, authenticated;

-- Seed (Alan, 9 Nov 2026): December beginners promotion dropped; the 1 Dec course stays on sale.
insert into public.strategy_event_promotion_flags (property_url, event_key, event_date, event_title, retired_from_promotion, reason, set_by, set_at, history)
values (
  'https://www.alanranger.com', '2026-12-01|/beginners-photography-lessons/camera-courses-for-beginners-coventry-wc34j', '2026-12-01',
  'Camera Courses For Beginners - Week 1 of 3 - Coventry 1-12', true, 'Alan dropped December beginners promotion; the course stays on sale',
  'Alan via Claude QUESTION (q), 9 Nov 2026', now(),
  jsonb_build_array(jsonb_build_object('at', now(), 'by', 'Alan via Claude QUESTION (q), 9 Nov 2026', 'retired_from_promotion', true, 'note', 'migration seed strategy_event_promotion_flags_20261109'))
)
on conflict (property_url, event_key) do nothing;

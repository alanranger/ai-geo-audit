-- What happened to a finished event (8 Nov 2026): Alan's cancellation record per event date, keyed by the shared runKey
-- in lib/strategy-run-rate.mjs. Read by the Strategy events tile and KPI scorecard F5 (Ran % of held = ran ÷ (listed −
-- withdrawn − recorded cancellations)). Written only by api/aigeo/strategy-event-outcomes.js (admin key, service role).
-- Counts are notes (blank when not evidenced); attendees only ever come from the Booking Sheet date, so a transferred
-- booking counts once, on the event it moved to. Never written back to the Booking Sheet or the website.
create table if not exists public.strategy_event_outcomes (
  property_url text not null,
  run_key text not null,
  event_date date not null,
  event_title text,
  cancelled boolean not null default true,
  reason text check (reason in ('weather', 'low_bookings', 'leader_unavailable', 'venue', 'other')),
  reason_note text,
  bookings_outcome text check (bookings_outcome in ('transferred', 'refunded', 'credit_held', 'mixed')),
  bookings_note text,
  transferred_to_title text,
  transferred_to_date date,
  transferred_count integer check (transferred_count between 0 and 99),
  refunded_count integer check (refunded_count between 0 and 99),
  credit_held_count integer check (credit_held_count between 0 and 99),
  credit_held_person_id uuid,
  set_by text not null,
  set_at timestamptz not null default now(),
  history jsonb not null default '[]'::jsonb,
  primary key (property_url, run_key),
  check (not cancelled or reason is not null)
);
create index if not exists strategy_event_outcomes_date on public.strategy_event_outcomes (property_url, event_date);
alter table public.strategy_event_outcomes enable row level security;
revoke all on public.strategy_event_outcomes from anon, authenticated;

-- Pre-filled from Alan's answers (Claude handoff, 8 Nov 2026). Batsford: the same bookings moved from Sat 24 to Sun 25 Oct,
-- so the refund / credit counts sit on the 25 Oct record only. Refunded 1 = the Booking Sheet REFUNDED row dated 25 Oct;
-- credit held 1 = Alan (JLR client; which Booking Sheet row is not evidenced, so no person link). Transfers to Peak District
-- 1 Nov are not identifiable on the Booking Sheet, so that count is blank. Woodland walk 6 Nov: 1 booked (snapshot) and
-- 1 attendee on the Booking Sheet for Fri 4 Dec = the transfer.
insert into public.strategy_event_outcomes (property_url, run_key, event_date, event_title, cancelled, reason, reason_note, bookings_outcome, bookings_note, transferred_to_title, transferred_to_date, transferred_count, refunded_count, credit_held_count, set_by, set_at, history)
select v.property_url, v.run_key, v.event_date::date, v.event_title, true, v.reason, v.reason_note, v.bookings_outcome, v.bookings_note, v.to_title, v.to_date::date, v.tc, v.rc, v.cc,
  'Alan via Claude, 8 Nov 2026', now(),
  jsonb_build_array(jsonb_build_object('at', now(), 'by', 'Alan via Claude, 8 Nov 2026', 'cancelled', true, 'reason', v.reason, 'reason_note', v.reason_note, 'bookings_outcome', v.bookings_outcome, 'transferred_to_date', v.to_date, 'transferred_count', v.tc, 'refunded_count', v.rc, 'credit_held_count', v.cc, 'note', 'migration seed strategy_event_outcomes_20261108'))
from (values
  ('https://www.alanranger.com', '2026-10-24|day|batsford arboretum autumn photography wo', '2026-10-24', 'Batsford Arboretum Autumn Photography Workshop - 24/10', 'other', 'moved to Sun 25 Oct, then cancelled', 'mixed', 'same bookings as Sun 25 Oct (moved there first); counts are on the 25 Oct record so they are not counted twice', 'Peak District Photography Workshop Padley Gorge - Autumn', '2026-11-01', null::int, null::int, null::int),
  ('https://www.alanranger.com', '2026-10-25|day|batsford arboretum autumn photography wo', '2026-10-25', 'Batsford Arboretum Autumn Photography Workshop - 25/10', 'other', 'moved to Sun 25 Oct, then cancelled', 'mixed', 'refunded 1: Booking Sheet REFUNDED row dated 25 Oct; credit held 1: JLR client (Alan); transferred count not identifiable on the Booking Sheet', 'Peak District Photography Workshop Padley Gorge - Autumn', '2026-11-01', null::int, 1, 1),
  ('https://www.alanranger.com', '2026-11-06|day|woodland photography walk kenilworth cra', '2026-11-06', 'Woodland Photography Walk | Kenilworth | Crackley Woods', 'low_bookings', 'only one person booked', 'transferred', '1 booked on the 6 Nov listing; the 1 Booking Sheet attendee on Fri 4 Dec is that transfer', 'Woodland Photography Walk | Solihull | Hay Woods - Winter', '2026-12-04', 1, null::int, null::int)
) as v(property_url, run_key, event_date, event_title, reason, reason_note, bookings_outcome, bookings_note, to_title, to_date, tc, rc, cc)
on conflict (property_url, run_key) do nothing;

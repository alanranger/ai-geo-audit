-- Event outcomes, second pass (8 Nov 2026): bookings from one cancelled run can move to more than one event (Batsford
-- 23–25 Oct → Peak District 1 Nov and the Woodland Masterclass 10 Jan 2027), and a held credit stays an open
-- commitment until it is used (credit_used_on set → no more "credit held" marker or Monday brief note).
alter table public.strategy_event_outcomes
  add column if not exists transfers jsonb not null default '[]'::jsonb,
  add column if not exists credit_used_on date;

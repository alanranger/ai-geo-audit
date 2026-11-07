-- V05 (7 Nov 2026): an action can be "waiting" (e.g. on the next qualifying course) — neither done nor overdue.
alter table public.strategy_quarter_actions add column if not exists status text check (status in ('waiting'));
alter table public.strategy_quarter_actions add column if not exists waiting_on text;

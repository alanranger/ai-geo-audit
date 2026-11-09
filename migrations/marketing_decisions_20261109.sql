-- Alan's recorded decisions (who / when / why, with history) read by the shared decision state
-- (lib/marketing/decision-state.mjs): Marketing "Waiting on you", Strategy "Needs Alan", Results, next actions.
-- Kinds: plan_approved (overall editorial approval of GPT's plan; per-draft release approval stays separate),
--        keep_blocked (a suppressed contact stays blocked; no consent change), deferred (Alan does it himself).
-- Never deleted: a changed decision appends to history.
create table if not exists public.marketing_decisions (
  decision_key text primary key,
  kind text not null check (kind in ('plan_approved', 'keep_blocked', 'deferred')),
  ref_key text not null,
  decision text not null,
  reason text,
  decided_by text not null,
  decided_at timestamptz not null,
  source text,
  recorded_by text not null,
  recorded_at timestamptz not null default now(),
  history jsonb not null default '[]'::jsonb
);
create index if not exists marketing_decisions_kind_idx on public.marketing_decisions (kind);
alter table public.marketing_decisions enable row level security;
comment on table public.marketing_decisions is 'Alan''s decisions (plan approved / keep blocked / deferred) read by every Marketing and Strategy view; history kept, never deleted.';

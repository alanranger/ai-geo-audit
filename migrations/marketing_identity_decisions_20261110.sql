-- Alan's confirmed identity decisions (10 Nov 2026, QUESTION-2026-11-10-identity-review-alan-decisions-22). Read by
-- every customer rebuild (lib/marketing/rebuild.mjs loadIdentityDecisions), so a decision survives rebuilds.
-- Person ids only (anchors are resolved from customer_person at rebuild time; no addresses stored here).
--   attach     subject = a review-queue name record, target = the person it is (pending → primary)
--   alias      subject = a second address's record, target = the primary person (its records join the primary;
--              an alias's own Squarespace contact stays its own record with its own consent)
--   separate   subject and target are different people: never merged by any rule
--   unmatched  subject = a name record Alan left unmatched (no target): decided, out of the review queue
-- marketing_identity_overrides ('separate' for name records, primary key name_anchor) is unchanged.
create table if not exists public.marketing_identity_decisions (
  decision_id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('attach', 'alias', 'separate', 'unmatched')),
  subject_person_id uuid not null,
  target_person_id uuid,
  reason text not null,
  decided_by text not null,
  source text,
  set_by text not null,
  set_at timestamptz not null default now(),
  cleared_at timestamptz,
  cleared_by text,
  clear_reason text,
  constraint marketing_identity_decisions_target check ((kind = 'unmatched') = (target_person_id is null)),
  constraint marketing_identity_decisions_not_self check (target_person_id is null or target_person_id <> subject_person_id)
);
create unique index if not exists marketing_identity_decisions_active
  on public.marketing_identity_decisions (kind, subject_person_id, coalesce(target_person_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where cleared_at is null;
alter table public.marketing_identity_decisions enable row level security;
revoke all on public.marketing_identity_decisions from anon, authenticated;

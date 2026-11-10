-- Soft opt-in Stage 2 (QUESTION-2026-11-10-soft-opt-in-stage-2-apply-20): allow kind 'consent_basis' in
-- marketing_decisions (one batch row + one row per person keyed by sha256 email hash; read by every customer rebuild,
-- lib/marketing/consent-basis.mjs). Additive: existing kinds and rows are unchanged.
alter table public.marketing_decisions drop constraint if exists marketing_decisions_kind_check;
alter table public.marketing_decisions add constraint marketing_decisions_kind_check
  check (kind in ('plan_approved', 'keep_blocked', 'deferred', 'consent_basis'));

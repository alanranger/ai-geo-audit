-- =============================================================================
-- 2026-05-21 (follow-up) - Drop legacy targets unique index that breaks
-- the scenario Duplicate flow.
-- =============================================================================
--
-- Background
-- ----------
-- v5.0 (2026-05-20-scenario-engine-tables.sql) created
--   CREATE UNIQUE INDEX revenue_funnel_targets_property_tier_uidx
--     ON public.revenue_funnel_targets (property_url, COALESCE(tier_id, ''));
--
-- v5.3 Phase A.1 (2026-05-21-scenario-planning-tables.sql) added scenario_id
-- to revenue_funnel_targets and created a NEW scenario-scoped unique index
--   CREATE UNIQUE INDEX revenue_funnel_targets_scenario_tier_idx
--     ON public.revenue_funnel_targets (scenario_id, COALESCE(tier_id, ''));
-- ...but FORGOT to drop the old v5.0 index, which is now wrong because
-- duplicating a scenario copies (same property_url, same tier_id, NEW
-- scenario_id) rows. The legacy index doesn't know about scenario_id and
-- rejects the second insert with:
--   duplicate key value violates unique constraint
--     "revenue_funnel_targets_property_tier_uidx"
--
-- This file just drops the legacy index. Idempotent.
-- =============================================================================

BEGIN;

DROP INDEX IF EXISTS public.revenue_funnel_targets_property_tier_uidx;

COMMIT;

-- Verification (read-only):
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname = 'public' AND tablename = 'revenue_funnel_targets'
--    ORDER BY indexname;
-- Expected post-apply: should NOT contain
--   revenue_funnel_targets_property_tier_uidx
-- Should still contain:
--   revenue_funnel_targets_scenario_tier_idx (scenario-scoped equivalent)
--   revenue_funnel_targets_pkey
--   revenue_funnel_targets_property_idx

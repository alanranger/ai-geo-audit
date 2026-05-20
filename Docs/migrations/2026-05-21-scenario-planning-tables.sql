-- =============================================================================
-- 2026-05-21 - Scenario planning foundation (Phase A of the scenario engine)
-- =============================================================================
--
-- Why this exists
-- ---------------
-- v5.0 (2026-05-20) shipped targets + tier weights + lever weights as ONE
-- unconditional config per property. Alan asked on 2026-05-20 for the ability
-- to build SEVERAL named scenarios (e.g. "Survive Q3 2026", "Push Academy 30%",
-- "Workshop-led 2027"), switch between them, and have one marked active at any
-- time. The active scenario feeds the Top 3 Actions picker on the Revenue
-- Funnel tab.
--
-- This migration:
--   1. Creates public.revenue_funnel_scenarios as the parent table for a
--      scenario library (name, notes, active flag, monthly survival baseline,
--      hours-per-week budget).
--   2. Adds scenario_id (FK) to the three existing weight/target tables.
--   3. Seeds a deterministic Baseline scenario for https://www.alanranger.com
--      and retags the existing 7+6+6 rows onto it, then locks the column NOT
--      NULL.
--   4. Replaces the old (property_url, tier/lever_id) unique constraints with
--      scenario-scoped (scenario_id, tier/lever_id) ones so different scenarios
--      can hold different weights for the same tier.
--   5. Adds a partial unique index enforcing "only one active scenario per
--      property" at the DB layer (defence-in-depth; the API also guards it).
--   6. Adds a functional unique index on revenue_funnel_targets that treats
--      NULL tier_id as '' so the master row and per-tier rows coexist cleanly
--      under a single scenario.
--
-- Idempotency
-- -----------
-- Every step uses IF NOT EXISTS / IF EXISTS / ON CONFLICT so the migration is
-- safe to re-run.
--
-- Rollback (manual, NOT in this script)
-- -------------------------------------
--   ALTER TABLE public.revenue_funnel_targets       DROP COLUMN scenario_id CASCADE;
--   ALTER TABLE public.revenue_funnel_tier_weights  DROP COLUMN scenario_id CASCADE;
--   ALTER TABLE public.revenue_funnel_lever_weights DROP COLUMN scenario_id CASCADE;
--   DROP TABLE  public.revenue_funnel_scenarios CASCADE;
--   -- restore old unique constraints if you really want pre-v5.3 schema back.
--
-- Apply via Supabase MCP (`user-supabase-ai-chat`) or psql.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Scenarios parent table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.revenue_funnel_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_url text NOT NULL,
  name text NOT NULL,
  notes text,
  is_active boolean NOT NULL DEFAULT false,
  monthly_survival_baseline_gbp numeric
    CHECK (monthly_survival_baseline_gbp IS NULL OR monthly_survival_baseline_gbp >= 0),
  hours_per_week numeric
    CHECK (hours_per_week IS NULL OR (hours_per_week >= 0 AND hours_per_week <= 80)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Names are case-insensitive-unique within a property so the UI dropdown
-- can't end up with "Survive Q3" and "survive q3" simultaneously.
CREATE UNIQUE INDEX IF NOT EXISTS revenue_funnel_scenarios_unique_name
  ON public.revenue_funnel_scenarios (property_url, lower(name));

-- Only one active scenario per property at any time. Enforced at the DB
-- layer so a race in the API can't leave us with two actives.
CREATE UNIQUE INDEX IF NOT EXISTS revenue_funnel_scenarios_one_active
  ON public.revenue_funnel_scenarios (property_url)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS revenue_funnel_scenarios_property_idx
  ON public.revenue_funnel_scenarios (property_url);

-- Reuse the touch-updated-at trigger function defined in the v5.0 migration.
DROP TRIGGER IF EXISTS revenue_funnel_scenarios_touch_updated_at
  ON public.revenue_funnel_scenarios;
CREATE TRIGGER revenue_funnel_scenarios_touch_updated_at
  BEFORE UPDATE ON public.revenue_funnel_scenarios
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Seed the Baseline scenario for the alanranger.com property
--    Uses a deterministic UUID so the migration is fully reproducible and
--    so the UPDATE statements below can reference it without a CTE round-trip.
-- ---------------------------------------------------------------------------
INSERT INTO public.revenue_funnel_scenarios
  (id, property_url, name, notes, is_active, monthly_survival_baseline_gbp, hours_per_week)
VALUES (
  '00000000-0000-4000-8000-000000000001'::uuid,
  'https://www.alanranger.com',
  'Baseline',
  'Auto-created 2026-05-21 from the existing v5.0 targets / tier weights / lever weights. Marked active so the Top 3 Actions picker continues to run against historical config until Alan creates and activates a new scenario.',
  true,
  2500,  -- monthly survival baseline (rent + bills + minimums); editable from the UI.
  6      -- hours-per-week budget Alan allocates to SEO/CRO work; editable from the UI.
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Add scenario_id to the three child tables (nullable first so the
--    backfill UPDATE can run; locked NOT NULL after).
-- ---------------------------------------------------------------------------
ALTER TABLE public.revenue_funnel_targets
  ADD COLUMN IF NOT EXISTS scenario_id uuid
    REFERENCES public.revenue_funnel_scenarios(id) ON DELETE CASCADE;

ALTER TABLE public.revenue_funnel_tier_weights
  ADD COLUMN IF NOT EXISTS scenario_id uuid
    REFERENCES public.revenue_funnel_scenarios(id) ON DELETE CASCADE;

ALTER TABLE public.revenue_funnel_lever_weights
  ADD COLUMN IF NOT EXISTS scenario_id uuid
    REFERENCES public.revenue_funnel_scenarios(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- 4. Backfill scenario_id = Baseline for all existing rows on the alanranger
--    property. (No other properties exist in these tables yet; if any get
--    added later they will need their own seeded scenarios before this
--    migration's NOT NULL constraint applies.)
-- ---------------------------------------------------------------------------
UPDATE public.revenue_funnel_targets
  SET scenario_id = '00000000-0000-4000-8000-000000000001'::uuid
  WHERE scenario_id IS NULL
    AND property_url = 'https://www.alanranger.com';

UPDATE public.revenue_funnel_tier_weights
  SET scenario_id = '00000000-0000-4000-8000-000000000001'::uuid
  WHERE scenario_id IS NULL
    AND property_url = 'https://www.alanranger.com';

UPDATE public.revenue_funnel_lever_weights
  SET scenario_id = '00000000-0000-4000-8000-000000000001'::uuid
  WHERE scenario_id IS NULL
    AND property_url = 'https://www.alanranger.com';

-- ---------------------------------------------------------------------------
-- 5. Lock scenario_id NOT NULL after the backfill. If you've added rows for
--    another property without first creating a scenario, this will fail
--    loudly - which is the correct behaviour (don't silently re-tag).
-- ---------------------------------------------------------------------------
ALTER TABLE public.revenue_funnel_targets
  ALTER COLUMN scenario_id SET NOT NULL;
ALTER TABLE public.revenue_funnel_tier_weights
  ALTER COLUMN scenario_id SET NOT NULL;
ALTER TABLE public.revenue_funnel_lever_weights
  ALTER COLUMN scenario_id SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. Replace old per-property unique constraints with per-scenario ones so
--    different scenarios can hold different weights for the SAME tier/lever
--    on the SAME property.
-- ---------------------------------------------------------------------------
ALTER TABLE public.revenue_funnel_tier_weights
  DROP CONSTRAINT IF EXISTS revenue_funnel_tier_weights_property_url_tier_id_key;
ALTER TABLE public.revenue_funnel_tier_weights
  ADD CONSTRAINT revenue_funnel_tier_weights_scenario_tier_key
    UNIQUE (scenario_id, tier_id);

ALTER TABLE public.revenue_funnel_lever_weights
  DROP CONSTRAINT IF EXISTS revenue_funnel_lever_weights_property_url_lever_id_key;
ALTER TABLE public.revenue_funnel_lever_weights
  ADD CONSTRAINT revenue_funnel_lever_weights_scenario_lever_key
    UNIQUE (scenario_id, lever_id);

-- The targets table never had a (property_url, COALESCE(tier_id, '')) unique
-- constraint - the v5.1 config API worked around the absence using a manual
-- delete-then-insert. Now we add the proper functional unique index, scoped
-- to scenario_id, so future config-save code can use a plain upsert.
DROP INDEX IF EXISTS revenue_funnel_targets_scenario_tier_idx;
CREATE UNIQUE INDEX revenue_funnel_targets_scenario_tier_idx
  ON public.revenue_funnel_targets (scenario_id, COALESCE(tier_id, ''));

-- ---------------------------------------------------------------------------
-- 7. Helpful B-tree indexes for the lookup paths the API uses.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS revenue_funnel_targets_property_idx
  ON public.revenue_funnel_targets (property_url);
CREATE INDEX IF NOT EXISTS revenue_funnel_tier_weights_property_idx
  ON public.revenue_funnel_tier_weights (property_url);
CREATE INDEX IF NOT EXISTS revenue_funnel_lever_weights_property_idx
  ON public.revenue_funnel_lever_weights (property_url);

-- ---------------------------------------------------------------------------
-- 8. Sanity-check views (read-only). Helpful when debugging which scenario
--    a config row belongs to. NOT created by default - uncomment if needed.
-- ---------------------------------------------------------------------------
-- CREATE OR REPLACE VIEW public.v_revenue_funnel_scenario_full AS
-- SELECT s.id AS scenario_id, s.property_url, s.name, s.is_active,
--        s.monthly_survival_baseline_gbp, s.hours_per_week,
--        (SELECT count(*) FROM public.revenue_funnel_targets       t WHERE t.scenario_id = s.id) AS target_rows,
--        (SELECT count(*) FROM public.revenue_funnel_tier_weights  tw WHERE tw.scenario_id = s.id) AS tier_weight_rows,
--        (SELECT count(*) FROM public.revenue_funnel_lever_weights lw WHERE lw.scenario_id = s.id) AS lever_weight_rows,
--        s.updated_at
-- FROM public.revenue_funnel_scenarios s;

COMMIT;

-- =============================================================================
-- Verification queries to run AFTER apply (read-only):
--
--   SELECT id, property_url, name, is_active, monthly_survival_baseline_gbp,
--          hours_per_week, updated_at
--   FROM public.revenue_funnel_scenarios
--   ORDER BY property_url, name;
--
--   SELECT 'targets' tbl, scenario_id, count(*) FROM public.revenue_funnel_targets       GROUP BY 2
--   UNION ALL
--   SELECT 'tier_weights',  scenario_id, count(*) FROM public.revenue_funnel_tier_weights  GROUP BY 2
--   UNION ALL
--   SELECT 'lever_weights', scenario_id, count(*) FROM public.revenue_funnel_lever_weights GROUP BY 2;
-- =============================================================================

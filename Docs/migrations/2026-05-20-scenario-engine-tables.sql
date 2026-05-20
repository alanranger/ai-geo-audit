-- =====================================================================
-- 2026-05-20 v5 scenario-engine config tables
-- =====================================================================
-- Backs the "Top Actions - Targets, Tiers & Levers" section in the
-- Configuration & Reporting tab and the lever-weighted scoring inside
-- the smart-priorities picker.
--
-- Run order: idempotent — safe to re-run. Uses CREATE TABLE IF NOT
-- EXISTS + ON CONFLICT DO NOTHING for the seed inserts.
--
-- Project: alanranger ai-chat (igzvwbvgvmzvvzoclufx)
-- Apply via Supabase SQL editor or psql; do NOT run on the academy
-- project (dqrtcsvqsfgbqmnonkpt) by mistake.
-- =====================================================================

-- ---------------------------------------------------------------------
-- TABLE 1: revenue_funnel_targets
-- ---------------------------------------------------------------------
-- Stores monthly revenue + GP targets at two scopes:
--   tier_id IS NULL       -> master (business-wide) target row
--   tier_id IS NOT NULL   -> per-tier target row
--
-- The UNIQUE constraint uses COALESCE(tier_id, '') so the master row
-- (NULL tier) and the per-tier rows can coexist for the same property.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.revenue_funnel_targets (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_url                text NOT NULL,
  tier_id                     text NULL,
  monthly_revenue_target_gbp  numeric NOT NULL DEFAULT 0 CHECK (monthly_revenue_target_gbp >= 0),
  monthly_gp_target_gbp       numeric NOT NULL DEFAULT 0 CHECK (monthly_gp_target_gbp >= 0),
  notes                       text NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS revenue_funnel_targets_property_tier_uidx
  ON public.revenue_funnel_targets (property_url, COALESCE(tier_id, ''));

CREATE INDEX IF NOT EXISTS revenue_funnel_targets_property_idx
  ON public.revenue_funnel_targets (property_url);

COMMENT ON TABLE  public.revenue_funnel_targets             IS 'Monthly revenue + GP targets per property (tier_id NULL) and per-tier (tier_id set). Drives the GP-gap denominator in the smart-priorities scenario engine.';
COMMENT ON COLUMN public.revenue_funnel_targets.tier_id     IS 'Tier id from COMMERCIAL_TIERS (courses / academy / workshops_residential / workshops_nonres / services / hire). NULL = business-wide master target row.';
COMMENT ON COLUMN public.revenue_funnel_targets.monthly_revenue_target_gbp IS 'Target revenue (GBP) for the month. Annual target = this x 12 (the engine derives the annual figure rather than storing it twice).';
COMMENT ON COLUMN public.revenue_funnel_targets.monthly_gp_target_gbp      IS 'Target gross profit (GBP) for the month. NOT auto-derived from tier GP% on purpose — the user may want a GP target tighter than the implicit one.';

-- ---------------------------------------------------------------------
-- TABLE 2: revenue_funnel_tier_weights
-- ---------------------------------------------------------------------
-- Strategic multiplier per tier. Multiplies the GP-weighted profit
-- lift of every candidate before the engine sorts the Top N. Default
-- 1.0 = no override; <1 deprioritises a tier, >1 promotes it.
--
-- Example: portraits/headshots are <0.5% of revenue (the hire tier's
-- low-share sub-segment), so Alan can set hire = 0.6 to push hire
-- candidates lower in the queue without losing them entirely.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.revenue_funnel_tier_weights (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_url       text NOT NULL,
  tier_id            text NOT NULL,
  strategic_weight   numeric NOT NULL DEFAULT 1.0 CHECK (strategic_weight >= 0 AND strategic_weight <= 5),
  notes              text NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_url, tier_id)
);

CREATE INDEX IF NOT EXISTS revenue_funnel_tier_weights_property_idx
  ON public.revenue_funnel_tier_weights (property_url);

COMMENT ON TABLE public.revenue_funnel_tier_weights IS 'Per-tier strategic multiplier (0..5) applied on top of GP-weighted lift before the smart-priorities Top N sort. Editable from the Configuration & Reporting tab.';

-- ---------------------------------------------------------------------
-- TABLE 3: revenue_funnel_lever_weights
-- ---------------------------------------------------------------------
-- One row per lever × property. Lever ids are stable strings the
-- engine understands:
--   rank, aio, ctr, schema, conversion, surfacing
-- effort_cap = 'low' | 'medium' | 'high' | NULL (no cap). When set,
-- the engine drops candidates whose lever-implied effort exceeds the
-- cap (so Alan can have a "low-effort month").
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.revenue_funnel_lever_weights (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_url       text NOT NULL,
  lever_id           text NOT NULL,
  strategic_weight   numeric NOT NULL DEFAULT 1.0 CHECK (strategic_weight >= 0 AND strategic_weight <= 5),
  effort_cap         text NULL CHECK (effort_cap IS NULL OR effort_cap IN ('low', 'medium', 'high')),
  notes              text NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_url, lever_id)
);

CREATE INDEX IF NOT EXISTS revenue_funnel_lever_weights_property_idx
  ON public.revenue_funnel_lever_weights (property_url);

COMMENT ON TABLE public.revenue_funnel_lever_weights IS 'Per-lever strategic multiplier (0..5) and optional effort cap. Used by the smart-priorities scenario engine to mix the candidate stream — e.g. focus an upcoming month on AIO citations + rank lifts rather than CTR rewrites.';

-- ---------------------------------------------------------------------
-- Trigger: keep updated_at fresh on every UPDATE
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_revenue_funnel_targets_touch       ON public.revenue_funnel_targets;
DROP TRIGGER IF EXISTS tg_revenue_funnel_tier_weights_touch  ON public.revenue_funnel_tier_weights;
DROP TRIGGER IF EXISTS tg_revenue_funnel_lever_weights_touch ON public.revenue_funnel_lever_weights;

CREATE TRIGGER tg_revenue_funnel_targets_touch
  BEFORE UPDATE ON public.revenue_funnel_targets
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

CREATE TRIGGER tg_revenue_funnel_tier_weights_touch
  BEFORE UPDATE ON public.revenue_funnel_tier_weights
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

CREATE TRIGGER tg_revenue_funnel_lever_weights_touch
  BEFORE UPDATE ON public.revenue_funnel_lever_weights
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- ---------------------------------------------------------------------
-- Seed defaults for https://www.alanranger.com
-- ---------------------------------------------------------------------
-- The smart-priorities engine treats a missing row as "weight = 1.0",
-- so seeding is purely a UX convenience — the sliders will show
-- sensible defaults on first load rather than blank inputs. Targets
-- below are PLACEHOLDERS for Alan to overwrite from the
-- Configuration & Reporting tab; the GP figures are derived from the
-- GP_PCT_PER_TIER constants in api/aigeo/revenue-funnel-smart-priorities.js
-- (courses=90, academy=99, workshops_nonres=75, workshops_residential=35,
-- services=78, hire=92).
-- ---------------------------------------------------------------------

-- Master business-wide monthly target. £4000/mo / £48k/yr is the
-- visible band on the existing Profit Pyramid summary band; treat it
-- as a starting point Alan will tune from the UI.
INSERT INTO public.revenue_funnel_targets (property_url, tier_id, monthly_revenue_target_gbp, monthly_gp_target_gbp, notes)
VALUES ('https://www.alanranger.com', NULL, 4000, 2800, 'Seeded 2026-05-20 placeholder: edit from Configuration & Reporting > Top Actions Targets section.')
ON CONFLICT (property_url, COALESCE(tier_id, '')) DO NOTHING;

-- Per-tier monthly targets. PLACEHOLDERS using a flat distribution
-- with each tier''s GP% applied to derive the GP target. Edit from UI.
INSERT INTO public.revenue_funnel_targets (property_url, tier_id, monthly_revenue_target_gbp, monthly_gp_target_gbp, notes) VALUES
  ('https://www.alanranger.com', 'courses',                667, 600, 'Placeholder 2026-05-20; courses GP%=90.'),
  ('https://www.alanranger.com', 'academy',               1000, 990, 'Placeholder 2026-05-20; academy GP%=99.'),
  ('https://www.alanranger.com', 'workshops_nonres',       833, 625, 'Placeholder 2026-05-20; workshops_nonres GP%=75.'),
  ('https://www.alanranger.com', 'workshops_residential',  583, 204, 'Placeholder 2026-05-20; workshops_residential GP%=35.'),
  ('https://www.alanranger.com', 'services',               583, 455, 'Placeholder 2026-05-20; services GP%=78.'),
  ('https://www.alanranger.com', 'hire',                   333, 306, 'Placeholder 2026-05-20; hire GP%=92.')
ON CONFLICT (property_url, COALESCE(tier_id, '')) DO NOTHING;

-- Per-tier strategic weights. Default 1.0 across the board (no
-- override). Hire is pre-set to 0.7 because Alan flagged that
-- portraits/headshots are <0.5% of revenue and the tier as a whole is
-- a small share of profit - he can move it back to 1.0 or lower it
-- further from the UI.
INSERT INTO public.revenue_funnel_tier_weights (property_url, tier_id, strategic_weight, notes) VALUES
  ('https://www.alanranger.com', 'courses',                1.00, 'Default weight 1.0; high GP% (90), aligns with strategic focus.'),
  ('https://www.alanranger.com', 'academy',                1.00, 'Default weight 1.0; highest GP% tier (99). Scale-friendly.'),
  ('https://www.alanranger.com', 'workshops_nonres',       1.00, 'Default weight 1.0; healthy GP% (75), low fulfilment burden.'),
  ('https://www.alanranger.com', 'workshops_residential',  1.00, 'Default weight 1.0; lowest GP% (35) but volume-heavy. Adjust down if revenue<>profit gap grows.'),
  ('https://www.alanranger.com', 'services',               1.00, 'Default weight 1.0; 1-2-1 fulfilment is time-traded so high volume isn''t scalable.'),
  ('https://www.alanranger.com', 'hire',                   0.70, 'Pre-set 0.7 per Alan 2026-05-20: portraits/headshots are <0.5% of revenue; move up/down from the UI.')
ON CONFLICT (property_url, tier_id) DO NOTHING;

-- Per-lever strategic weights. All default 1.0 with no effort cap.
INSERT INTO public.revenue_funnel_lever_weights (property_url, lever_id, strategic_weight, effort_cap, notes) VALUES
  ('https://www.alanranger.com', 'rank',       1.00, NULL, 'L1 Rank: improve organic position on a target keyword.'),
  ('https://www.alanranger.com', 'aio',        1.00, NULL, 'L2 AIO citation: get cited in Google AI Overview.'),
  ('https://www.alanranger.com', 'ctr',        1.00, NULL, 'L3 CTR: improve SERP click-through (live-validated).'),
  ('https://www.alanranger.com', 'schema',     1.00, NULL, 'L4 Schema / rich result: add missing schema that unlocks SERP features.'),
  ('https://www.alanranger.com', 'conversion', 1.00, NULL, 'L5 Conversion: improve visitor -> trial -> paid on money pages (needs GA/Memberstack data; gated).'),
  ('https://www.alanranger.com', 'surfacing',  1.00, NULL, 'L6 Surface orphan product/service: push zero-impression items into hub nav.')
ON CONFLICT (property_url, lever_id) DO NOTHING;

-- =====================================================================
-- End of 2026-05-20 v5 migration
-- =====================================================================

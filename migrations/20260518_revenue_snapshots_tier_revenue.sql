-- 2026-05-18  Per-tier revenue breakdown for the Revenue Funnel sparklines.
--
-- Adds a jsonb column to revenue_snapshots so the Squarespace sync can
-- store revenue split by commercial tier (workshops / courses / services /
-- hire / academy / other). The Revenue Funnel summary endpoint reads this
-- column to draw 5 per-tier sparklines alongside the overall sparkline.
--
-- Shape:  { "workshops": 1234.56, "courses": 234.50, "services": 89.00,
--           "hire": 0, "academy": 79.00, "other": 12.00 }
--
-- NULL on every legacy or manual row — that's fine, the UI degrades to
-- "no tier breakdown" for those months.

ALTER TABLE public.revenue_snapshots
  ADD COLUMN IF NOT EXISTS tier_revenue jsonb;

COMMENT ON COLUMN public.revenue_snapshots.tier_revenue IS
  'Per-tier revenue breakdown: { workshops, courses, services, hire, academy, other }. '
  'Populated by squarespace-revenue-sync from order line items. NULL on legacy/manual rows.';

-- Add a partial transactions-by-tier column too (optional) so we can show
-- order counts per tier later. Same NULL-safe shape.
ALTER TABLE public.revenue_snapshots
  ADD COLUMN IF NOT EXISTS tier_transactions jsonb;

COMMENT ON COLUMN public.revenue_snapshots.tier_transactions IS
  'Per-tier transaction counts: { workshops, courses, ... }. Populated by squarespace-revenue-sync.';

CREATE INDEX IF NOT EXISTS revenue_snapshots_tier_revenue_idx
  ON public.revenue_snapshots USING gin (tier_revenue);

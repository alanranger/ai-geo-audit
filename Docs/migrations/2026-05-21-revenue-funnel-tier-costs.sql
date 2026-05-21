-- Per-tier fixed monthly costs (Academy Memberstack + Supabase + email + AI content).

CREATE TABLE IF NOT EXISTS public.revenue_funnel_tier_costs (
  property_url text NOT NULL,
  tier_id text NOT NULL,
  monthly_fixed_cost_gbp numeric NOT NULL DEFAULT 0,
  min_monthly_units numeric,
  unit_label text,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (property_url, tier_id)
);

COMMENT ON TABLE public.revenue_funnel_tier_costs IS 'Fixed monthly operating cost per commercial tier for net-GP math in Revenue Funnel.';

INSERT INTO public.revenue_funnel_tier_costs (
  property_url, tier_id, monthly_fixed_cost_gbp, min_monthly_units, unit_label, notes
) VALUES (
  'https://www.alanranger.com',
  'academy',
  100,
  10,
  'paid signups',
  'Memberstack + Supabase + Squarespace email + AI content amortised. Min 10 paid signups/mo at £79/yr.'
)
ON CONFLICT (property_url, tier_id) DO UPDATE SET
  monthly_fixed_cost_gbp = EXCLUDED.monthly_fixed_cost_gbp,
  min_monthly_units = EXCLUDED.min_monthly_units,
  unit_label = EXCLUDED.unit_label,
  notes = EXCLUDED.notes,
  updated_at = now();

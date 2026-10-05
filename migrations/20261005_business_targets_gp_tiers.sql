-- Additive: business GP survival tiers (single source) + workshops attendees import.
-- Applied via api/aigeo/admin-ensure-business-targets.js (Vercel has DB reachability).

CREATE TABLE IF NOT EXISTS public.business_targets (
  id bigserial PRIMARY KEY,
  property_url text NOT NULL DEFAULT 'https://www.alanranger.com',
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  survival_gp_monthly numeric NOT NULL,
  stretch1_gp_monthly numeric NOT NULL,
  stretch2_gp_monthly numeric NOT NULL,
  survival_gp_annual numeric NOT NULL,
  stretch1_gp_annual numeric NOT NULL,
  stretch2_gp_annual numeric NOT NULL,
  section_g_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  defcon_edges_proposed jsonb NULL,
  defcon_edges_live jsonb NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS business_targets_property_effective_uidx
  ON public.business_targets (property_url, effective_from);

CREATE TABLE IF NOT EXISTS public.booking_sheet_workshop_attendees (
  id bigserial PRIMARY KEY,
  property_url text NOT NULL,
  event_start date NULL,
  event_end date NULL,
  theme_location text NULL,
  duration_text text NULL,
  source text NULL,
  order_ref text NULL,
  paid numeric NULL,
  balance numeric NULL,
  client_name text NULL,
  is_multi_day boolean NOT NULL DEFAULT false,
  imported_at timestamptz NOT NULL DEFAULT now(),
  source_file text NULL
);

CREATE INDEX IF NOT EXISTS booking_sheet_workshop_attendees_prop_start_idx
  ON public.booking_sheet_workshop_attendees (property_url, event_start);

INSERT INTO public.business_targets (
  property_url, effective_from,
  survival_gp_monthly, stretch1_gp_monthly, stretch2_gp_monthly,
  survival_gp_annual, stretch1_gp_annual, stretch2_gp_annual,
  section_g_config, defcon_edges_proposed, notes
) VALUES (
  'https://www.alanranger.com',
  '2026-10-05',
  3700, 4000, 4700,
  44400, 48000, 56400,
  '{
    "min_clients_residential": 4,
    "existing_referral_monthly": 10,
    "commercial_clicks_monthly": 333,
    "bookings_per_1k_engaged": 2.6,
    "brand_clicks_monthly": 156,
    "high_margin_share_pct": 60,
    "academy_paid_monthly": 2,
    "lever_task_map": {"MC-64":"lever1","MC-33":"lever1"}
  }'::jsonb,
  '{
    "basis": "monthly_gp",
    "survival": 3700,
    "stretch1": 4000,
    "stretch2": 4700,
    "note": "Proposed 5 Oct 2026 — awaiting Alan approval before live DEFCON colouring"
  }'::jsonb,
  'Approved GP survival tiers 5 Oct 2026. Sales lines derived from rolling 3-closed-month GP margin.'
)
ON CONFLICT (property_url, effective_from) DO UPDATE SET
  survival_gp_monthly = EXCLUDED.survival_gp_monthly,
  stretch1_gp_monthly = EXCLUDED.stretch1_gp_monthly,
  stretch2_gp_monthly = EXCLUDED.stretch2_gp_monthly,
  survival_gp_annual = EXCLUDED.survival_gp_annual,
  stretch1_gp_annual = EXCLUDED.stretch1_gp_annual,
  stretch2_gp_annual = EXCLUDED.stretch2_gp_annual,
  section_g_config = EXCLUDED.section_g_config,
  defcon_edges_proposed = EXCLUDED.defcon_edges_proposed,
  notes = EXCLUDED.notes,
  updated_at = now();

UPDATE public.revenue_funnel_scenarios
SET monthly_survival_baseline_gbp = 3700
WHERE is_active = true
  AND property_url ILIKE '%alanranger%';

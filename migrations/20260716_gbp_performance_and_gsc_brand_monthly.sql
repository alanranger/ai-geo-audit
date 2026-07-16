-- Additive: GBP Performance + branded GSC monthly (Brand demand data layer)
-- Applied remotely via Supabase MCP 2026-07-16. Kept in-repo for history.

CREATE TABLE IF NOT EXISTS public.gbp_location_registry (
  location_id text PRIMARY KEY,
  title text,
  website_uri text,
  account_name text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.gbp_performance_monthly (
  location_id text NOT NULL,
  month date NOT NULL,
  impressions_search_mobile int NOT NULL DEFAULT 0,
  impressions_search_desktop int NOT NULL DEFAULT 0,
  impressions_maps_mobile int NOT NULL DEFAULT 0,
  impressions_maps_desktop int NOT NULL DEFAULT 0,
  website_clicks int NOT NULL DEFAULT 0,
  call_clicks int NOT NULL DEFAULT 0,
  direction_requests int NOT NULL DEFAULT 0,
  conversations int NOT NULL DEFAULT 0,
  bookings int NOT NULL DEFAULT 0,
  interactions int GENERATED ALWAYS AS (
    website_clicks + call_clicks + direction_requests + conversations + bookings
  ) STORED,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (location_id, month)
);

CREATE TABLE IF NOT EXISTS public.gbp_discovery_terms_monthly (
  location_id text NOT NULL,
  month date NOT NULL,
  search_keyword text NOT NULL,
  impressions int,
  threshold int,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (location_id, month, search_keyword)
);

CREATE TABLE IF NOT EXISTS public.gsc_brand_query_monthly (
  property_url text NOT NULL,
  month date NOT NULL,
  brand_impressions int NOT NULL DEFAULT 0,
  brand_clicks int NOT NULL DEFAULT 0,
  brand_ctr numeric,
  brand_avg_position numeric,
  total_query_impressions int NOT NULL DEFAULT 0,
  brand_share numeric,
  distinct_brand_queries int,
  top_brand_queries jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (property_url, month)
);

CREATE INDEX IF NOT EXISTS idx_gbp_performance_monthly_month
  ON public.gbp_performance_monthly (month DESC);
CREATE INDEX IF NOT EXISTS idx_gbp_discovery_terms_monthly_month
  ON public.gbp_discovery_terms_monthly (month DESC);
CREATE INDEX IF NOT EXISTS idx_gsc_brand_query_monthly_month
  ON public.gsc_brand_query_monthly (month DESC);

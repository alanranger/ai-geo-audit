-- Traditional SEO: cached full evaluation matrix (URL × rule rows) per property.
-- Lets the dashboard reload after refresh without re-running extractability for every URL.
-- Apply in Supabase SQL editor; Vercel API uses SUPABASE_SERVICE_ROLE_KEY.

CREATE TABLE IF NOT EXISTS public.traditional_seo_evaluation_cache (
  property_url TEXT PRIMARY KEY,
  last_property_url TEXT,
  last_evaluation_at TIMESTAMPTZ,
  evaluation_rows JSONB NOT NULL DEFAULT '[]'::JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS traditional_seo_evaluation_cache_updated_at_idx
  ON public.traditional_seo_evaluation_cache (updated_at DESC);

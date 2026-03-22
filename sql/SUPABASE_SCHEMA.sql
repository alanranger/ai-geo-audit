-- Supabase Schema for AI GEO Audit
-- Run this SQL in your Supabase SQL editor to create the required tables

-- ============================================================================
-- Table: audit_results
-- Purpose: Store schema audit results and calculated pillar scores
-- Status: Already exists (created previously)
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_url TEXT NOT NULL,
  audit_date DATE NOT NULL,
  
  -- GSC Data (for reference, but can be fetched from GSC API)
  gsc_clicks INTEGER,
  gsc_impressions INTEGER,
  gsc_avg_position DECIMAL(5,2),
  gsc_ctr DECIMAL(5,2),
  
  -- Schema Audit Data (NEEDS STORAGE)
  schema_total_pages INTEGER,
  schema_pages_with_schema INTEGER,
  schema_coverage DECIMAL(5,2),
  schema_types JSONB, -- Array of schema type strings
  schema_foundation JSONB, -- {Organization: true, Person: false, ...}
  schema_rich_eligible JSONB, -- {Article: true, Event: true, ...}
  schema_missing_pages JSONB, -- Array of URLs without schema
  
  -- Pillar Scores (calculated)
  visibility_score INTEGER,
  authority_score INTEGER,
  local_entity_score INTEGER,
  service_area_score INTEGER,
  content_schema_score INTEGER,
  snippet_readiness INTEGER,
  
  -- Brand Overlay and AI Summary (Phase 1 - overlay metrics)
  brand_overlay JSONB, -- JSON object: {score, label, brandQueryShare, brandCtr, brandAvgPosition, reviewScore, entityScore, notes}
  brand_score INTEGER, -- Brand Overlay score (0-100) for trend charting
  ai_summary JSONB, -- JSON object: {score, label, reasons}
  ai_summary_score INTEGER, -- AI Summary Likelihood score (0-100) for trend charting
  
  -- Money Pages Performance (Phase 1 - overlay metrics)
  money_pages_metrics JSONB, -- JSON object: {overview: {moneyClicks, moneyImpressions, moneyCtr, moneyAvgPosition, ...}, rows: [{url, title, clicks, impressions, ctr, avgPosition, category, categoryLabel, categoryColor, recommendation}]}
  
  -- Local Signals (when GBP API integrated)
  local_business_schema_pages INTEGER,
  nap_consistency_score INTEGER,
  knowledge_panel_detected BOOLEAN,
  service_areas JSONB,
  
  -- Backlinks (when backlink API integrated)
  domain_rating INTEGER,
  backlinks_count INTEGER,
  referring_domains INTEGER,
  
  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Unique constraint: one audit per property per day
  UNIQUE(property_url, audit_date)
);

-- Index for fast historical queries
CREATE INDEX IF NOT EXISTS idx_audit_results_property_date 
  ON audit_results(property_url, audit_date DESC);

-- ============================================================================
-- Table: gsc_timeseries
-- Purpose: Cache GSC timeseries data to avoid repeated API calls
-- Status: NEW - Required for GSC data caching
-- ============================================================================
CREATE TABLE IF NOT EXISTS gsc_timeseries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_url TEXT NOT NULL,
  date DATE NOT NULL,
  clicks INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  ctr DECIMAL(5,2) NOT NULL DEFAULT 0,
  position DECIMAL(5,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Unique constraint: one record per property per date
  UNIQUE(property_url, date)
);

-- Index for fast date range queries
CREATE INDEX IF NOT EXISTS idx_gsc_timeseries_property_date 
  ON gsc_timeseries(property_url, date DESC);

-- Index for finding missing dates
CREATE INDEX IF NOT EXISTS idx_gsc_timeseries_property 
  ON gsc_timeseries(property_url);

-- ============================================================================
-- Table: gsc_page_timeseries
-- Purpose: Cache page-level GSC timeseries for money pages
-- Status: NEW - Required for per-URL trend charts
-- ============================================================================
CREATE TABLE IF NOT EXISTS gsc_page_timeseries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_url TEXT NOT NULL,
  page_url TEXT NOT NULL,
  date DATE NOT NULL,
  clicks INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  ctr DECIMAL(5,2) NOT NULL DEFAULT 0,
  position DECIMAL(5,2),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(property_url, page_url, date)
);

CREATE INDEX IF NOT EXISTS idx_gsc_page_timeseries_lookup
  ON gsc_page_timeseries(property_url, page_url, date DESC);

-- ============================================================================
-- Table: audit_cron_schedule
-- Purpose: Store per-job cron schedule + last/next run
-- Status: NEW - Required for scheduler UI + cron gating
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_cron_schedule (
  job_key TEXT PRIMARY KEY,
  frequency TEXT NOT NULL DEFAULT 'daily',
  time_of_day TEXT NOT NULL DEFAULT '11:00',
  last_run_at TIMESTAMP,
  next_run_at TIMESTAMP,
  last_status TEXT,
  last_error TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_cron_schedule_next_run
  ON audit_cron_schedule(next_run_at);

-- ============================================================================
-- Table: keyword_target_metrics_cache
-- Purpose: Cached keyword demand (e.g. Keywords Everywhere volume) per page URL + keyword
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.keyword_target_metrics_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_url TEXT NOT NULL,
  keyword TEXT NOT NULL,
  search_volume INTEGER,
  cpc NUMERIC(14, 6),
  competition NUMERIC(14, 6),
  rank_position NUMERIC(10, 2),
  estimated_traffic INTEGER,
  url_estimated_traffic INTEGER,
  page_backlinks_sample INTEGER,
  page_backlinks_json JSONB,
  moz_domain_authority INTEGER,
  provider TEXT NOT NULL DEFAULT 'keywordseverywhere',
  raw_payload JSONB,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT keyword_target_metrics_cache_page_keyword UNIQUE (page_url, keyword)
);

CREATE TABLE IF NOT EXISTS public.ke_domain_metrics_cache (
  domain_host TEXT PRIMARY KEY,
  moz_domain_authority INTEGER,
  referring_domains_sample INTEGER,
  referring_domains_total INTEGER,
  total_backlinks INTEGER,
  raw_payload JSONB,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ke_domain_metrics_cache_fetched_at
  ON public.ke_domain_metrics_cache (fetched_at DESC);

-- DataForSEO Backlinks API — backlinks/summary/live (domain index totals)
CREATE TABLE IF NOT EXISTS public.dfs_backlink_summary_cache (
  domain_host TEXT PRIMARY KEY,
  include_subdomains BOOLEAN NOT NULL DEFAULT TRUE,
  backlinks INTEGER,
  referring_domains INTEGER,
  referring_main_domains INTEGER,
  broken_backlinks INTEGER,
  broken_pages INTEGER,
  backlinks_spam_score INTEGER,
  target_spam_score INTEGER,
  rank INTEGER,
  crawled_pages INTEGER,
  internal_links_count INTEGER,
  external_links_count INTEGER,
  dofollow_backlinks INTEGER,
  nofollow_backlinks INTEGER,
  cost_last NUMERIC(14, 6),
  raw_result JSONB,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dfs_backlink_summary_cache_fetched_at
  ON public.dfs_backlink_summary_cache (fetched_at DESC);

-- DataForSEO Backlinks API — per-page rows (backlinks/live or batch) for modal
CREATE TABLE IF NOT EXISTS public.dfs_page_backlinks_cache (
  page_url TEXT PRIMARY KEY,
  domain_host TEXT NOT NULL,
  include_subdomains BOOLEAN NOT NULL DEFAULT TRUE,
  backlink_rows JSONB NOT NULL DEFAULT '[]'::JSONB,
  row_count INTEGER,
  dofollow_count INTEGER,
  nofollow_count INTEGER,
  api_total_count INTEGER,
  cost_last NUMERIC(14, 6),
  raw_meta JSONB,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dfs_page_backlinks_cache_domain_fetched
  ON public.dfs_page_backlinks_cache (domain_host, fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_dfs_page_backlinks_cache_fetched_at
  ON public.dfs_page_backlinks_cache (fetched_at DESC);

-- DataForSEO — domain-wide filtered backlink index (backlinks/live + spam URL filters)
CREATE TABLE IF NOT EXISTS public.dfs_domain_backlink_rows (
  row_hash TEXT PRIMARY KEY,
  domain_host TEXT NOT NULL,
  url_from TEXT NOT NULL,
  url_to TEXT NOT NULL,
  url_to_key TEXT NOT NULL,
  anchor TEXT NOT NULL DEFAULT '',
  dofollow BOOLEAN,
  first_seen TIMESTAMPTZ,
  last_seen TIMESTAMPTZ,
  backlink_spam_score INTEGER,
  filters_version TEXT NOT NULL DEFAULT 'v1',
  run_id UUID NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dfs_domain_backlink_rows_domain_urlkey
  ON public.dfs_domain_backlink_rows (domain_host, url_to_key);

CREATE INDEX IF NOT EXISTS idx_dfs_domain_backlink_rows_domain_ingested
  ON public.dfs_domain_backlink_rows (domain_host, ingested_at DESC);

CREATE TABLE IF NOT EXISTS public.dfs_backlink_ingest_state (
  domain_host TEXT PRIMARY KEY,
  last_full_at TIMESTAMPTZ,
  last_delta_at TIMESTAMPTZ,
  delta_first_seen_floor TIMESTAMPTZ,
  filters_version TEXT NOT NULL DEFAULT 'v1',
  last_full_run_id UUID,
  last_delta_run_id UUID,
  approx_row_count INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dfs_backlink_ingest_state_updated
  ON public.dfs_backlink_ingest_state (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_keyword_target_metrics_cache_page_url
  ON public.keyword_target_metrics_cache (page_url);

CREATE INDEX IF NOT EXISTS idx_keyword_target_metrics_cache_fetched_at
  ON public.keyword_target_metrics_cache (fetched_at DESC);

-- Traditional SEO — full evaluation matrix cache (reload without re-extracting every URL)
CREATE TABLE IF NOT EXISTS public.traditional_seo_evaluation_cache (
  property_url TEXT PRIMARY KEY,
  last_property_url TEXT,
  last_evaluation_at TIMESTAMPTZ,
  evaluation_rows JSONB NOT NULL DEFAULT '[]'::JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS traditional_seo_evaluation_cache_updated_at_idx
  ON public.traditional_seo_evaluation_cache (updated_at DESC);

-- ============================================================================
-- Notes:
-- ============================================================================
-- 1. Run this SQL in your Supabase SQL editor
-- 2. The tables will be created if they don't exist (IF NOT EXISTS)
-- 3. Indexes will be created if they don't exist (IF NOT EXISTS)
-- 4. After creating tables, ensure RLS (Row Level Security) policies are set
--    if you want to restrict access (optional for service role key usage)




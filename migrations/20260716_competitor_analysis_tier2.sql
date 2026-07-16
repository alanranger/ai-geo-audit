-- Competitor Analysis tab — Tier 2 metrics storage (reviews + on-page)
-- Baseline: competitor-analysis-v1 / schema_version 1 (2026-07-16)
-- Not trended against AI citation history.

CREATE TABLE IF NOT EXISTS competitor_local_reviews (
  id BIGSERIAL PRIMARY KEY,
  domain TEXT NOT NULL,
  business_name TEXT,
  review_count INTEGER,
  rating NUMERIC(3,2),
  source_keyword TEXT,
  collection_source TEXT NOT NULL DEFAULT 'dfs_serp_local_pack',
  baseline_name TEXT NOT NULL DEFAULT 'competitor-analysis-v1',
  schema_version INTEGER NOT NULL DEFAULT 1,
  collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (domain, baseline_name)
);

CREATE INDEX IF NOT EXISTS idx_competitor_local_reviews_domain
  ON competitor_local_reviews (domain);

CREATE TABLE IF NOT EXISTS competitor_onpage_snapshots (
  id BIGSERIAL PRIMARY KEY,
  domain TEXT NOT NULL,
  page_url TEXT NOT NULL,
  keyword TEXT,
  title TEXT,
  h1 TEXT,
  meta_description TEXT,
  word_count INTEGER,
  schema_types JSONB DEFAULT '[]'::jsonb,
  page_type TEXT,
  collection_source TEXT NOT NULL DEFAULT 'live_dom',
  baseline_name TEXT NOT NULL DEFAULT 'competitor-analysis-v1',
  schema_version INTEGER NOT NULL DEFAULT 1,
  collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (domain, page_url, baseline_name)
);

CREATE INDEX IF NOT EXISTS idx_competitor_onpage_domain
  ON competitor_onpage_snapshots (domain);

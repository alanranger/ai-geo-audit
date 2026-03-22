-- Mirror of migrations/20260321_dfs_domain_backlink_index.sql for manual runs.

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

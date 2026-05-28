-- Phase C / Sub-phase C0: per-(date, page, query) GSC backfill tables.
--
-- Authoritative source for per-page-per-query analytics in the Revenue Truth
-- tab. gsc_page_timeseries (existing, ~5 months, page+date only) becomes a
-- secondary source for spot-check sanity only.
--
-- Property identifier in use: 'https://www.alanranger.com' (URL-prefix form),
-- matching gsc_timeseries / gsc_page_timeseries conventions.
--
-- Idempotent: this migration is safe to re-run.

CREATE TABLE IF NOT EXISTS gsc_page_query_daily (
  property_url    TEXT      NOT NULL,
  date            DATE      NOT NULL,
  page_url        TEXT      NOT NULL,
  query           TEXT      NOT NULL,
  clicks          INTEGER   NOT NULL DEFAULT 0,
  impressions     INTEGER   NOT NULL DEFAULT 0,
  ctr             NUMERIC   NOT NULL DEFAULT 0,     -- 0..1 fraction (GSC API convention)
  position        NUMERIC,                          -- nullable: undefined when impressions=0
  ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (property_url, date, page_url, query)
);

COMMENT ON TABLE gsc_page_query_daily IS
  'Per-(date, page_url, query) GSC Search Analytics rows for analytics overlay. '
  'Backfilled 2025-01-13 onwards (GSC retention floor). Authoritative source for the '
  'Phase C funnel diagnosis. ctr stored as 0..1 fraction.';

COMMENT ON COLUMN gsc_page_query_daily.page_url IS
  'Full URL exactly as returned by GSC (e.g. https://www.alanranger.com/path). '
  'Normalise to slug before joining canonical_products.service_page_url.';

CREATE INDEX IF NOT EXISTS gsc_pqd_page_date_idx
  ON gsc_page_query_daily (property_url, page_url, date);

CREATE INDEX IF NOT EXISTS gsc_pqd_query_date_idx
  ON gsc_page_query_daily (property_url, query, date);

CREATE INDEX IF NOT EXISTS gsc_pqd_date_idx
  ON gsc_page_query_daily (property_url, date);


CREATE TABLE IF NOT EXISTS gsc_backfill_runs (
  run_id            TEXT        PRIMARY KEY,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ,
  status            TEXT        NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running','completed','failed','skipped')),
  date_range_start  DATE        NOT NULL,
  date_range_end    DATE        NOT NULL,
  rows_inserted     INTEGER     NOT NULL DEFAULT 0,
  rows_upserted     INTEGER     NOT NULL DEFAULT 0,
  api_calls         INTEGER     NOT NULL DEFAULT 0,
  error_message     TEXT,
  notes             TEXT
);

COMMENT ON TABLE gsc_backfill_runs IS
  'Audit trail for the gsc_page_query_daily backfill. One row per weekly chunk '
  '(or per full-run rerun). Used for idempotency and resumability.';

CREATE INDEX IF NOT EXISTS gsc_backfill_runs_range_idx
  ON gsc_backfill_runs (date_range_start, date_range_end);

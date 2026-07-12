-- Per-keyword SERP tracking location (DataForSEO location_name).
-- NULL on historical rows = legacy national (United Kingdom / 2826).
-- Do not backfill guesses.

ALTER TABLE keyword_rankings
  ADD COLUMN IF NOT EXISTS location_name TEXT;

COMMENT ON COLUMN keyword_rankings.location_name IS
  'DataForSEO SERP location_name used for this row (e.g. United Kingdom or Coventry,England,United Kingdom). NULL = legacy national.';

CREATE INDEX IF NOT EXISTS idx_keyword_rankings_location_name
  ON keyword_rankings (location_name);

-- Flag keywords not present in the locked tracking-location map.
-- Defaults to UK national collection; dashboard shows "UK (unmapped)".

ALTER TABLE keyword_rankings
  ADD COLUMN IF NOT EXISTS location_unmapped BOOLEAN DEFAULT false;

COMMENT ON COLUMN keyword_rankings.location_unmapped IS
  'True when keyword was not in keyword-tracking-locations-LOCKED.csv and defaulted to United Kingdom.';

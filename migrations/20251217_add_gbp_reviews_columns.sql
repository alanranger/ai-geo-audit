-- Add GBP rating and review count columns to audit_results table
-- These fields are returned by the local-signals API but weren't being stored

ALTER TABLE audit_results
ADD COLUMN IF NOT EXISTS gbp_rating DECIMAL(3,2),
ADD COLUMN IF NOT EXISTS gbp_review_count INTEGER;

-- Add comment
COMMENT ON COLUMN audit_results.gbp_rating IS 'Google Business Profile rating (0-5)';
COMMENT ON COLUMN audit_results.gbp_review_count IS 'Google Business Profile total review count';


-- Add segment metadata columns to keyword_rankings table
-- These columns support intent-based keyword segmentation with manual override capability

-- Add segment_source column (tracks how segment was assigned: 'auto' or 'manual')
ALTER TABLE keyword_rankings
ADD COLUMN IF NOT EXISTS segment_source TEXT DEFAULT 'auto';

-- Add segment_confidence column (0-1, indicates confidence in auto-classification)
ALTER TABLE keyword_rankings
ADD COLUMN IF NOT EXISTS segment_confidence NUMERIC(3, 2) DEFAULT 0.5;

-- Add segment_reason column (explains why keyword was classified this way)
ALTER TABLE keyword_rankings
ADD COLUMN IF NOT EXISTS segment_reason TEXT;

-- Create index on segment_source for efficient filtering of manual vs auto segments
CREATE INDEX IF NOT EXISTS idx_keyword_rankings_segment_source 
ON keyword_rankings(segment_source);

-- Update existing rows to have segment_source='auto' if not set
UPDATE keyword_rankings
SET segment_source = 'auto'
WHERE segment_source IS NULL;

-- Add comment to document the columns
COMMENT ON COLUMN keyword_rankings.segment_source IS 'Source of segment classification: auto (intent-based rules) or manual (user override)';
COMMENT ON COLUMN keyword_rankings.segment_confidence IS 'Confidence score (0-1) for auto-classification. Higher values indicate stronger match to intent rules.';
COMMENT ON COLUMN keyword_rankings.segment_reason IS 'Explanation of why keyword was classified into this segment (e.g., "money: contains lessons")';


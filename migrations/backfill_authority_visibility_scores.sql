-- Migration: Backfill historical Authority and Visibility scores
-- 
-- This migration calculates Authority and Visibility scores for all historical
-- audit records that are missing these values, using GSC data from gsc_timeseries
-- or fallback to stored gsc_avg_position and gsc_ctr in audit_results.
--
-- Calculation formulas match the dashboard logic:
-- - Visibility: Based on position score (clamped 1-40, scaled to 0-100)
-- - Authority: Simplified calculation using position and CTR (when topQueries not available)

-- Step 1: Create a temporary function to calculate position score
CREATE OR REPLACE FUNCTION calculate_position_score(position_val NUMERIC)
RETURNS NUMERIC AS $$
DECLARE
  clamped_pos NUMERIC;
  scale NUMERIC;
  pos_score NUMERIC;
BEGIN
  -- Clamp position between 1 and 40
  clamped_pos := GREATEST(1, LEAST(40, position_val));
  -- Calculate scale (0 to 1)
  scale := (clamped_pos - 1) / 39;
  -- Calculate position score (100 to 10)
  pos_score := 100 - (scale * 90);
  RETURN pos_score;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Step 2: Create a temporary function to calculate CTR score
CREATE OR REPLACE FUNCTION calculate_ctr_score(ctr_val NUMERIC)
RETURNS NUMERIC AS $$
DECLARE
  ctr_decimal NUMERIC;
  ctr_score NUMERIC;
BEGIN
  -- Normalize CTR: if > 1, assume it's a percentage and convert to decimal
  IF ctr_val > 1 THEN
    ctr_decimal := ctr_val / 100;
  ELSE
    ctr_decimal := ctr_val;
  END IF;
  -- Calculate CTR score: (ctr / 0.10) * 100, capped at 100
  ctr_score := LEAST((ctr_decimal / 0.10) * 100, 100);
  RETURN ctr_score;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Step 3: Create a temporary function to calculate Visibility score
CREATE OR REPLACE FUNCTION calculate_visibility_score(position_val NUMERIC)
RETURNS INTEGER AS $$
DECLARE
  pos_score NUMERIC;
BEGIN
  pos_score := calculate_position_score(position_val);
  -- Clamp between 0 and 100, round to integer
  RETURN GREATEST(0, LEAST(100, ROUND(pos_score)));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Step 4: Create a temporary function to calculate Authority score
CREATE OR REPLACE FUNCTION calculate_authority_score(position_val NUMERIC, ctr_val NUMERIC)
RETURNS INTEGER AS $$
DECLARE
  pos_score NUMERIC;
  ctr_score NUMERIC;
  estimated_behaviour_score NUMERIC;
  estimated_ranking_score NUMERIC;
  estimated_share_score NUMERIC;
  estimated_ranking NUMERIC;
  backlink_score NUMERIC;
  review_score NUMERIC;
  authority NUMERIC;
BEGIN
  pos_score := calculate_position_score(position_val);
  ctr_score := calculate_ctr_score(ctr_val);
  
  -- Simplified Authority calculation (same as dashboard fallback)
  estimated_behaviour_score := LEAST(ctr_score * 0.7, 70);
  estimated_ranking_score := pos_score * 0.6;
  estimated_share_score := 20;
  estimated_ranking := estimated_ranking_score + estimated_share_score;
  
  -- Placeholders (since we don't have historical backlink/review data)
  backlink_score := 50;
  review_score := 50;
  
  authority := (0.4 * estimated_behaviour_score) +
               (0.2 * estimated_ranking) +
               (0.2 * backlink_score) +
               (0.2 * review_score);
  
  -- Clamp between 0 and 100, round to integer
  RETURN GREATEST(0, LEAST(100, ROUND(authority)));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Step 5: Update Visibility scores for records with position data
UPDATE audit_results ar
SET visibility_score = calculate_visibility_score(
  COALESCE(
    (SELECT position::NUMERIC FROM gsc_timeseries gsc 
     WHERE gsc.property_url = ar.property_url AND gsc.date = ar.audit_date LIMIT 1),
    ar.gsc_avg_position::NUMERIC
  )
)
WHERE ar.property_url = 'https://www.alanranger.com'
  AND ar.visibility_score IS NULL
  AND (
    EXISTS (
      SELECT 1 FROM gsc_timeseries gsc 
      WHERE gsc.property_url = ar.property_url 
        AND gsc.date = ar.audit_date 
        AND gsc.position IS NOT NULL
    )
    OR ar.gsc_avg_position IS NOT NULL
  );

-- Step 6: Update Authority scores for records with position and CTR data
UPDATE audit_results ar
SET authority_score = calculate_authority_score(
  COALESCE(
    (SELECT position::NUMERIC FROM gsc_timeseries gsc 
     WHERE gsc.property_url = ar.property_url AND gsc.date = ar.audit_date LIMIT 1),
    ar.gsc_avg_position::NUMERIC
  ),
  COALESCE(
    (SELECT ctr::NUMERIC FROM gsc_timeseries gsc 
     WHERE gsc.property_url = ar.property_url AND gsc.date = ar.audit_date LIMIT 1),
    ar.gsc_ctr::NUMERIC
  )
)
WHERE ar.property_url = 'https://www.alanranger.com'
  AND ar.authority_score IS NULL
  AND (
    EXISTS (
      SELECT 1 FROM gsc_timeseries gsc 
      WHERE gsc.property_url = ar.property_url 
        AND gsc.date = ar.audit_date 
        AND gsc.position IS NOT NULL 
        AND gsc.ctr IS NOT NULL
    )
    OR (ar.gsc_avg_position IS NOT NULL AND ar.gsc_ctr IS NOT NULL)
  );

-- Step 7: Clean up temporary functions (optional - can keep them for future use)
-- DROP FUNCTION IF EXISTS calculate_authority_score(NUMERIC, NUMERIC);
-- DROP FUNCTION IF EXISTS calculate_visibility_score(NUMERIC);
-- DROP FUNCTION IF EXISTS calculate_ctr_score(NUMERIC);
-- DROP FUNCTION IF EXISTS calculate_position_score(NUMERIC);

-- Verification query: Check how many records were updated
SELECT 
  COUNT(*) FILTER (WHERE visibility_score IS NOT NULL) as visibility_populated,
  COUNT(*) FILTER (WHERE authority_score IS NOT NULL) as authority_populated,
  COUNT(*) as total_records
FROM audit_results
WHERE property_url = 'https://www.alanranger.com';


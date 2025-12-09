-- Migration: Add money_segment_metrics column to audit_results table
-- Phase: Money Pages Priority Matrix + 12-Month KPI Tracker
-- Run this in Supabase SQL editor to add Money Pages segment metrics for KPI tracking

-- Check if column exists, and add it if it doesn't
DO $$
BEGIN
  -- Check if money_segment_metrics column exists
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'audit_results' 
    AND column_name = 'money_segment_metrics'
  ) THEN
    -- Add the column
    ALTER TABLE audit_results 
    ADD COLUMN money_segment_metrics JSONB;
    
    RAISE NOTICE 'Column money_segment_metrics added successfully';
  ELSE
    RAISE NOTICE 'Column money_segment_metrics already exists';
  END IF;
END $$;

-- Verify the column exists
SELECT 
  column_name, 
  data_type, 
  is_nullable
FROM information_schema.columns
WHERE table_name = 'audit_results'
AND column_name = 'money_segment_metrics'
ORDER BY column_name;

-- Column structure:
-- money_segment_metrics JSONB
-- Contains: {
--   "allMoney": {clicks, impressions, ctr, avgPosition, behaviourScore},
--   "landingPages": {clicks, impressions, ctr, avgPosition, behaviourScore},
--   "eventPages": {clicks, impressions, ctr, avgPosition, behaviourScore},
--   "productPages": {clicks, impressions, ctr, avgPosition, behaviourScore}
-- }



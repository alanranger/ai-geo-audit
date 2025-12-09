-- Verification script: Check if all Money Pages columns exist in audit_results table
-- Run this in Supabase SQL editor to verify the schema

-- Check all Money Pages related columns
SELECT 
  column_name, 
  data_type,
  is_nullable,
  CASE 
    WHEN column_name IN ('money_pages_metrics', 'money_pages_summary', 'money_segment_metrics') THEN 'JSONB'
    WHEN column_name = 'money_pages_behaviour_score' THEN 'INTEGER'
    ELSE 'OTHER'
  END as expected_type
FROM information_schema.columns
WHERE table_name = 'audit_results'
AND column_name IN (
  'money_pages_metrics',
  'money_pages_summary', 
  'money_pages_behaviour_score',
  'money_segment_metrics'
)
ORDER BY column_name;

-- If any columns are missing, you'll see fewer than 4 rows
-- Expected result: 4 rows
-- 
-- Column details:
-- 1. money_pages_metrics (JSONB) - Main Money Pages data with {overview: {...}, rows: [...]}
-- 2. money_pages_summary (JSONB) - Summary for trend tracking
-- 3. money_pages_behaviour_score (INTEGER) - Behaviour score for trends
-- 4. money_segment_metrics (JSONB) - Segment metrics for KPI tracker


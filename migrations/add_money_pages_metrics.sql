-- Migration: Add money_pages_metrics column to audit_results table
-- Run this in Supabase SQL editor if the column doesn't exist

-- Check if column exists, and add it if it doesn't
DO $$
BEGIN
  -- Check if money_pages_metrics column exists
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'audit_results' 
    AND column_name = 'money_pages_metrics'
  ) THEN
    -- Add the column
    ALTER TABLE audit_results 
    ADD COLUMN money_pages_metrics JSONB;
    
    RAISE NOTICE 'Column money_pages_metrics added successfully';
  ELSE
    RAISE NOTICE 'Column money_pages_metrics already exists';
  END IF;
END $$;

-- Verify the column exists
SELECT 
  column_name, 
  data_type, 
  is_nullable
FROM information_schema.columns 
WHERE table_name = 'audit_results' 
AND column_name = 'money_pages_metrics';


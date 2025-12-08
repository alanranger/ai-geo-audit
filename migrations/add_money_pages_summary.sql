-- Migration: Add money_pages_summary and money_pages_behaviour_score columns to audit_results table (Phase 3)
-- Run this in Supabase SQL editor to add Money Pages trend tracking columns

-- Check if columns exist, and add them if they don't
DO $$
BEGIN
  -- Check if money_pages_summary column exists
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'audit_results' 
    AND column_name = 'money_pages_summary'
  ) THEN
    -- Add the column
    ALTER TABLE audit_results 
    ADD COLUMN money_pages_summary JSONB;
    
    RAISE NOTICE 'Column money_pages_summary added successfully';
  ELSE
    RAISE NOTICE 'Column money_pages_summary already exists';
  END IF;
  
  -- Check if money_pages_behaviour_score column exists
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'audit_results' 
    AND column_name = 'money_pages_behaviour_score'
  ) THEN
    -- Add the column
    ALTER TABLE audit_results 
    ADD COLUMN money_pages_behaviour_score INTEGER;
    
    RAISE NOTICE 'Column money_pages_behaviour_score added successfully';
  ELSE
    RAISE NOTICE 'Column money_pages_behaviour_score already exists';
  END IF;
END $$;

-- Verify the columns exist
SELECT 
  column_name, 
  data_type, 
  is_nullable
FROM information_schema.columns
WHERE table_name = 'audit_results'
AND column_name IN ('money_pages_summary', 'money_pages_behaviour_score')
ORDER BY column_name;


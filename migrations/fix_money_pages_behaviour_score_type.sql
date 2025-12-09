-- Migration: Fix money_pages_behaviour_score column type from INTEGER to NUMERIC
-- Run this in Supabase SQL editor to fix the data type mismatch

-- Alter the column type to NUMERIC to support decimal values
DO $$
BEGIN
  -- Check if column exists and is INTEGER type
  IF EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'audit_results' 
    AND column_name = 'money_pages_behaviour_score'
    AND data_type = 'integer'
  ) THEN
    -- Alter the column type to NUMERIC
    ALTER TABLE audit_results 
    ALTER COLUMN money_pages_behaviour_score TYPE NUMERIC USING money_pages_behaviour_score::NUMERIC;
    
    RAISE NOTICE 'Column money_pages_behaviour_score type changed from INTEGER to NUMERIC successfully';
  ELSIF EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'audit_results' 
    AND column_name = 'money_pages_behaviour_score'
  ) THEN
    RAISE NOTICE 'Column money_pages_behaviour_score already exists but is not INTEGER type';
  ELSE
    RAISE NOTICE 'Column money_pages_behaviour_score does not exist';
  END IF;
END $$;

-- Verify the column type
SELECT 
  column_name, 
  data_type,
  numeric_precision,
  numeric_scale,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'audit_results'
AND column_name = 'money_pages_behaviour_score';


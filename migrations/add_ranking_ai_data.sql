-- Migration: Add ranking_ai_data column to audit_results table
-- Phase: Ranking & AI Visibility Tab
-- Run this in Supabase SQL editor to add Ranking & AI data storage

-- Check if column exists, and add it if it doesn't
DO $$
BEGIN
  -- Check if ranking_ai_data column exists
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'audit_results' 
    AND column_name = 'ranking_ai_data'
  ) THEN
    -- Add the column
    ALTER TABLE audit_results 
    ADD COLUMN ranking_ai_data JSONB;
    
    RAISE NOTICE 'Column ranking_ai_data added successfully';
  ELSE
    RAISE NOTICE 'Column ranking_ai_data already exists';
  END IF;
END $$;

-- Verify the column exists
SELECT 
  column_name, 
  data_type, 
  is_nullable
FROM information_schema.columns
WHERE table_name = 'audit_results'
AND column_name = 'ranking_ai_data'
ORDER BY column_name;

-- Column structure:
-- ranking_ai_data JSONB
-- Contains: {
--   "combinedRows": [
--     {
--       "keyword": string,
--       "segment": "brand" | "education" | "money" | "general",
--       "best_rank_group": number | null,
--       "best_rank_absolute": number | null,
--       "best_url": string | null,
--       "best_title": string,
--       "has_ai_overview": boolean,
--       "ai_total_citations": number,
--       "ai_alan_citations_count": number,
--       "ai_alan_citations": array,
--       "ai_sample_citations": array,
--       "serp_features": {
--         "has_ai_overview": boolean,
--         "has_local_pack": boolean,
--         "has_featured_snippet": boolean,
--         "has_people_also_ask": boolean
--       },
--       "competitor_counts": object
--     }
--   ],
--   "summary": {
--     "totalKeywords": number,
--     "withRank": number,
--     "withAiOverview": number,
--     "withAiCitation": number,
--     "top10": number,
--     "top3": number
--   },
--   "lastRunTimestamp": string (ISO 8601)
-- }


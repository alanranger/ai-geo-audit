-- Fix Dec 13 anomalous data (double clicks/impressions)
-- This audit has roughly double the normal values, indicating a data collection error
-- We'll halve the clicks and impressions to match the pattern of surrounding days

UPDATE audit_results
SET 
  gsc_clicks = ROUND(gsc_clicks / 2.0),
  gsc_impressions = ROUND(gsc_impressions / 2.0),
  updated_at = NOW()
WHERE property_url = 'https://www.alanranger.com'
  AND audit_date = '2025-12-13'
  AND gsc_clicks > 10000; -- Only fix if clearly anomalous (>10k clicks is double normal)

-- Verification query (run after update to confirm)
-- SELECT audit_date, gsc_clicks, gsc_impressions, gsc_avg_position, gsc_ctr
-- FROM audit_results
-- WHERE property_url = 'https://www.alanranger.com'
--   AND audit_date BETWEEN '2025-12-11' AND '2025-12-15'
-- ORDER BY audit_date;

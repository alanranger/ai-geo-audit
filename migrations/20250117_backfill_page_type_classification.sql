-- Backfill page_type and segment for all historical keyword_rankings
-- Uses the latest classification logic to fix stale values
-- This ensures Event/Product pages are correctly identified across all audit dates

-- Step 1: Update Event pages (check FIRST before other types)
UPDATE keyword_rankings
SET 
  page_type = 'Event',
  segment = 'Money'
WHERE 
  best_url IS NOT NULL
  AND (
    LOWER(best_url) LIKE '%/beginners-photography-lessons%' OR
    LOWER(best_url) LIKE '%/photographic-workshops-near-me%'
  )
  AND page_type != 'Event';

-- Step 2: Update Product pages (check SECOND, before Blog/GBP/Landing)
UPDATE keyword_rankings
SET 
  page_type = 'Product',
  segment = 'Money'
WHERE 
  best_url IS NOT NULL
  AND (
    LOWER(best_url) LIKE '%/photo-workshops-uk%' OR
    LOWER(best_url) LIKE '%/photography-services-near-me%'
  )
  AND page_type != 'Product';

-- Step 3: Update Blog pages (Education segment)
UPDATE keyword_rankings
SET 
  page_type = 'Blog',
  segment = 'Education'
WHERE 
  best_url IS NOT NULL
  AND (
    best_url LIKE '%/blog-on-photography/%' OR
    best_url LIKE '%/blogs/%'
  )
  AND page_type != 'Blog';

-- Step 4: Update GBP pages (Brand segment)
-- Check for home page, about, contact, reviews (EXACT matches only, not all domain pages)
UPDATE keyword_rankings
SET 
  page_type = 'GBP',
  segment = 'Brand'
WHERE 
  best_url IS NOT NULL
  AND (
    -- Exact home page (domain only or domain/)
    (best_url ~* '^https?://(www\.)?alanranger\.com/?(\?|$|#)') OR
    best_url LIKE '%/about-alan-ranger%' OR
    (best_url LIKE '%/contact%' AND NOT best_url LIKE '%/contact/%') OR
    (best_url LIKE '%/reviews%' AND NOT best_url LIKE '%/reviews/%')
  )
  AND page_type != 'GBP'
  -- Exclude Event/Product/Blog URLs
  AND NOT (
    LOWER(best_url) LIKE '%/beginners-photography-lessons%' OR
    LOWER(best_url) LIKE '%/photographic-workshops-near-me%' OR
    LOWER(best_url) LIKE '%/photo-workshops-uk%' OR
    LOWER(best_url) LIKE '%/photography-services-near-me%' OR
    best_url LIKE '%/blog-on-photography/%' OR
    best_url LIKE '%/blogs/%'
  );

-- Step 5: Update segment for Money pages (Landing, Event, Product should all be Money segment)
UPDATE keyword_rankings
SET segment = 'Money'
WHERE 
  page_type IN ('Landing', 'Event', 'Product')
  AND segment != 'Money';

-- Step 6: Update segment for Education pages (Blog should be Education segment)
UPDATE keyword_rankings
SET segment = 'Education'
WHERE 
  page_type = 'Blog'
  AND segment != 'Education';

-- Step 7: Update segment for Brand pages (GBP should be Brand segment)
UPDATE keyword_rankings
SET segment = 'Brand'
WHERE 
  page_type = 'GBP'
  AND segment != 'Brand';

-- Summary: Show what was updated
SELECT 
  'Event' as page_type,
  COUNT(*) as updated_count
FROM keyword_rankings
WHERE page_type = 'Event'
UNION ALL
SELECT 
  'Product' as page_type,
  COUNT(*) as updated_count
FROM keyword_rankings
WHERE page_type = 'Product'
UNION ALL
SELECT 
  'Blog' as page_type,
  COUNT(*) as updated_count
FROM keyword_rankings
WHERE page_type = 'Blog'
UNION ALL
SELECT 
  'GBP' as page_type,
  COUNT(*) as updated_count
FROM keyword_rankings
WHERE page_type = 'GBP'
ORDER BY page_type;


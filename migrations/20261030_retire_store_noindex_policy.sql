-- Retire store-page intentional_noindex rows (Alan, 30 Oct 2026).
-- Hiding /photo-workshops-uk in Squarespace also hid all 23 workshop products.
-- Rows kept (policy → indexed) as backup. Do NOT touch id 3 beginners prefix.
-- Project: igzvwbvgvmzvvzoclufx

UPDATE page_indexability_policy
SET policy = 'indexed',
    note = 'Retired 2026-10-30: Squarespace store hide also hid all product pages; stores must stay visible. Was intentional_noindex from 2026-06-04 (cannibaliser vs workshops/courses hubs).'
WHERE id IN (4, 5)
  AND url_or_prefix IN ('/photo-workshops-uk', '/photography-services-near-me')
  AND match_type = 'exact'
  AND policy = 'intentional_noindex';

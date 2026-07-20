-- Collection / legacy hub indexability (2026-06-04 Squarespace noindex decisions)
-- Project: igzvwbvgvmzvvzoclufx
-- photographic-workshops-near-me stays INDEXED — remove mistaken prefix noindex seed.

DELETE FROM page_indexability_policy
WHERE url_or_prefix = '/photographic-workshops-near-me'
  AND match_type = 'prefix';

INSERT INTO page_indexability_policy
  (url_or_prefix, match_type, policy, redirect_target, effective_date, note)
VALUES
  (
    '/photo-workshops-uk',
    'exact',
    'intentional_noindex',
    NULL,
    '2026-06-04',
    'Product collection hub; cannibaliser vs photography-workshops / landscape hubs. Detail product schema on child URLs unchanged.'
  ),
  (
    '/photography-services-near-me',
    'exact',
    'intentional_noindex',
    NULL,
    '2026-06-04',
    'Product collection hub; cannibaliser vs photography-courses-coventry. Detail product schema on child URLs unchanged.'
  )
ON CONFLICT (url_or_prefix, match_type) DO UPDATE SET
  policy = EXCLUDED.policy,
  effective_date = EXCLUDED.effective_date,
  note = EXCLUDED.note;

UPDATE page_indexability_policy
SET effective_date = '2026-06-04',
    note = COALESCE(note, '') || ' Squarespace noindex confirmed 2026-06-04.'
WHERE url_or_prefix = '/beginners-photography-lessons'
  AND match_type = 'prefix';

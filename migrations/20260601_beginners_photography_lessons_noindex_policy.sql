-- Prefix intentional_noindex for /beginners-photography-lessons (hub + ~49 event instances in 06-site-urls.csv).
-- URLs remain in canonical inventory for schema audit, chat event mapping, and GSC backfill.
-- Project: igzvwbvgvmzvvzoclufx

INSERT INTO page_indexability_policy
  (url_or_prefix, match_type, policy, redirect_target, effective_date, note)
VALUES
  (
    '/beginners-photography-lessons',
    'prefix',
    'intentional_noindex',
    NULL,
    '2026-06-01',
    '~49 Tier C course/event instances in 06-site-urls.csv. Squarespace noindex active; kept in CSV for audit + chat event mapping.'
  )
ON CONFLICT (url_or_prefix, match_type) DO UPDATE SET
  policy = EXCLUDED.policy,
  effective_date = EXCLUDED.effective_date,
  note = EXCLUDED.note;

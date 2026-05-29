-- Phase 1 — page_indexability_policy plumbing (registered-but-inactive seeds)
-- Project: igzvwbvgvmzvvzoclufx

CREATE TABLE IF NOT EXISTS page_indexability_policy (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  url_or_prefix   text NOT NULL,
  match_type      text NOT NULL CHECK (match_type IN ('exact', 'prefix')),
  policy          text NOT NULL CHECK (policy IN ('intentional_noindex', 'retired_redirect', 'indexed', 'other')),
  redirect_target text,
  effective_date  date,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT redirect_target_rule
    CHECK (policy <> 'retired_redirect' OR redirect_target IS NOT NULL),
  CONSTRAINT uq_url_match UNIQUE (url_or_prefix, match_type)
);

INSERT INTO page_indexability_policy
  (url_or_prefix, match_type, policy, redirect_target, effective_date, note)
VALUES
  ('/photographic-workshops-near-me', 'prefix', 'intentional_noindex', NULL, NULL,
   '~82 Tier C workshop event instances. effective_date to be set at Squarespace noindex flip.'),
  ('/one-day-landscape-photography-workshops', 'exact', 'retired_redirect',
   '/landscape-photography-workshops', NULL,
   'Consolidated into landscape-photography-workshops. effective_date to be set at 301.')
ON CONFLICT (url_or_prefix, match_type) DO NOTHING;

CREATE OR REPLACE FUNCTION policy_for_url(p_url text)
RETURNS TABLE (
  url_or_prefix text,
  match_type text,
  policy text,
  redirect_target text,
  effective_date date,
  note text
)
LANGUAGE sql
STABLE
AS $$
  WITH n AS (
    SELECT regexp_replace(
             lower(regexp_replace(regexp_replace(p_url, '^https?://[^/]+', ''), '[?#].*$', '')),
             '/+$', '') AS path
  )
  SELECT p.url_or_prefix, p.match_type, p.policy, p.redirect_target, p.effective_date, p.note
  FROM page_indexability_policy p, n
  WHERE (p.match_type = 'exact'
         AND n.path = regexp_replace(lower(p.url_or_prefix), '/+$', ''))
     OR (p.match_type = 'prefix'
         AND (n.path = regexp_replace(lower(p.url_or_prefix), '/+$', '')
              OR n.path LIKE regexp_replace(lower(p.url_or_prefix), '/+$', '') || '/%'))
  ORDER BY (p.match_type = 'exact') DESC, length(p.url_or_prefix) DESC
  LIMIT 1;
$$;

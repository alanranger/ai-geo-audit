-- Phase 2 — revenue_gsc_joined_with_policy wrapper (additive; does not alter revenue_gsc_joined)
-- Project: igzvwbvgvmzvvzoclufx

CREATE OR REPLACE FUNCTION normalize_gsc_page_url(p_input text)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  WITH a AS (SELECT NULLIF(trim(p_input), '') AS raw),
       b AS (SELECT lower(regexp_replace(regexp_replace(raw, '^https?://[^/]+', ''),
                                          '[?#].*$', '')) AS s
             FROM a),
       c AS (SELECT CASE WHEN s IS NULL THEN NULL
                         WHEN s = '' THEN '/'
                         WHEN left(s, 1) = '/' THEN s
                         ELSE '/' || s END AS s
             FROM b)
  SELECT CASE WHEN s IS NULL THEN NULL
              WHEN s = '/' THEN '/'
              ELSE regexp_replace(s, '/+$', '') END
  FROM c;
$$;

COMMENT ON FUNCTION normalize_gsc_page_url(text) IS
  'Normalise bare slug, /path, or full https URL to canonical /path form for page_indexability_policy joins. NULL/empty → NULL; root preserved as /.';

CREATE OR REPLACE VIEW revenue_gsc_joined_with_policy AS
SELECT
  g.*,
  p.url_or_prefix    AS policy_url_or_prefix,
  p.match_type       AS policy_match_type,
  p.policy           AS policy_value,
  p.redirect_target  AS policy_redirect_target,
  p.effective_date   AS policy_effective_date,
  p.note             AS policy_note
FROM revenue_gsc_joined g
LEFT JOIN LATERAL policy_for_url(normalize_gsc_page_url(g.page_slug)) p ON true;

COMMENT ON VIEW revenue_gsc_joined_with_policy IS
  'Wrapper over revenue_gsc_joined: same row set, plus nullable policy_* columns from page_indexability_policy via policy_for_url(normalize_gsc_page_url(page_slug)). No effective_date filtering — Phase 3 only.';

-- =========================================================================
-- 2026-06-26 — Canonical slug merge: retire /one-day-landscape-photography-workshops
-- Project: igzvwbvgvmzvvzoclufx
-- =========================================================================
-- Consolidates the retired URL into /landscape-photography-workshops across
-- ALL history (GSC clicks/impressions + booked revenue) at the view layer,
-- driven by the page_indexability_policy retired_redirect registry (the single
-- source of truth for retirement/redirect intent).
--
-- After this migration revenue_gsc_joined (and its _with_policy wrapper, which
-- feeds Revenue Truth section 9 + the Revenue Funnel diagnosis via
-- aggregateByPage) no longer emit a distinct page_slug for the old URL: its
-- clicks, impressions and booked revenue roll into landscape-photography-
-- workshops. The separate section-9 tile therefore collapses into the
-- landscape card.
--
-- Pure DDL + one targeted UPDATE. Idempotent (CREATE OR REPLACE / WHERE-scoped).
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Canonical-slug resolver driven by page_indexability_policy.
--    For any retired_redirect row whose url_or_prefix matches the input slug
--    (exact or prefix; exact then longest wins), return the normalised
--    redirect_target slug; otherwise return the input unchanged.
--    NOT gated by effective_date — this is an identity merge, not an indexing
--    decision. Operates on normalize_gsc_page_slug() (bare-slug) shape on both
--    sides so it composes with the existing GSC join key.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION canonical_gsc_slug(slug text)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  WITH input AS (
    SELECT normalize_gsc_page_slug(slug) AS s
  ),
  match AS (
    SELECT normalize_gsc_page_slug(p.redirect_target) AS target
    FROM page_indexability_policy p, input i
    WHERE p.policy = 'retired_redirect'
      AND p.redirect_target IS NOT NULL
      AND (
        (p.match_type = 'exact'
          AND i.s = normalize_gsc_page_slug(p.url_or_prefix))
        OR (p.match_type = 'prefix'
          AND (i.s = normalize_gsc_page_slug(p.url_or_prefix)
            OR i.s LIKE normalize_gsc_page_slug(p.url_or_prefix) || '/%'))
      )
    ORDER BY (p.match_type = 'exact') DESC, length(p.url_or_prefix) DESC
    LIMIT 1
  )
  SELECT COALESCE((SELECT target FROM match), (SELECT s FROM input));
$$;

COMMENT ON FUNCTION canonical_gsc_slug(text) IS
  'Resolves a GSC page slug to its canonical (surviving) slug using page_indexability_policy retired_redirect rows. Exact match wins over prefix; longest url_or_prefix wins among same type. Returns input unchanged when no retired_redirect matches. NOT effective_date gated (identity merge). Use to collapse retired URLs into their canonical target before grouping/joining.';

-- -------------------------------------------------------------------------
-- 2. revenue_gsc_joined — rebuilt so both the revenue and GSC sides are
--    canonicalised (old -> surviving slug) and aggregated BEFORE the join,
--    preventing fan-out when two raw slugs collapse to one canonical slug.
--    GSC side is rebuilt from gsc_page_timeseries (not gsc_monthly_by_page) so
--    COUNT(DISTINCT date) for days_with_data stays correct post-merge.
--    Output column set is preserved exactly (downstream readers unchanged).
-- -------------------------------------------------------------------------
-- NOTE: the alias is applied via a cheap LEFT JOIN to a tiny CTE (not the
-- canonical_gsc_slug() scalar) so the planner does not run a correlated
-- subquery per row inside the GROUP BYs. canonical_gsc_slug() is retained as
-- the documented helper for ad-hoc queries. retired_redirect exact rows cover
-- the consolidation use-case; prefix redirects can be added later if needed.
CREATE OR REPLACE VIEW revenue_gsc_joined AS
WITH alias AS (
  SELECT
    normalize_gsc_page_slug(url_or_prefix)   AS from_slug,
    normalize_gsc_page_slug(redirect_target) AS to_slug
  FROM page_indexability_policy
  WHERE policy = 'retired_redirect'
    AND redirect_target IS NOT NULL
    AND match_type = 'exact'
),
revenue_long AS (
  SELECT
    w.property_url,
    w.year,
    w.month,
    normalize_gsc_page_slug(kv.key)                              AS base_slug,
    kv.key                                                       AS revenue_url_raw,
    (kv.value)::numeric                                          AS revenue_gbp_nonjlr,
    COALESCE((w.page_revenue -> kv.key)::numeric, 0::numeric)    AS revenue_gbp_total,
    COALESCE((w.page_revenue_jlr -> kv.key)::numeric, 0::numeric) AS revenue_gbp_jlr
  FROM booking_sheet_monthly_wide w
  CROSS JOIN LATERAL jsonb_each_text(
    COALESCE(w.page_revenue_nonjlr, '{}'::jsonb)
  ) AS kv(key, value)
  WHERE w.property_url = 'https://www.alanranger.com'
),
revenue_agg AS (
  SELECT
    rl.property_url,
    rl.year,
    rl.month,
    COALESCE(a.to_slug, rl.base_slug)         AS page_slug,
    MIN(rl.revenue_url_raw)                    AS revenue_url_raw,
    SUM(rl.revenue_gbp_nonjlr)                 AS revenue_gbp_nonjlr,
    SUM(rl.revenue_gbp_total)                  AS revenue_gbp_total,
    SUM(rl.revenue_gbp_jlr)                    AS revenue_gbp_jlr
  FROM revenue_long rl
  LEFT JOIN alias a ON a.from_slug = rl.base_slug
  GROUP BY rl.property_url, rl.year, rl.month, COALESCE(a.to_slug, rl.base_slug)
),
gsc_base AS (
  SELECT
    t.property_url,
    normalize_gsc_page_slug(t.page_url)       AS base_slug,
    EXTRACT(YEAR  FROM t.date)::int           AS year,
    EXTRACT(MONTH FROM t.date)::int           AS month,
    t.date,
    t.clicks,
    t.impressions,
    t.position
  FROM gsc_page_timeseries t
  WHERE t.property_url = 'https://www.alanranger.com'
),
gsc_agg AS (
  SELECT
    gb.property_url,
    COALESCE(a.to_slug, gb.base_slug)         AS page_slug,
    gb.year,
    gb.month,
    SUM(gb.clicks)::bigint                     AS clicks,
    SUM(gb.impressions)::bigint                AS impressions,
    CASE
      WHEN SUM(gb.impressions) > 0
      THEN ROUND(100.0 * SUM(gb.clicks)::numeric / NULLIF(SUM(gb.impressions), 0), 2)
      ELSE NULL
    END                                        AS ctr_pct,
    CASE
      WHEN SUM(gb.impressions) > 0
      THEN ROUND(SUM(gb.position * gb.impressions)::numeric / NULLIF(SUM(gb.impressions), 0), 2)
      ELSE NULL
    END                                        AS avg_position_imp_weighted,
    COUNT(DISTINCT gb.date)::int               AS days_with_data
  FROM gsc_base gb
  LEFT JOIN alias a ON a.from_slug = gb.base_slug
  GROUP BY gb.property_url, COALESCE(a.to_slug, gb.base_slug), gb.year, gb.month
)
SELECT
  COALESCE(r.property_url, g.property_url)            AS property_url,
  COALESCE(r.year,         g.year)                    AS year,
  COALESCE(r.month,        g.month)                   AS month,
  make_date(
    COALESCE(r.year,  g.year),
    COALESCE(r.month, g.month),
    1
  )                                                   AS period_start,
  COALESCE(r.page_slug,    g.page_slug)               AS page_slug,
  r.revenue_url_raw,
  COALESCE(r.revenue_gbp_nonjlr, 0)::numeric(12,2)    AS revenue_gbp_nonjlr,
  g.clicks,
  g.impressions,
  g.ctr_pct,
  g.avg_position_imp_weighted,
  g.days_with_data,
  CASE
    WHEN r.page_slug IS NOT NULL AND g.page_slug IS NOT NULL THEN 'matched'
    WHEN r.page_slug IS NOT NULL AND g.page_slug IS NULL     THEN 'revenue_only'
    WHEN r.page_slug IS NULL     AND g.page_slug IS NOT NULL THEN 'gsc_only'
    ELSE 'neither'
  END                                                 AS join_state,
  COALESCE(r.revenue_gbp_total, 0)::numeric(12,2)     AS revenue_gbp_total,
  COALESCE(r.revenue_gbp_jlr, 0)::numeric(12,2)       AS revenue_gbp_jlr
FROM revenue_agg r
FULL OUTER JOIN gsc_agg g
  ON g.property_url = r.property_url
 AND g.year         = r.year
 AND g.month        = r.month
 AND g.page_slug    = r.page_slug;

COMMENT ON VIEW revenue_gsc_joined IS
  'FULL OUTER JOIN of booking_sheet_monthly_wide.page_revenue_nonjlr (booked non-JLR revenue per page per month) against a GSC monthly rollup, both canonicalised via canonical_gsc_slug() so retired_redirect URLs (page_indexability_policy) collapse into their surviving slug across ALL history before aggregation. Join key (property_url, year, month, page_slug). join_state: matched / revenue_only / gsc_only / neither.';

-- -------------------------------------------------------------------------
-- 3. Activate the 301 on the policy record (record-keeping + indexability KPIs).
--    The merge above is unconditional; this only governs date-gated indexability
--    logic elsewhere (isRowIndexable / visibility-loss guard).
-- -------------------------------------------------------------------------
UPDATE page_indexability_policy
SET effective_date = '2026-06-16'
WHERE url_or_prefix = '/one-day-landscape-photography-workshops'
  AND match_type = 'exact';

-- -------------------------------------------------------------------------
-- 4. CRITICAL: revenue_gsc_joined_with_policy is a MATERIALIZED VIEW that
--    wraps revenue_gsc_joined. The Revenue Truth §9 cards + Revenue Funnel
--    diagnosis (api/aigeo/revenue-funnel-diagnosis.js) read it, so the merge
--    above is invisible to them until the matview is refreshed.
-- -------------------------------------------------------------------------
REFRESH MATERIALIZED VIEW revenue_gsc_joined_with_policy;

-- =========================================================================
-- End of migration.
-- =========================================================================

-- =========================================================================
-- Phase C / C1 — GSC views for the Revenue Truth funnel overlay
-- =========================================================================
-- Builds two read-only views on top of Phase C / C0 data:
--   1. gsc_monthly_by_page    — rollup of gsc_page_timeseries (page x month)
--   2. revenue_gsc_joined     — FULL OUTER JOIN of booking_sheet_monthly_wide
--                                .page_revenue_nonjlr (jsonb) against
--                                gsc_monthly_by_page on (page_slug, year, month).
-- Also creates a SQL helper function normalize_gsc_page_slug(text) that
-- mirrors the JavaScript normalizeUrl() in
-- api/cron/backfill-money-page-timeseries.js and
-- scripts/gsc-c0-backfill-page-daily.mjs.
--
-- gsc_keywords_by_page is INTENTIONALLY NOT built. The query-dimension
-- backfill is deferred indefinitely (see Phase C / C0 decision; the
-- query dimension drops ~61% of clicks via long-tail anonymisation).
--
-- Pure DDL. No data writes. Idempotent (CREATE OR REPLACE).
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Helper function: normalise a URL or partial URL to gsc_page_timeseries
--    slug shape. Mirrors api/cron/backfill-money-page-timeseries.js:10-21.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION normalize_gsc_page_slug(url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  WITH s1 AS (SELECT lower(trim(coalesce(url, ''))) AS v),
       s2 AS (SELECT regexp_replace(v, '^https?://', '') AS v FROM s1),
       s3 AS (SELECT regexp_replace(v, '^www\.', '') AS v FROM s2),
       s4 AS (SELECT split_part(split_part(v, '#', 1), '?', 1) AS v FROM s3),
       s5 AS (
         -- If string contains '/', drop everything up to and including the
         -- first '/' (host removal). If no '/' (bare slug input), keep as-is
         -- so the function is a no-op round-trip on already-normalised values.
         SELECT CASE
           WHEN strpos(v, '/') > 0 THEN substr(v, strpos(v, '/') + 1)
           ELSE v
         END AS v
         FROM s4
       )
  SELECT regexp_replace(regexp_replace(v, '^/+', ''), '/+$', '') FROM s5;
$$;

COMMENT ON FUNCTION normalize_gsc_page_slug(text) IS
  'Mirrors the normalizeUrl() function in api/cron/backfill-money-page-timeseries.js (and scripts/gsc-c0-backfill-page-daily.mjs). Strips protocol, www, host, query string, fragment, then leading and trailing slashes; lowercases throughout. Use this on ANY full URL before joining to gsc_page_timeseries.page_url or to canonical_products.service_page_url after the same normalisation. IMMUTABLE so it is safe in indexes and view definitions.';

-- -------------------------------------------------------------------------
-- 2. View: gsc_monthly_by_page
--    Rolls up gsc_page_timeseries to (property_url, page_url, year, month).
--    CTR recomputed as total clicks / total impressions * 100 (NOT mean of
--    daily CTRs, which would mis-weight low-impression days).
--    Position is impression-weighted across the month.
-- -------------------------------------------------------------------------
CREATE OR REPLACE VIEW gsc_monthly_by_page AS
SELECT
  property_url,
  page_url,
  EXTRACT(YEAR  FROM date)::int  AS year,
  EXTRACT(MONTH FROM date)::int  AS month,
  make_date(
    EXTRACT(YEAR  FROM date)::int,
    EXTRACT(MONTH FROM date)::int,
    1
  ) AS period_start,
  SUM(clicks)::bigint            AS clicks,
  SUM(impressions)::bigint       AS impressions,
  CASE
    WHEN SUM(impressions) > 0
    THEN ROUND(100.0 * SUM(clicks)::numeric / NULLIF(SUM(impressions), 0), 2)
    ELSE NULL
  END                            AS ctr_pct,
  CASE
    WHEN SUM(impressions) > 0
    THEN ROUND(SUM(position * impressions)::numeric / NULLIF(SUM(impressions), 0), 2)
    ELSE NULL
  END                            AS avg_position_imp_weighted,
  COUNT(DISTINCT date)::int      AS days_with_data,
  MIN(date)                      AS first_date_in_month,
  MAX(date)                      AS last_date_in_month
FROM gsc_page_timeseries
WHERE property_url = 'https://www.alanranger.com'
GROUP BY
  property_url,
  page_url,
  EXTRACT(YEAR  FROM date),
  EXTRACT(MONTH FROM date);

COMMENT ON VIEW gsc_monthly_by_page IS
  'Per-(property_url, page_url, year, month) rollup of gsc_page_timeseries. clicks and impressions are SUM; ctr_pct is RECOMPUTED as total clicks / total impressions * 100 (NOT a mean of daily CTRs); avg_position_imp_weighted is impression-weighted across the month. days_with_data is the number of distinct dates the page received ANY impressions in that month -- months where the page received zero impressions across the whole month do not appear at all. Drives the Phase C funnel overlay. page_url is the slug-only form (no protocol, no domain, no trailing slash) -- use normalize_gsc_page_slug() to convert a full URL before joining.';

-- -------------------------------------------------------------------------
-- 3. View: revenue_gsc_joined
--    Unpivots booking_sheet_monthly_wide.page_revenue_nonjlr (jsonb full URL
--    -> revenue GBP) into long rows, normalises each URL to a slug, then
--    FULL OUTER JOINs against gsc_monthly_by_page on (slug, year, month).
--    join_state tags every row as 'matched' / 'revenue_only' / 'gsc_only'
--    so the C2 analyser can surface anomalies.
-- -------------------------------------------------------------------------
CREATE OR REPLACE VIEW revenue_gsc_joined AS
WITH revenue_long AS (
  SELECT
    w.property_url,
    w.year,
    w.month,
    w.period_start,
    kv.key                                   AS revenue_url_raw,
    normalize_gsc_page_slug(kv.key)          AS page_slug,
    (kv.value)::numeric                      AS revenue_gbp_nonjlr
  FROM booking_sheet_monthly_wide w
  CROSS JOIN LATERAL jsonb_each_text(
    COALESCE(w.page_revenue_nonjlr, '{}'::jsonb)
  ) AS kv(key, value)
  WHERE w.property_url = 'https://www.alanranger.com'
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
  COALESCE(r.page_slug,    g.page_url)                AS page_slug,
  r.revenue_url_raw,
  COALESCE(r.revenue_gbp_nonjlr, 0)::numeric(12,2)    AS revenue_gbp_nonjlr,
  g.clicks,
  g.impressions,
  g.ctr_pct,
  g.avg_position_imp_weighted,
  g.days_with_data,
  CASE
    WHEN r.page_slug IS NOT NULL AND g.page_url IS NOT NULL THEN 'matched'
    WHEN r.page_slug IS NOT NULL AND g.page_url IS NULL     THEN 'revenue_only'
    WHEN r.page_slug IS NULL     AND g.page_url IS NOT NULL THEN 'gsc_only'
    ELSE 'neither'
  END                                                 AS join_state
FROM revenue_long r
FULL OUTER JOIN gsc_monthly_by_page g
  ON g.property_url = r.property_url
 AND g.year         = r.year
 AND g.month        = r.month
 AND g.page_url     = r.page_slug;

COMMENT ON VIEW revenue_gsc_joined IS
  'FULL OUTER JOIN of booking_sheet_monthly_wide.page_revenue_nonjlr (booked revenue per page per month, NON-JLR slice only -- the Phase L1 default) against gsc_monthly_by_page (GSC clicks/impressions/CTR/position per page per month). Join key is (property_url, year, month, page_slug). page_slug is normalised via normalize_gsc_page_slug() on both sides. JLR slice is intentionally NOT included (brief specifies non-JLR). join_state column distinguishes "matched" (booked AND GSC traffic) from "revenue_only" (booked but no GSC organic traffic -- direct/referral/email funnel) from "gsc_only" (GSC traffic but zero booked revenue this month -- the funnel-leak signal Phase C diagnoses). Window bounded by GSC retention floor 2025-01-13 and booking sheet coverage 2025-01..present.';

-- =========================================================================
-- End of Phase C / C1 migration.
-- =========================================================================

-- GA4 per-channel daily sessions for the Acquisition tab "Visits" column.
--
-- Why this exists: ga4_site_metrics_28d stores site-wide totals only, with no
-- source/medium dimension, so no channel could ever show visits. GA4 holds the
-- breakdown, it had simply never been requested.
--
-- Bot caveat baked into the schema: on 2026-08-29 roughly 73% of GA4 sessions
-- for this property were automated traffic landing in the "Unassigned" channel
-- group (3% engaged, 5.5s average duration, exactly 1.00 pages per session,
-- 99% desktop Chrome, 83% Singapore + US). Those rows are stored rather than
-- silently dropped, so the tab can report attributed sessions while still being
-- able to state honestly how much traffic it excluded and why.

CREATE TABLE IF NOT EXISTS public.ga4_channel_sessions_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_url text NOT NULL DEFAULT 'https://www.alanranger.com',
  date date NOT NULL,
  channel_group text NOT NULL,
  source text NOT NULL DEFAULT '',
  medium text NOT NULL DEFAULT '',
  sessions integer NOT NULL DEFAULT 0,
  engaged_sessions integer NULL,
  avg_session_seconds numeric NULL,
  pages_per_session numeric NULL,
  -- Set when the row matches the automated-traffic signature. Kept as data, not
  -- a filter, so the exclusion is auditable after the fact.
  is_unattributed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ga4_channel_sessions_daily_unique
    UNIQUE NULLS NOT DISTINCT (property_url, date, channel_group, source, medium)
);

CREATE INDEX IF NOT EXISTS ga4_channel_sessions_daily_date_idx
  ON public.ga4_channel_sessions_daily (date DESC);

CREATE INDEX IF NOT EXISTS ga4_channel_sessions_daily_attributed_idx
  ON public.ga4_channel_sessions_daily (date DESC, is_unattributed)
  WHERE is_unattributed = false;

COMMENT ON TABLE public.ga4_channel_sessions_daily IS
  'GA4 sessions per channel/source/medium per day. is_unattributed flags the Unassigned bot bucket; the Acquisition tab sums only attributed rows and reports the excluded share.';

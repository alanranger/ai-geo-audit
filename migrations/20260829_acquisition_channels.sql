-- Acquisition — Channels (Phase 1 data layer)
--
-- Five channels feed the tab: Google organic (reuses gsc_page_timeseries),
-- ChatGPT (AI), Google AI, YouTube, Direct/referral. Only the AI + YouTube
-- channels need new storage; organic and the Academy outcome lens read
-- existing sources.
--
-- Reach units differ per channel (AI mentions vs video views vs impressions)
-- so they are stored separately and never summed. The UI ranks channels on
-- the common denominator (site visits / members produced).

-- ---------------------------------------------------------------------------
-- AI channels: DataForSEO llm_mentions
-- platform is limited to the only two the API supports: chat_gpt + google.
-- Gemini / Perplexity are NOT available from this source.
-- ---------------------------------------------------------------------------

-- Daily "where we are now" snapshot, one row per platform+location per day.
CREATE TABLE IF NOT EXISTS public.llm_mentions_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_url text NOT NULL DEFAULT 'https://www.alanranger.com',
  captured_date date NOT NULL,
  platform text NOT NULL,
  location_code integer NULL,
  mentions integer NULL,
  ai_search_volume bigint NULL,
  own_domain_mentions integer NULL,
  own_domain_ai_search_volume bigint NULL,
  top_sources jsonb NULL,
  cost_usd numeric NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT llm_mentions_daily_platform_chk
    CHECK (platform IN ('chat_gpt', 'google')),
  -- NULLS NOT DISTINCT is required, not cosmetic: location_code IS NULL means
  -- "all locations rolled up", and under the default NULLS DISTINCT the nightly
  -- upsert would insert a fresh rolled-up row every run instead of updating it.
  CONSTRAINT llm_mentions_daily_uniq
    UNIQUE NULLS NOT DISTINCT (property_url, captured_date, platform, location_code)
);

CREATE INDEX IF NOT EXISTS llm_mentions_daily_lookup_idx
  ON public.llm_mentions_daily (property_url, platform, captured_date DESC);

COMMENT ON TABLE public.llm_mentions_daily IS
  'Daily DataForSEO llm_mentions snapshot per AI platform (chat_gpt | google). Reach unit = mentions; NOT comparable to site visits and never summed with other channels.';
COMMENT ON COLUMN public.llm_mentions_daily.location_code IS
  'DataForSEO location code. NULL = all locations rolled up. 2826 = United Kingdom, 2840 = United States.';

-- Monthly history. DataForSEO llm_mentions/historical returns ~13 months, so
-- unlike YouTube this channel CAN be backfilled on first run.
CREATE TABLE IF NOT EXISTS public.llm_mentions_monthly (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_url text NOT NULL DEFAULT 'https://www.alanranger.com',
  platform text NOT NULL,
  month date NOT NULL,
  mentions integer NULL,
  ai_search_volume bigint NULL,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT llm_mentions_monthly_platform_chk
    CHECK (platform IN ('chat_gpt', 'google')),
  CONSTRAINT llm_mentions_monthly_uniq
    UNIQUE (property_url, platform, month)
);

CREATE INDEX IF NOT EXISTS llm_mentions_monthly_lookup_idx
  ON public.llm_mentions_monthly (property_url, platform, month DESC);

COMMENT ON TABLE public.llm_mentions_monthly IS
  'Monthly AI mention history from DataForSEO llm_mentions/historical (~13 months available, so backfilled on first run). month = first day of month.';

-- ---------------------------------------------------------------------------
-- YouTube channel
-- FORWARD-ONLY: the YouTube APIs expose current cumulative totals, not a
-- daily history we can backfill. Daily rows only exist from the first run.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.youtube_channel_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id text NOT NULL,
  captured_date date NOT NULL,
  channel_title text NULL,
  subscribers bigint NULL,
  total_views bigint NULL,
  total_videos integer NULL,
  -- Window metrics. impressions / impressions_ctr / clicks_to_site come from
  -- the YouTube ANALYTICS API (OAuth, channel owner) and stay NULL when only
  -- a Data API key is configured.
  window_days integer NULL,
  views_window bigint NULL,
  impressions_window bigint NULL,
  impressions_ctr_window numeric NULL,
  watch_time_minutes_window bigint NULL,
  clicks_to_site_window bigint NULL,
  source text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT youtube_channel_stats_uniq UNIQUE (channel_id, captured_date)
);

CREATE INDEX IF NOT EXISTS youtube_channel_stats_lookup_idx
  ON public.youtube_channel_stats (channel_id, captured_date DESC);

COMMENT ON TABLE public.youtube_channel_stats IS
  'Daily YouTube channel totals. FORWARD-ONLY from first run — YouTube exposes cumulative totals, not backfillable daily history.';
COMMENT ON COLUMN public.youtube_channel_stats.source IS
  'Which API populated the row: data_api (public stats only) or data_api+analytics_api (adds impressions / CTR / clicks-to-site).';

CREATE TABLE IF NOT EXISTS public.youtube_video_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id text NOT NULL,
  video_id text NOT NULL,
  captured_date date NOT NULL,
  title text NULL,
  published_at timestamptz NULL,
  views bigint NULL,
  likes bigint NULL,
  comments bigint NULL,
  impressions bigint NULL,
  impressions_ctr numeric NULL,
  clicks_to_site bigint NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT youtube_video_stats_uniq UNIQUE (video_id, captured_date)
);

CREATE INDEX IF NOT EXISTS youtube_video_stats_lookup_idx
  ON public.youtube_video_stats (channel_id, captured_date DESC, views DESC);

COMMENT ON TABLE public.youtube_video_stats IS
  'Daily per-video YouTube stats. FORWARD-ONLY from first run, same limitation as youtube_channel_stats.';

-- ---------------------------------------------------------------------------
-- Cron run log, so a silent failure is visible rather than assumed healthy.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.acquisition_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  status text NOT NULL DEFAULT 'running',
  trigger_source text NULL,
  rows_written integer NULL,
  cost_usd numeric NULL,
  error_message text NULL,
  meta jsonb NULL
);

CREATE INDEX IF NOT EXISTS acquisition_sync_runs_job_idx
  ON public.acquisition_sync_runs (job, started_at DESC);

COMMENT ON TABLE public.acquisition_sync_runs IS
  'Run log for the Acquisition channel nightly pulls (llm_mentions, youtube). status: running | ok | error | skipped.';

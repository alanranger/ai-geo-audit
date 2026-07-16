-- Standalone LLM / ChatGPT AI Visibility (separate from Google AIO)
CREATE TABLE IF NOT EXISTS public.llm_visibility_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_url text NOT NULL DEFAULT 'https://www.alanranger.com',
  run_at timestamptz NOT NULL DEFAULT now(),
  cadence text NULL,
  domain_mentions jsonb NULL,
  historical jsonb NULL,
  aggregated jsonb NULL,
  prompt_results jsonb NULL,
  topic_competitors jsonb NULL,
  cost_usd numeric NULL,
  meta jsonb NULL
);

CREATE INDEX IF NOT EXISTS llm_visibility_snapshots_run_at_idx
  ON public.llm_visibility_snapshots (property_url, run_at DESC);

COMMENT ON TABLE public.llm_visibility_snapshots IS
  'Standalone LLM answers visibility (ChatGPT/mentions) — NOT Google AI Overviews.';

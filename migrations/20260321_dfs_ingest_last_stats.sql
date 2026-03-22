-- Last-run domain ingest counters (for Traditional SEO Backlinks tile).
-- Run in Supabase SQL editor (idempotent).

ALTER TABLE public.dfs_backlink_ingest_state
ADD COLUMN IF NOT EXISTS last_ingest_action TEXT,
ADD COLUMN IF NOT EXISTS last_ingest_api_items INTEGER,
ADD COLUMN IF NOT EXISTS last_ingest_rows_stored INTEGER,
ADD COLUMN IF NOT EXISTS last_ingest_at TIMESTAMPTZ;

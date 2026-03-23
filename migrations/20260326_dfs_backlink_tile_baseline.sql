-- DFS Backlinks dashboard: saved tile snapshot per domain for audit-to-audit deltas.
-- Apply in Supabase SQL editor. API: /api/aigeo/dfs-backlink-tile-baseline (service role).

CREATE TABLE IF NOT EXISTS public.dfs_backlink_tile_baseline (
  domain_host TEXT PRIMARY KEY,
  snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dfs_backlink_tile_baseline_saved_at_idx
  ON public.dfs_backlink_tile_baseline (saved_at DESC);

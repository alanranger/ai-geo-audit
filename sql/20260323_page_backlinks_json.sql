-- Store Keywords Everywhere get_page_backlinks row payload (sample) for UI drill-down.
-- Apply in Supabase SQL editor (AI GEO Audit project).

alter table public.keyword_target_metrics_cache
  add column if not exists page_backlinks_json jsonb;

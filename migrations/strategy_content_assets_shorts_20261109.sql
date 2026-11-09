-- YouTube Shorts as shared content records (question 2026-11-09 (f) youtube-shorts-in-shared-content-records).
-- Extends the EXISTING quarter-plan content store (no competing table):
--   format          content format, separate from editorial purpose ('short_video' = "Short video / reel")
--   purpose         editorial purpose of the asset itself (educate / inspire / nurture / sell) + where it came from
--   uses            each use of the asset with its own channel, ref and planned time (YouTube release, email module,
--                   native social only if planned); used_in keeps the refs for existing readers
--   provider_state  the latest READ-ONLY provider read (YouTube Data API videos.list status + processingDetails);
--                   a failed read keeps the last good state and records the error (never zeroed)
alter table public.strategy_content_assets
  add column if not exists format text,
  add column if not exists purpose text,
  add column if not exists purpose_source text,
  add column if not exists uses jsonb not null default '[]'::jsonb,
  add column if not exists provider_state jsonb;

do $$ begin
  alter table public.strategy_content_assets add constraint strategy_content_assets_format_chk check (format is null or format in ('short_video', 'long_video', 'image', 'carousel', 'article', 'email_module'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.strategy_content_assets add constraint strategy_content_assets_purpose_chk check (purpose is null or purpose in ('educate', 'inspire', 'nurture', 'sell'));
exception when duplicate_object then null; end $$;

comment on column public.strategy_content_assets.uses is 'Each use: { use_key, channel (youtube|email|facebook|instagram|linkedin), ref, planned_at, module_state?, note? }. Status is computed from the provider / delivery, never stored here.';
comment on column public.strategy_content_assets.provider_state is 'Latest read-only provider read (YouTube videos.list status + processingDetails). Never written by viewing.';

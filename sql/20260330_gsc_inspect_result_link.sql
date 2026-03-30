-- Official Search Console URL from URL Inspection API (inspectionResult.inspectionResultLink).
alter table public.gsc_url_inspection_cache
  add column if not exists inspect_result_link text;

comment on column public.gsc_url_inspection_cache.inspect_result_link is
  'Google-provided deep link to URL Inspection UI (includes id=). From API inspectionResult.inspectionResultLink.';

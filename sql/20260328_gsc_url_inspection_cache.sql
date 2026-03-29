-- GSC URL Inspection cache (per property + URL key). Populated by /api/aigeo/gsc-url-inspection.
-- Run in Supabase SQL editor for project used by AI GEO Audit dashboard.

create table if not exists public.gsc_url_inspection_cache (
  property_key text not null,
  url_key text not null,
  page_url text not null,
  coverage_state text,
  verdict text,
  page_fetch_state text,
  google_canonical text,
  http_ok boolean,
  api_error jsonb,
  audit_status text not null default 'warn',
  indexed boolean not null default false,
  inspected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (property_key, url_key)
);

create index if not exists gsc_url_inspection_cache_property_idx
  on public.gsc_url_inspection_cache (property_key);

comment on table public.gsc_url_inspection_cache is 'Google Search Console URL Inspection results keyed like Traditional SEO signal map keys.';

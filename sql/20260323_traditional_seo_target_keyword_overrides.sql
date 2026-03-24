-- Per-URL target keyword overrides for Traditional SEO (K1–K5). Merged after CSV 07 from GitHub.
-- Apply in Supabase SQL editor if not using migrations runner.

create table if not exists traditional_seo_target_keyword_overrides (
  id uuid primary key default gen_random_uuid(),
  property_url text not null default '',
  page_url text not null,
  target_keyword text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_url, page_url)
);

create index if not exists idx_trad_seo_kw_overrides_property
  on traditional_seo_target_keyword_overrides (property_url);

create index if not exists idx_trad_seo_kw_overrides_page
  on traditional_seo_target_keyword_overrides (property_url, page_url);

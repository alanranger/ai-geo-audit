-- Per-URL admin bypasses for Traditional SEO rules (stored server-side).
-- Apply in Supabase SQL editor if not using migrations runner.

create table if not exists traditional_seo_rule_overrides (
  id uuid primary key default gen_random_uuid(),
  property_url text not null default '',
  page_url text not null,
  rule_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_url, page_url, rule_key)
);

create index if not exists idx_trad_seo_rule_overrides_property
  on traditional_seo_rule_overrides (property_url);

create index if not exists idx_trad_seo_rule_overrides_page
  on traditional_seo_rule_overrides (property_url, page_url);

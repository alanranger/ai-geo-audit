-- Traditional SEO: configurable weighted rules + score snapshots

create table if not exists public.traditional_seo_rules (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null unique,
  rule_name text not null,
  description text,
  category text not null default 'general',
  severity text not null default 'medium',
  scope text not null default 'sitewide',
  current_status text not null default 'pass',
  enabled boolean not null default true,
  weight numeric(6,2) not null default 1.0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_traditional_seo_rules_category
  on public.traditional_seo_rules (category);

create table if not exists public.traditional_seo_score_snapshots (
  id uuid primary key default gen_random_uuid(),
  property_url text,
  score integer not null,
  delta numeric(6,2),
  rules_total integer not null default 0,
  enabled_rules integer not null default 0,
  pass_count integer not null default 0,
  warn_count integer not null default 0,
  fail_count integer not null default 0,
  snapshot_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_traditional_seo_snapshots_property_created
  on public.traditional_seo_score_snapshots (property_url, created_at desc);

insert into public.traditional_seo_rules (
  rule_key, rule_name, description, category, severity, scope, current_status, enabled, weight, sort_order
) values
  ('title_tag_present', 'Title tag present', 'Page has a non-empty <title> tag.', 'on-page', 'high', 'page', 'pass', true, 1.5, 10),
  ('meta_description_present', 'Meta description present', 'Page has a meta description tag.', 'on-page', 'medium', 'page', 'pass', true, 1.0, 20),
  ('single_h1', 'Single H1 per page', 'Exactly one primary H1 heading on page.', 'on-page', 'medium', 'page', 'pass', true, 1.0, 30),
  ('canonical_self_or_valid', 'Canonical is valid', 'Canonical URL exists and is valid for the page.', 'technical', 'high', 'page', 'pass', true, 1.4, 40),
  ('indexable_status', 'Indexable status', 'Page not blocked by noindex/robots in audit scope.', 'indexation', 'critical', 'page', 'pass', true, 2.0, 50),
  ('https_enforced', 'HTTPS enforced', 'Site resolves to HTTPS without mixed protocol issues.', 'technical', 'high', 'sitewide', 'pass', true, 1.6, 60),
  ('sitemap_declared', 'XML sitemap declared', 'Robots file references sitemap and sitemap is fetchable.', 'crawlability', 'medium', 'sitewide', 'pass', true, 1.2, 70),
  ('robots_fetchable', 'robots.txt fetchable', 'robots.txt can be fetched successfully.', 'crawlability', 'medium', 'sitewide', 'pass', true, 1.0, 80),
  ('schema_present_core', 'Core schema present', 'Core schema types exist (Organization/WebSite/WebPage).', 'schema', 'high', 'page', 'pass', true, 1.7, 90),
  ('internal_links_minimum', 'Minimum internal links', 'Each target URL receives enough internal links.', 'architecture', 'medium', 'page', 'pass', true, 1.1, 100),
  ('thin_content_guardrail', 'Thin content guardrail', 'Content length and helpfulness threshold met.', 'content', 'high', 'page', 'pass', true, 1.5, 110),
  ('image_alt_coverage', 'Image alt coverage', 'Images include meaningful alt text coverage.', 'content', 'low', 'page', 'pass', true, 0.8, 120)
on conflict (rule_key) do nothing;

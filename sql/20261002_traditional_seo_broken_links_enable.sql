-- Enable Broken links (404) Traditional SEO rule (same-site outbound → 404/410 = fail).
insert into public.traditional_seo_rules (
  rule_key, rule_name, description, category, severity, scope,
  current_status, enabled, weight, sort_order
) values (
  'broken_links_no_404',
  'Broken links (404)',
  'Same-site outbound links from page HTML must not resolve to HTTP 404/410. Uses extractability link targets + status checks during ②/① Traditional SEO runs.',
  'crawlability',
  'high',
  'page',
  'pass',
  true,
  1.2,
  135
)
on conflict (rule_key) do update set
  rule_name = excluded.rule_name,
  description = excluded.description,
  category = excluded.category,
  severity = excluded.severity,
  scope = excluded.scope,
  enabled = true,
  weight = excluded.weight,
  sort_order = excluded.sort_order,
  updated_at = now();

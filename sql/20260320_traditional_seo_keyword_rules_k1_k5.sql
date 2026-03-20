-- K1–K5 target-keyword rules (Part 1). Upsert into Supabase `traditional_seo_rules`.
-- Reconcile sort_order with dashboard baseline (alanranger/audit-dashboard TRADITIONAL_SEO_BASELINE_RULES).

insert into public.traditional_seo_rules (
  rule_key, rule_name, description, category, severity, scope, current_status, enabled, weight, sort_order
) values
  (
    'keyword_in_title',
    'K1 — Keyword in <title>',
    'Target keyword from 07-url-target-keywords-seospace.csv: all meaningful words appear in <title> (HTML preferred; else schema title). Normalised lowercase match.',
    'keywords',
    'high',
    'page',
    'pass',
    true,
    1.35,
    36
  ),
  (
    'keyword_in_meta',
    'K2 — Keyword in meta description',
    'Same keyword: all meaningful words in meta (Extract HTML preferred; else schema meta).',
    'keywords',
    'high',
    'page',
    'pass',
    true,
    1.15,
    37
  ),
  (
    'keyword_in_h1',
    'K3 — Keyword in H1',
    'All meaningful words in primary H1 plain text (longest H1; Extract HTML).',
    'keywords',
    'high',
    'page',
    'pass',
    true,
    1.25,
    38
  ),
  (
    'keyword_slug_tokens',
    'K4 — Slug token alignment',
    'Final path segment tokens (hyphen split): ≥1 meaningful keyword token appears in slug (stopwords ignored).',
    'keywords',
    'medium',
    'page',
    'pass',
    true,
    1.00,
    39
  ),
  (
    'keyword_in_intro',
    'K5 — Keyword in intro',
    'All meaningful words appear in first ~150 words of visible body text (snippet-enriched HTML).',
    'keywords',
    'medium',
    'page',
    'pass',
    true,
    1.10,
    40
  )
on conflict (rule_key) do update set
  rule_name = excluded.rule_name,
  description = excluded.description,
  category = excluded.category,
  severity = excluded.severity,
  scope = excluded.scope,
  weight = excluded.weight,
  sort_order = excluded.sort_order,
  updated_at = now();

-- Align sort_order for existing rules with the current dashboard baseline (post K1–K5 insert).
update public.traditional_seo_rules set sort_order = 45, updated_at = now() where rule_key = 'canonical_self_or_valid';
update public.traditional_seo_rules set sort_order = 50, updated_at = now() where rule_key = 'url_slug_word_count';
update public.traditional_seo_rules set sort_order = 55, updated_at = now() where rule_key = 'indexable_status';
update public.traditional_seo_rules set sort_order = 60, updated_at = now() where rule_key = 'google_gsc_visible';
update public.traditional_seo_rules set sort_order = 65, updated_at = now() where rule_key = 'https_enforced';
update public.traditional_seo_rules set sort_order = 75, updated_at = now() where rule_key = 'sitemap_declared';
update public.traditional_seo_rules set sort_order = 85, updated_at = now() where rule_key = 'robots_fetchable';
update public.traditional_seo_rules set sort_order = 95, updated_at = now() where rule_key = 'schema_present_core';
update public.traditional_seo_rules set sort_order = 100, updated_at = now() where rule_key = 'schema_qa_gate_page';
update public.traditional_seo_rules set sort_order = 101, updated_at = now() where rule_key = 'service_schema_product_page';
update public.traditional_seo_rules set sort_order = 102, updated_at = now() where rule_key = 'localbusiness_schema_page';
update public.traditional_seo_rules set sort_order = 105, updated_at = now() where rule_key = 'internal_links_minimum';
update public.traditional_seo_rules set sort_order = 115, updated_at = now() where rule_key = 'thin_content_guardrail';
update public.traditional_seo_rules set sort_order = 125, updated_at = now() where rule_key = 'image_alt_coverage';
update public.traditional_seo_rules set sort_order = 130, updated_at = now() where rule_key = 'external_links_new_tab';
update public.traditional_seo_rules set sort_order = 135, updated_at = now() where rule_key = 'broken_links_no_404';

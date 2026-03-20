-- Optional: sync display copy in Supabase with dashboard defaults (run in SQL editor if rules were seeded).

update public.traditional_seo_rules
set
  rule_name = 'Meta description length (150–165 chars)',
  description = 'Pass if meta description is 150–165 chars (whitespace + numeric entities like &#124; normalized). Prefers live HTML meta; falls back to schema crawl. Warn if both missing.',
  updated_at = now()
where rule_key = 'meta_description_present';

update public.traditional_seo_rules
set
  rule_name = 'H1 length (40–60 chars)',
  description = 'Uses the longest H1 plain text on the page (and first H1 when needed). Target 40–60 characters (Extractability HTML).',
  updated_at = now()
where rule_key = 'h1_length_best_practice';

update public.traditional_seo_rules
set
  description = 'Best practice: title 50–60 characters. Prefers live HTML <title> from Extractability when available; otherwise schema crawl title.',
  updated_at = now()
where rule_key = 'title_tag_present';

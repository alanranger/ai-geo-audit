-- Keywords Everywhere: sitewide referring-domain and total-backlink counts from get_unique_domain_backlinks JSON.
-- Apply in Supabase SQL editor (AI GEO Audit project).

alter table public.ke_domain_metrics_cache
  add column if not exists referring_domains_total integer,
  add column if not exists total_backlinks integer;

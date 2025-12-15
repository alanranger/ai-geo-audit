-- Domain Strength v1.3: Seed obvious domains with domain_type
-- Purpose: Seed only obvious domains (your_site, platforms) with high confidence

insert into public.domain_strength_domains(domain, label, domain_type, domain_type_source, domain_type_confidence, domain_type_reason, segment, updated_at)
values
  ('alanranger.com', 'Alan Ranger Photography', 'your_site', 'seed', 100, 'Exact match', 'your_site', now()),
  ('google.com', 'Google', 'platform', 'seed', 100, 'Known platform', 'platform', now()),
  ('youtube.com', 'YouTube', 'platform', 'seed', 100, 'Known platform', 'platform', now())
on conflict (domain) do update
set
  label = excluded.label,
  domain_type = excluded.domain_type,
  domain_type_source = excluded.domain_type_source,
  domain_type_confidence = excluded.domain_type_confidence,
  domain_type_reason = excluded.domain_type_reason,
  segment = excluded.segment,
  updated_at = now()
where domain_strength_domains.domain_type_source is null 
   or domain_strength_domains.domain_type_source = 'seed'
   or domain_strength_domains.domain_type_source = 'auto';


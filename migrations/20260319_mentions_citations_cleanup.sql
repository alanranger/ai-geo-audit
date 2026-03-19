-- One-time cleanup to remove historically invalid mention/citation rows.
-- This enforces host-domain consistency and platform derivation from actual URL hosts.

begin;

-- ---------------------------------------------------------------------------
-- Citation consistency cleanup
-- Keep only rows where source_url host matches directory_domain (or subdomain).
-- ---------------------------------------------------------------------------
with normalized_citation as (
  select
    id,
    lower(trim(directory_domain)) as domain_norm,
    lower(split_part(split_part(regexp_replace(source_url, '^https?://', ''), '/', 1), ':', 1)) as host_norm
  from public.citation_consistency_entries
)
delete from public.citation_consistency_entries c
using normalized_citation n
where c.id = n.id
  and (
    n.host_norm = ''
    or n.domain_norm = ''
    or not (n.host_norm = n.domain_norm or n.host_norm like '%.' || n.domain_norm)
  );

update public.citation_consistency_entries
set directory_domain = lower(trim(directory_domain))
where directory_domain is not null
  and directory_domain <> lower(trim(directory_domain));

-- ---------------------------------------------------------------------------
-- Mentions cleanup
-- Derive platform from source_url host and remove rows with invalid/mismatched hosts.
-- ---------------------------------------------------------------------------
with mention_hosts as (
  select
    id,
    lower(split_part(split_part(regexp_replace(source_url, '^https?://', ''), '/', 1), ':', 1)) as host_norm
  from public.mentions_baseline_entries
),
mapped as (
  select
    id,
    host_norm,
    case
      when host_norm = 'youtu.be' or host_norm = 'youtube.com' or host_norm like '%.youtube.com' then 'youtube'
      when host_norm = 'reddit.com' or host_norm like '%.reddit.com' then 'reddit'
      when host_norm = 'linkedin.com' or host_norm like '%.linkedin.com' then 'linkedin'
      else null
    end as platform_from_host
  from mention_hosts
)
delete from public.mentions_baseline_entries m
using mapped x
where m.id = x.id
  and (x.host_norm = '' or x.platform_from_host is null or lower(coalesce(m.platform, '')) <> x.platform_from_host);

update public.mentions_baseline_entries m
set
  source_domain = x.host_norm
from (
  select
    id,
    lower(split_part(split_part(regexp_replace(source_url, '^https?://', ''), '/', 1), ':', 1)) as host_norm
  from public.mentions_baseline_entries
) x
where m.id = x.id
  and (
    m.source_domain is null
    or lower(trim(m.source_domain)) <> x.host_norm
  );

commit;

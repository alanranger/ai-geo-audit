-- Latest real domain per Google place id (cid) seen in local packs. From 1 Nov 2026 DataForSEO returns many
-- local-pack items with url google.com/goto?url=<token> and domain google.com; the cid maps them back.
create or replace view public.v_local_pack_cid_domain with (security_invoker = true) as
select distinct on (o->>'cid')
  kr.property_url,
  o->>'cid' as cid,
  o->>'domain' as domain,
  kr.audit_date as last_seen
from public.keyword_rankings kr,
  jsonb_array_elements(case when jsonb_typeof(kr.serp_surface_stack) = 'array' then kr.serp_surface_stack else '[]'::jsonb end) e,
  jsonb_array_elements(case when jsonb_typeof(e->'owners') = 'array' then e->'owners' else '[]'::jsonb end) o
where e->>'type' = 'local_pack'
  and jsonb_typeof(o) = 'object'
  and coalesce(o->>'cid', '') <> ''
  and coalesce(o->>'domain', '') <> ''
  and o->>'domain' !~* '^(www\.)?google\.'
order by o->>'cid', kr.audit_date desc;

comment on view public.v_local_pack_cid_domain is
  'Latest real domain per Google place id (cid) seen in local packs; resolves local-pack items whose url is a google.com/goto redirect.';

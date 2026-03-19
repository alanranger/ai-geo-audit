-- One-time cleanup to remove typo domains and redundant citation rows.
-- Also recomputes citation run aggregates after cleanup.

begin;

-- Normalize typo domain (legacy data) to canonical trustpilot.
update public.citation_consistency_entries
set directory_domain = 'trustpilot.com'
where lower(coalesce(directory_domain, '')) = 'rustpilot.com';

-- Remove duplicate rows per directory, keeping the best candidate:
-- 1) prefer non-fallback rows over generic fallback rows
-- 2) then higher consistency score
-- 3) then most recent last_seen_at
with ranked as (
  select
    id,
    row_number() over (
      partition by lower(trim(directory_domain))
      order by
        case
          when lower(coalesce(fetch_error, '')) like '%no indexed listing candidate%'
            or lower(coalesce(source_url, '')) = ('https://' || lower(trim(directory_domain)) || '/')
          then 1 else 0
        end asc,
        coalesce(consistency_score, 0) desc,
        coalesce(last_seen_at, first_seen_at) desc,
        id desc
    ) as rn
  from public.citation_consistency_entries
)
delete from public.citation_consistency_entries e
using ranked r
where e.id = r.id
  and r.rn > 1;

-- Recompute citation run aggregates after entry cleanup.
with citation_rollup as (
  select
    last_seen_run_id as run_id,
    count(*) as entries_checked,
    count(*) filter (where lower(coalesce(status, '')) <> 'pass') as drift_count,
    count(*) filter (where lower(coalesce(alert_level, '')) in ('alert', 'critical')) as alerts_count,
    coalesce(round(avg(coalesce(consistency_score, 0)))::int, 0) as average_score
  from public.citation_consistency_entries
  where last_seen_run_id is not null
  group by last_seen_run_id
)
update public.citation_consistency_runs r
set
  entries_checked = coalesce(cr.entries_checked, 0),
  drift_count = coalesce(cr.drift_count, 0),
  alerts_count = coalesce(cr.alerts_count, 0),
  average_score = coalesce(cr.average_score, 0)
from citation_rollup cr
where r.id = cr.run_id;

commit;

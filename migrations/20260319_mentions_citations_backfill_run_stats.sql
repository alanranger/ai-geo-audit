-- One-time backfill to align run summary rows with cleaned entry tables.
-- Rebuilds aggregate counters from *_entries grouped by last_seen_run_id.

begin;

-- Mentions run backfill
with mention_counts as (
  select
    last_seen_run_id as run_id,
    count(*) as mentions_found,
    count(*) filter (where lower(coalesce(alert_level, '')) in ('alert', 'critical')) as alerts_count
  from public.mentions_baseline_entries
  where last_seen_run_id is not null
  group by last_seen_run_id
),
mention_platform_counts as (
  select
    last_seen_run_id as run_id,
    lower(coalesce(platform, 'unknown')) as platform_key,
    count(*) as platform_count
  from public.mentions_baseline_entries
  where last_seen_run_id is not null
  group by last_seen_run_id, lower(coalesce(platform, 'unknown'))
),
mention_platform_json as (
  select
    run_id,
    jsonb_object_agg(platform_key, platform_count order by platform_key) as platform_breakdown
  from mention_platform_counts
  group by run_id
)
update public.mentions_baseline_runs r
set
  mentions_found = coalesce(mc.mentions_found, 0),
  alerts_count = coalesce(mc.alerts_count, 0),
  platform_breakdown = coalesce(mj.platform_breakdown, '{}'::jsonb)
from mention_counts mc
left join mention_platform_json mj on mj.run_id = mc.run_id
where r.id = mc.run_id;

-- Citation run backfill
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

-- 20260628_db_overload_mitigation.sql
-- Context: running the GSC & Backlink audit kept knocking the shared Supabase
-- instance (igzvwbvgvmzvvzoclufx) over -> Postgres stops responding -> Cloudflare
-- 522 -> dashboard "Supabase temporarily unavailable".
--
-- Root cause (from postgres logs 2026-06-28): heavy pg_cron jobs run EVERY HOUR
-- ON THE HOUR and already nearly max the small instance:
--   * trigger_refresh_master_job()                       ~75s (pg_net HTTP calls time out at 30s)
--   * refresh_v_products_unified_with_regression_test()  ~30s (waits 30s on AccessShareLock)
--   * db_health_monitor()                                ~30s
-- The audit (+ dashboard tab loads) piled on top with no headroom.
--
-- HOW TO USE THIS FILE: do NOT blind-run. Run section 1 (read-only discovery)
-- first, look at the real schedules/job ids, then run the SECTION 2/3 statements
-- you choose, editing the jobid / schedule placeholders to match section 1 output.
-- Requires the pg_cron extension (already installed) and superuser/owner rights
-- (run from the Supabase SQL editor as the postgres role).

-- =====================================================================
-- SECTION 1 — DISCOVERY (read-only; run these first)
-- =====================================================================

-- 1a. Current cron schedule (find the jobid + schedule for the heavy jobs)
select jobid, schedule, command, active
from cron.job
order by jobid;

-- 1b. Recent cron run history + durations (which jobs are slow / failing)
select j.jobid,
       left(j.command, 60) as command,
       r.status,
       r.start_time,
       round(extract(epoch from (r.end_time - r.start_time))::numeric, 1) as seconds
from cron.job_run_details r
join cron.job j using (jobid)
where r.start_time > now() - interval '24 hours'
order by r.start_time desc
limit 50;

-- 1c. What's running right now (use to confirm contention)
select pid, state, wait_event_type, wait_event,
       now() - query_start as runtime, left(query, 120) as query
from pg_stat_activity
where state <> 'idle' and pid <> pg_backend_pid()
order by query_start asc;

-- =====================================================================
-- SECTION 2 — STATEMENT TIMEOUTS (prevents one stuck read pinning a
-- connection forever and exhausting the pool). Tune the values to taste.
-- These are role defaults; existing sessions pick them up on reconnect.
-- =====================================================================

-- anon = the public dashboard / supabase-js reads. 30s is generous; lower if you
-- confirm no legit dashboard read needs longer (the limit=10000 reads are the long ones).
alter role anon set statement_timeout = '30s';

-- authenticated = logged-in dashboard sessions.
alter role authenticated set statement_timeout = '30s';

-- Optional: cap idle-in-transaction so a half-finished write can't hold locks.
alter role anon set idle_in_transaction_session_timeout = '15s';
alter role authenticated set idle_in_transaction_session_timeout = '15s';

-- (Do NOT set a tight statement_timeout on the postgres/service role — the cron
--  refresh jobs legitimately run 30-75s and would start failing.)

-- =====================================================================
-- SECTION 3 — TAME THE HOURLY REFRESH PIPELINE (the real fix)
-- Edit <JOBID_*> using the ids from section 1a before running.
-- cron.alter_job changes schedule in place without losing the job definition.
-- =====================================================================

-- 3a. trigger_refresh_master_job: hourly is overkill for a content refresh and
--     it is the single biggest offender (75s + timing-out HTTP). Move it to a few
--     times a day, OFF the top of the hour, and away from the 11:20 audit window.
--     Example: 02:15, 08:15, 14:15, 20:15.
-- select cron.alter_job(<JOBID_MASTER_REFRESH>, schedule => '15 2,8,14,20 * * *');

-- 3b. refresh_v_products_unified_with_regression_test: stagger off :00 so it does
--     not overlap the master refresh or the audit. Example: every 6h at :35.
-- select cron.alter_job(<JOBID_PRODUCTS_REFRESH>, schedule => '35 1,7,13,19 * * *');

-- 3c. db_health_monitor: keep frequent but move off :00 to :45 so it is not
--     queued behind the big refreshes.
-- select cron.alter_job(<JOBID_HEALTH_MONITOR>, schedule => '45 * * * *');

-- 3d. After changing schedules, re-run section 1b over the next day to confirm
--     the 75s/30s jobs no longer overlap each other or the 11:20 audit.

-- =====================================================================
-- SECTION 4 — FOLLOW-UPS (not SQL; tracked here so they are not lost)
-- =====================================================================
-- * trigger_refresh_master_job() makes pg_net HTTP calls to an edge function that
--   time out after 30s ("After test HTTP request failed (job 26)"). Fix or shorten
--   that call — a 75s function that mostly waits on a timing-out HTTP request is
--   burning a connection + CPU for nothing.
-- * Structural cure: this micro instance serves the chat bot + chat-refresh
--   pipeline + the GEO audit dashboard. Either upgrade compute, or split the
--   chat-bot pipeline onto its own Supabase project so audits can't contend with it.

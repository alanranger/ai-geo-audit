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
--
-- STATUS: SECTION 2 + SECTION 3 APPLIED 2026-06-28 via migration
--   "db_overload_mitigation_stagger_cron_and_timeouts".
-- Discovery (section 1) confirmed the collision: jobs 26 (75s) + 39 (~30s) both ran
-- "0 */4 * * *" and job 21 (~30s) ran "0 */8 * * *" -> all three fired together at
-- 00/08/16h. Now staggered (see section 3 applied values). Frequency unchanged.

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

-- APPLIED 2026-06-28 (real jobids from section 1a). Frequency kept the same;
-- only the minute/offset changed so the three heavy jobs never coincide and never
-- land on the 11:20 audit window.
select cron.alter_job(26, schedule => '10 */4 * * *');  -- trigger_refresh_master_job (~75s)  00:10,04:10,08:10,12:10,16:10,20:10
select cron.alter_job(21, schedule => '25 */8 * * *');  -- refresh_v_products_unified (~30s)   00:25,08:25,16:25
select cron.alter_job(39, schedule => '40 */4 * * *');  -- db_health_monitor (~15-30s)         00:40,04:40,08:40,12:40,16:40,20:40

-- 3d. Re-run section 1b over the next day to confirm the 75s/30s jobs no longer
--     overlap each other or the 11:20 audit. If load is still high, the next lever
--     is reducing job 26 frequency (e.g. '10 1,9,17 * * *') and/or fixing its
--     timing-out pg_net HTTP call (see section 4) so it stops burning ~75s.

-- =====================================================================
-- SECTION 4 — FOLLOW-UPS (not SQL; tracked here so they are not lost)
-- =====================================================================
-- * [DONE 2026-06-28] trigger_refresh_master_job() / job 26 ran a flat 75.2s every
--   run. Diagnosis (edge logs + net._http_response): the edge functions were NOT
--   broken (all 200). The 75s was two waits on pg_net HTTP calls:
--     - ~45s: 3x light-refresh batch waits (15s cap each). pg_net's single worker
--       was STARVED by the CPU overload and didn't even send the requests for ~75s.
--       Fixed by the SECTION 3 cron staggering (instance no longer pegged -> pg_net
--       sends promptly -> each wait resolves in ~2-3s).
--     - ~30s: the "after" regression-test wait inside
--       light_refresh_all_batches_with_regression_test(). run-40q-regression-test
--       genuinely takes ~55s, so a 30s wait ALWAYS timed out; the result is linked
--       asynchronously by link_pending_test_results() regardless, so the wait was
--       dead time. Applied via migration "trim_wasted_after_test_wait_job26":
--       changed wait_for_http_response(v_request_id, 30) -> (..., 5). Only that one
--       literal changed; function otherwise byte-for-byte identical. Regression
--       safety is unchanged (it never depended on that synchronous wait).
--   Expected job-26 duration now ~15-20s (was 75.2s), and it runs alone (staggered).
-- * Structural cure (still open): this micro instance serves the chat bot +
--   chat-refresh pipeline + the GEO audit dashboard. Either upgrade compute, or split
--   the chat-bot pipeline onto its own Supabase project so audits can't contend.

# Marketing list loads: safety checks and residual risk

Applies to Marketing & Campaigns → Audience snapshots → "Load into Squarespace list" (collector on Alan's PC).

## Why the checks exist

A Squarespace mailing-list CSV import only works with "these contacts consent to email marketing" switched on, so it
re-subscribes anyone in the file who had unsubscribed (proved 7 Nov 2026: All Subscribers 925 → 926 before the repair).

## The checks, in order

1. **Name collision** (before anything is read or imported). A snapshot name already used by a live snapshot is refused
   when the snapshot is made; a list with the same name already in Squarespace (any size) is refused by the PC. Nothing
   is renamed or appended. Next step shown: make a new snapshot with a different name, or rename / delete the old list
   in Squarespace yourself.
2. **Automations check** (Alan, before every production load). In Squarespace: Marketing → Email Campaigns →
   Automations. Confirm nothing is triggered by "joins a mailing list" / "new subscriber" (or that any such automation
   excludes `ARP |` lists). The dashboard refuses a production load until this is confirmed in the load dialog; the
   confirmation is stored in the snapshot's status history.
3. **Before the import**: consent re-read from Squarespace; only people subscribed, unsuppressed and present go in.
4. **After the import**: consent re-read; anyone switched on by the import (not subscribed before, or whose
   subscription record was started by this CSV) is a flip. Unreadable records also block.
5. **Repair queue**: every flip stays `flipped_by_import` in `marketing_segment_export_members` until a fresh consent
   read confirms them unsubscribed again. Alan's PC asks for the queue on every scheduled run (every 5 minutes, task
   "ARP Squarespace List Jobs") and retries Squarespace's own opt-out until each is confirmed; attempts, last try and
   last error are shown on the snapshot. The list stays **BLOCKED — DO NOT SEND** until every repair is confirmed.
6. **Pre-send check**: consent + suppression for everyone loaded. A PASS is valid for 30 minutes; a campaign record
   only shows READY TO SEND while it lasts. Every loaded list and its campaign record show the rule **"Press Pre-send
   check, then send in Squarespace within 30 minutes"**; once PASS, a live mm:ss countdown runs, then "PASS expired —
   check again" (the pill drops to NOT CHECKED / NOT READY TO SEND). Each check is kept in
   `load_result.presend_log` (last 50).
7. **After the send**: recipients of a campaign sent to the list are reconciled against the people who passed, and the
   send time (`sqs_email_campaigns.sent_on`) is compared with the pre-send log. A send with no PASS in the 30 minutes
   before it is flagged on the Marketing tab and in the Monday brief's marketing alerts (`lib/marketing/health.mjs`).

TEST snapshots (Alan's own @alanranger.com addresses, list names `ARP | TEST |`) are hidden from the snapshot table by
default, can't carry a campaign record, and never count as a campaign's audience.

## Residual risk (accepted: Alan, 8 Nov 2026, via Claude)

- A campaign started in Squarespace outside the dashboard, or sent after its 30-minute PASS has run out, skips the
  pre-send check.
- For the minutes between the import and the confirmed repair, a re-subscribed person is on the list: an automation
  triggered by subscribing, or a manual send in that window, would reach them.
- The PC must be on and signed in to Squarespace for the repair queue to run; until then the list stays blocked.

**Acceptance:** Alan accepted this residual risk on 8 Nov 2026, via Claude (QUESTION-2026-11-08, decision "A"). Production
loads are switched on in `lib/marketing/import-block.mjs` (`production_load_blocked: false`,
`residual_risk_accepted_by: 'Alan, 8 Nov 2026, via Claude'`). Every check above still runs; setting the flag back to
`true` switches production loads off again (TEST loads keep working).

## Live repair-queue test (8 Nov 2026)

TEST list `ARP | TEST | repair-queue | 2026-11-08`, info@ (subscribed) + marketing@ (unsubscribed, forced in). The
5-minute task was paused; the load was run with `--jobs --test-abort-undo` (stops after the after-check, before the
load's own undo, as a crash would) → BLOCKED, marketing@ re-subscribed by the CSV, All Subscribers 925 → 926; pre-send
check FAIL, still blocked. A run with `--jobs --test-fail-repair` recorded a failed attempt (attempt 1, last try, error)
and the list stayed blocked. Two scheduled slots were missed with the browser closed; the task was re-enabled and the next
scheduled run (11:12) repaired it (attempt 2), confirmed by a fresh consent read → LOADED. Both addresses are back in
their original state (info@ subscribed with its 2024 source unchanged; marketing@ unsubscribed). All Subscribers
925 → 926 → 924: the extra −1 is an unrelated contact who unsubscribed themselves at 11:06 (source "OTHER", no collector
running); a scan of every contact found only that change and the test address in the window. Both flags act only on
`ARP | TEST |` lists.

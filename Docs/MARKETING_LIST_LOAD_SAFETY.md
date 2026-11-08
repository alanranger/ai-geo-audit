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
   only shows READY TO SEND while it lasts.
7. **After the send**: recipients of a campaign sent to the list are reconciled against the people who passed.

TEST snapshots (Alan's own @alanranger.com addresses, list names `ARP | TEST |`) are hidden from the snapshot table by
default, can't carry a campaign record, and never count as a campaign's audience.

## Residual risk (needs Alan's acceptance before production loads)

- A campaign started in Squarespace outside the dashboard, or sent after its 30-minute PASS has run out, skips the
  pre-send check.
- For the minutes between the import and the confirmed repair, a re-subscribed person is on the list: an automation
  triggered by subscribing, or a manual send in that window, would reach them.
- The PC must be on and signed in to Squarespace for the repair queue to run; until then the list stays blocked.

Production loads are switched off in `lib/marketing/import-block.mjs` (`production_load_blocked: true`) until Alan
accepts this via Claude.

/**
 * Controlled test 7 Nov 2026: Squarespace only accepts a mailing-list import with "These contacts consent to email
 * marketing" switched on, so an import asserts consent for every row. Alan's decision (7 Nov, option a): allow it, but
 * only through "Load into Squarespace list" — consent re-read immediately before, re-checked immediately after, and a
 * pre-send check just before the campaign goes. A plain CSV for manual import would skip those checks, so it stays off.
 */
export const IMPORT_BLOCK = {
  blocked: false,
  csv_blocked: true,
  /** Claude, combined fixes 7 Nov (Part 5): no production list is loaded until Alan accepts the residual risk via Claude. */
  production_load_blocked: true,
  production_load_reason: 'Production list loads are switched off until Alan accepts the residual risk (a send started in Squarespace outside the dashboard skips the pre-send check). TEST snapshots (business addresses only) can still be loaded.',
  tested_on: '2026-11-07',
  reason: 'A Squarespace list import switches marketing consent on for every row. Lists are therefore only loaded through "Load into Squarespace list": consent is re-read from Squarespace immediately before the import and again immediately after; anyone the import re-subscribed is set back to unsubscribed (Squarespace opt-out, which also takes them off the list) and the list stays blocked until that is confirmed; and a pre-send check (valid 30 minutes) must PASS before sending. The plain CSV download is off because a manual import would skip those checks.'
};

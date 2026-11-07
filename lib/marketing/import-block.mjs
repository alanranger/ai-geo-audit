/**
 * Controlled test 7 Nov 2026 (test list "ARP | TEST | consent-check | 2026-11-07", Alan's own two addresses):
 * Squarespace refuses every mailing-list CSV import unless "These contacts consent to email marketing" is switched on
 * (CANNOT_IMPORT_ACCEPTS_EMAIL_MARKETING_CONFLICT, for a subscribed and an unsubscribed contact alike). A list import
 * therefore asserts consent for every row and could re-subscribe anyone who unsubscribed after the export, so list
 * import stays blocked until Claude / Alan decide otherwise.
 */
export const IMPORT_BLOCK = {
  blocked: true,
  tested_on: '2026-11-07',
  reason: 'Squarespace only accepts a mailing-list import with "These contacts consent to email marketing" switched on, which would set consent for every row (and could re-subscribe anyone who unsubscribed after the export). List import is blocked; the audience snapshot is kept for planning and send reservations.'
};

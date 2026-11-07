/**
 * Record type for every customer record (Claude C9, 7 Nov 2026):
 *   person        — an individual
 *   organisation  — a business / school / club client (stays visible as a commission client)
 *   system        — a system address or a Booking Sheet ledger label ("Pick n Mix Subs", "Mentoring Subs", …):
 *                   never a person; excluded from people counts, repeat rates, segments and spend rankings
 * Rules are whole-word / exact so surnames like "Cash" or "Schoolar" stay people. ORG_NAMES holds organisations the
 * name can't show (named by Claude from the 7 Nov check).
 */
const SYSTEM_EMAIL = /(^|[._-])(no-?reply|do-?not-?reply|mailer-daemon|bounce)[^@]*@|@(squarespace|stripe|paypal|acuityscheduling|acuity)\.com$/i;
const LEDGER_NAME = /^(pick\s*n\s*mix(\s+subs?)?|mentoring(\s+subs?)?|[a-z &]+\s+subs?|subscriptions?|various|unknown|misc(ellaneous)?|cash( sales?)?|gift\s*vouchers?|voucher\s+sales?|refunds?|adjustments?|test)$/i;
const ORG_WORD = /\b(ltd|limited|llp|plc|cic|inc|l\.t\.d)\.?$|\b(school|college|university|academy trust|club|society|council|trust|church|charity|foundation|consulting|consultancy|associates|partnership|camera club|photographic society)\b/i;
const ORG_NAMES = new Set(['birkdale', 'photocrowd']);

export const RECORD_TYPES = ['person', 'organisation', 'system'];

export function recordType({ email, name }) {
  const n = String(name || '').trim().replace(/\s+/g, ' ');
  if (email && SYSTEM_EMAIL.test(email)) return 'system';
  if (n && LEDGER_NAME.test(n)) return 'system';
  if (n && (ORG_WORD.test(n) || ORG_NAMES.has(n.toLowerCase()))) return 'organisation';
  return 'person';
}

export const isSystem = (f) => f?.record_type === 'system';

/** A row of its own in people counts and lists: live, not shown under a contact (C10), not a system / ledger label (C9). */
export const isListed = (f) => !!f && !f.stale && !f.attached_to && f.record_type !== 'system';

/**
 * Customer query field catalogue (spec 7 Nov 2026, sections 3–4). Schema-driven allowlist: the browser can only name
 * these fields and operators; nothing else reaches the evaluator. A getter returns:
 *   a plain value, UNKNOWN (not collected / not available), or EVIDENCE {c, cp, incomplete} for history-based numbers
 *   where c = confirmed records, cp = confirmed + probable (name-only Booking Sheet), incomplete = history has gaps.
 * stage: 'A' built now; 'B' needs topic mapping / per-campaign detail (shown greyed in the builder).
 */
import { milesBetween } from '../facts.mjs';

export const UNKNOWN = Symbol('unknown');
export const evidence = (c, cp, incomplete) => ({ evidence: true, c, cp, incomplete: !!incomplete });

const v = (R) => R.f.value || {};
const num = (key) => (R) => evidence(v(R).c?.[key] ?? 0, v(R).cp?.[key] ?? 0, R.f.history_incomplete);
/** No address at all is known (an empty domain), not unknown: a name-only Booking Sheet record is never "@yahoo.com". */
const domainOf = (e) => (e && e.includes('@') ? e.split('@').pop().toLowerCase() : '');
const kind = (R) => (R.f.admin ? 'admin' : (R.anchor.startsWith('sqs:') ? 'squarespace' : (R.anchor.startsWith('email:') ? 'email_only' : 'name_only')));
const eng = (R, k) => (!R.f.email || !R.engagementComplete ? UNKNOWN : (R.f.engagement?.[k] ?? 0));
const engDate = (R, k) => (!R.f.email || !R.engagementComplete ? UNKNOWN : (R.f.engagement?.[k] || null));
const academy = (R) => (R.academyFeed ? (R.f.academy || 'none') : UNKNOWN);
const miles = (R) => { const m = milesBetween(R.centre, R.f); return m == null ? UNKNOWN : Math.round(m * 10) / 10; };
const postcodeArea = (R) => (R.f.postcode ? String(R.f.postcode).match(/^[A-Z]{1,2}/)?.[0] || UNKNOWN : UNKNOWN);
const eligible = (R) => !!(R.f.email && R.f.subscribed && !R.f.suppressed && R.f.profile_state === 'active' && !R.f.stale);
const identityReview = (R) => !!(R.f.email_shared || R.f.admin || R.f.last_booking_probable || Object.values(R.f.cats || {}).some((k) => k.p > 0));

const NUM_OPS = ['gte', 'lte', 'eq', 'between', 'known', 'unknown'];
const DATE_OPS = ['after', 'before', 'between', 'within_last', 'older_than', 'known', 'unknown'];
const REC_OPS = ['exists', 'none'];

export const CATEGORY_OPTIONS = ['beginners', 'lightroom', 'course', 'one_to_one', 'mentoring', 'abstract_macro', 'woodland', 'day_workshop', 'residential', 'academy', 'voucher_bought', 'voucher_redeemed', 'pick_n_mix'];

export const FIELDS = [
  { key: 'eligible', group: 'Consent / contact', label: 'Can be emailed (subscribed, not suppressed, live contact)', type: 'bool', ops: ['is_true', 'is_false'], get: eligible },
  { key: 'subscribed', group: 'Consent / contact', label: 'Subscribed in Squarespace', type: 'bool', ops: ['is_true', 'is_false'], get: (R) => (R.f.profile_state === 'none' ? UNKNOWN : !!R.f.subscribed) },
  { key: 'suppressed', group: 'Consent / contact', label: 'On the suppression list', type: 'bool', ops: ['is_true', 'is_false'], get: (R) => (R.f.email ? !!R.f.suppressed : UNKNOWN) },
  { key: 'email_domain', group: 'Consent / contact', label: 'Email domain (exact)', type: 'text', ops: ['is', 'is_not', 'in'], get: (R) => domainOf(R.f.email) },
  { key: 'contact_kind', group: 'Consent / contact', label: 'Record type', type: 'enum', options: ['squarespace', 'email_only', 'name_only', 'admin'], ops: ['in', 'not_in'], get: kind },
  { key: 'contact_created', group: 'Consent / contact', label: 'Squarespace contact created', type: 'date', ops: DATE_OPS, get: (R) => (R.f.profile_created ? String(R.f.profile_created).slice(0, 10) : UNKNOWN) },
  { key: 'spend_net', group: 'Value', label: 'Known net spend (£)', type: 'number', ops: NUM_OPS, get: num('net') },
  { key: 'spend_r12', group: 'Value', label: 'Net spend, last 12 months (£)', type: 'number', ops: NUM_OPS, get: num('r12_net') },
  { key: 'orders', group: 'Value', label: 'Orders (each sale once)', type: 'number', ops: NUM_OPS, get: num('orders') },
  { key: 'places', group: 'Value', label: 'Places bought', type: 'number', ops: NUM_OPS, get: num('places') },
  { key: 'aov', group: 'Value', label: 'Average order (£, confirmed)', type: 'number', ops: NUM_OPS, get: (R) => v(R).c?.aov ?? UNKNOWN },
  { key: 'refunds', group: 'Value', label: 'Refunded (£)', type: 'number', ops: NUM_OPS, get: num('refunds') },
  { key: 'bookings', group: 'Product / history', label: 'Bookings held (own or as attendee)', type: 'number', ops: NUM_OPS, get: (R) => evidence(R.f.booking_count || 0, R.f.booking_count || 0, R.f.history_incomplete) },
  { key: 'booking', group: 'Product / history', label: 'Booking', type: 'records', ops: REC_OPS, records: 'bookings' },
  { key: 'purchase', group: 'Product / history', label: 'Purchase', type: 'records', ops: REC_OPS, records: 'purchases' },
  { key: 'last_category', group: 'Product / history', label: 'Category of latest purchase', type: 'enum', options: CATEGORY_OPTIONS, ops: ['in', 'not_in'], get: (R) => (v(R).cp?.last ? (v(R).cp.last_cats || []) : UNKNOWN) },
  { key: 'bought_for_others', group: 'Product / history', label: 'Places bought for someone else', type: 'number', ops: NUM_OPS, get: (R) => R.f.bought_for_others || 0 },
  { key: 'future_booking', group: 'Future commitments', label: 'Upcoming booking', type: 'records', ops: REC_OPS, records: 'future' },
  { key: 'miles', group: 'Geography', label: 'Miles from centre (straight line)', type: 'number', ops: NUM_OPS, get: miles },
  { key: 'postcode_area', group: 'Geography', label: 'Postcode area (e.g. CV)', type: 'text', ops: ['is', 'is_not', 'in'], get: postcodeArea },
  { key: 'academy', group: 'Academy', label: 'Academy status', type: 'enum', options: ['member', 'trial', 'account', 'none'], ops: ['in', 'not_in'], get: academy },
  { key: 'click', group: 'Email activity', label: 'Clicked a link', type: 'records', ops: REC_OPS, records: 'clicks' },
  { key: 'last_open', group: 'Email activity', label: 'First open of the latest opened campaign', type: 'date', ops: DATE_OPS, get: (R) => engDate(R, 'last_open_at') },
  { key: 'last_click', group: 'Email activity', label: 'Latest link click', type: 'date', ops: DATE_OPS, get: (R) => engDate(R, 'last_click_at') },
  { key: 'last_emailed', group: 'Email activity', label: 'Last campaign delivered', type: 'date', ops: DATE_OPS, get: (R) => engDate(R, 'last_delivered_at') },
  { key: 'delivered_count', group: 'Email activity', label: 'Campaigns delivered', type: 'number', ops: NUM_OPS, get: (R) => eng(R, 'delivered_campaigns') },
  { key: 'opened_count', group: 'Email activity', label: 'Campaigns opened', type: 'number', ops: NUM_OPS, get: (R) => eng(R, 'opened_campaigns') },
  { key: 'clicked_count', group: 'Email activity', label: 'Campaigns clicked', type: 'number', ops: NUM_OPS, get: (R) => eng(R, 'clicked_campaigns') },
  { key: 'click_topic', group: 'Email activity', label: 'Clicked a topic (topic map)', type: 'records', ops: REC_OPS, stage: 'B', get: () => UNKNOWN },
  { key: 'history_incomplete', group: 'Data quality', label: 'History incomplete', type: 'bool', ops: ['is_true', 'is_false'], get: (R) => !!R.f.history_incomplete },
  { key: 'identity_review', group: 'Data quality', label: 'Needs identity review (shared email, admin, probable match)', type: 'bool', ops: ['is_true', 'is_false'], get: identityReview },
  { key: 'has_email', group: 'Data quality', label: 'Has an email address', type: 'bool', ops: ['is_true', 'is_false'], get: (R) => !!R.f.email },
  { key: 'has_location', group: 'Data quality', label: 'Location known', type: 'bool', ops: ['is_true', 'is_false'], get: (R) => miles(R) !== UNKNOWN }
];

export const FIELD = new Map(FIELDS.map((f) => [f.key, f]));
export const QUERY_VERSION = 1;

/** Catalogue for the builder (no getters). */
export const catalogue = () => FIELDS.map(({ get, ...f }) => ({ ...f, stage: f.stage || 'A' }));

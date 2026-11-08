/**
 * Customer query field catalogue (spec 7 Nov 2026, sections 3–4). Schema-driven allowlist: the browser can only name
 * these fields and operators; nothing else reaches the evaluator. A getter returns:
 *   a plain value, UNKNOWN (not collected / not available), or EVIDENCE {c, cp, incomplete} for history-based numbers
 *   where c = confirmed records, cp = confirmed + probable (name-only Booking Sheet), incomplete = history has gaps.
 * stage: 'A' built now; 'B' needs topic mapping / per-campaign detail (shown greyed in the builder).
 */
import { milesBetween } from '../facts.mjs';
import { DEFAULT_WINDOWS, engagementView } from '../engagement.mjs';

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

/** Email activity band (warm / cooling / cold …) from the person's first-open times; unknown until history is complete. */
function openBand(R) {
  if (!R.f.email) return UNKNOWN;
  const b = engagementView(R.f.engagement, R.engagementComplete, R.windows || DEFAULT_WINDOWS, R.today).open;
  return b === 'unknown' ? UNKNOWN : b;
}
const ACADEMY_LEGACY = { member: 'paid_active', trial: 'trial_expired', account: 'account_only' };
function academyStatus(R) {
  if (!R.academyFeed) return UNKNOWN;
  if (R.f.academy_detail?.status) return R.f.academy_detail.status;
  return R.f.academy ? ACADEMY_LEGACY[R.f.academy] || 'account_only' : 'never';
}
const academyDate = (k) => (R) => (!R.academyFeed || (k !== 'joined' && !R.academyDates) ? UNKNOWN : (R.f.academy_detail?.[k] || null));
/** Pick n Mix plan state from the plan statements (start / end dates), not from "paid in the last year". */
function planStatus(R) {
  const plans = R.f.plans || [];
  if (!plans.length) return 'none';
  if (plans.some((p) => p.starts && p.starts <= R.today && (!p.ends || p.ends >= R.today))) return 'active';
  return plans.some((p) => p.starts && p.starts > R.today) ? 'starting' : 'ended';
}
const planTypes = (R) => [...new Set((R.f.plans || []).map((p) => String(p.plan_type || '').toLowerCase()).filter(Boolean))];

const NUM_OPS = ['gte', 'lte', 'eq', 'between', 'known', 'unknown'];
const DATE_OPS = ['after', 'before', 'between', 'within_last', 'older_than', 'known', 'unknown'];
const REC_OPS = ['exists', 'none'];
const COUNT_OPS = ['exists', 'none', 'count_gte', 'count_lte'];

export const CATEGORY_OPTIONS = ['beginners', 'lightroom', 'course', 'one_to_one', 'mentoring', 'abstract_macro', 'woodland', 'day_workshop', 'residential', 'academy', 'voucher_bought', 'voucher_redeemed', 'pick_n_mix'];

export const FIELDS = [
  { key: 'eligible', group: 'Consent / contact', label: 'Can be emailed (subscribed, not suppressed, live contact)', type: 'bool', ops: ['is_true', 'is_false'], get: eligible },
  { key: 'subscribed', group: 'Consent / contact', label: 'Subscribed in Squarespace', type: 'bool', ops: ['is_true', 'is_false'], get: (R) => (R.f.profile_state === 'none' ? UNKNOWN : !!R.f.subscribed) },
  { key: 'suppressed', group: 'Consent / contact', label: 'On the suppression list', type: 'bool', ops: ['is_true', 'is_false'], get: (R) => (R.f.email ? !!R.f.suppressed : UNKNOWN) },
  { key: 'email_domain', group: 'Consent / contact', label: 'Email domain (exact)', type: 'text', ops: ['is', 'is_not', 'in'], get: (R) => domainOf(R.f.email) },
  { key: 'record_type', group: 'Consent / contact', label: 'Person / organisation / system label', type: 'enum', options: ['person', 'organisation', 'system'], ops: ['in', 'not_in'], get: (R) => R.f.record_type || 'person' },
  { key: 'contact_kind', group: 'Consent / contact', label: 'Record source', type: 'enum', options: ['squarespace', 'email_only', 'name_only', 'admin'], ops: ['in', 'not_in'], get: kind },
  { key: 'contact_created', group: 'Consent / contact', label: 'Squarespace contact created', type: 'date', ops: DATE_OPS, get: (R) => (R.f.profile_created ? String(R.f.profile_created).slice(0, 10) : UNKNOWN) },
  { key: 'spend_net', group: 'Value', label: 'Known net spend (£)', type: 'number', ops: NUM_OPS, get: num('net') },
  { key: 'spend_r12', group: 'Value', label: 'Net spend, last 12 months (£)', type: 'number', ops: NUM_OPS, get: num('r12_net') },
  { key: 'orders', group: 'Value', label: 'Orders (each sale once)', type: 'number', ops: NUM_OPS, get: num('orders') },
  { key: 'places', group: 'Value', label: 'Places bought', type: 'number', ops: NUM_OPS, get: num('places') },
  { key: 'aov', group: 'Value', label: 'Average order (£, confirmed)', type: 'number', ops: NUM_OPS, get: (R) => v(R).c?.aov ?? UNKNOWN },
  { key: 'refunds', group: 'Value', label: 'Refunded (£)', type: 'number', ops: NUM_OPS, get: num('refunds') },
  { key: 'spend_period', group: 'Value', label: 'Spend in a chosen period (£)', type: 'records', records: 'purchases', ops: ['sum_gte', 'sum_lte'], hint: 'Each sale once (orders, Booking Sheet, plan payments); pick the dates and optionally categories.' },
  { key: 'orders_period', group: 'Value', label: 'Purchases in a chosen period (count)', type: 'records', records: 'purchases', ops: ['count_gte', 'count_lte'] },
  { key: 'bookings', group: 'Product / history', label: 'Bookings held (own or as attendee)', type: 'number', ops: NUM_OPS, get: (R) => evidence(R.f.booking_count || 0, R.f.booking_count || 0, R.f.history_incomplete) },
  { key: 'booking', group: 'Product / history', label: 'Booking', type: 'records', ops: COUNT_OPS, records: 'bookings', hint: 'A course, workshop or event booked (not attended: the Booking Sheet has no attendance column).' },
  { key: 'purchase', group: 'Product / history', label: 'Purchase', type: 'records', ops: COUNT_OPS, records: 'purchases' },
  { key: 'last_category', group: 'Product / history', label: 'Category of latest purchase', type: 'enum', options: CATEGORY_OPTIONS, ops: ['in', 'not_in'], get: (R) => (v(R).cp?.last ? (v(R).cp.last_cats || []) : UNKNOWN) },
  { key: 'bought_for_others', group: 'Product / history', label: 'Places bought for someone else', type: 'number', ops: NUM_OPS, get: (R) => R.f.bought_for_others || 0 },
  { key: 'future_booking', group: 'Future commitments', label: 'Upcoming booking', type: 'records', ops: REC_OPS, records: 'future' },
  { key: 'miles', group: 'Geography', label: 'Miles from centre (straight line)', type: 'number', ops: NUM_OPS, get: miles },
  { key: 'postcode_area', group: 'Geography', label: 'Postcode area (e.g. CV)', type: 'text', ops: ['is', 'is_not', 'in'], get: postcodeArea },
  { key: 'academy_status', group: 'Academy & plans', label: 'Academy status', type: 'enum', options: ['paid_active', 'trial_active', 'trial_expired', 'cancelled', 'account_only', 'never'], ops: ['in', 'not_in'], get: academyStatus, hint: 'Memberstack plans + Academy trial history. Marketing consent is separate.' },
  { key: 'academy', group: 'Academy & plans', label: 'Academy (simple: member / trial / account)', type: 'enum', options: ['member', 'trial', 'account', 'none'], ops: ['in', 'not_in'], get: academy },
  { key: 'academy_joined', group: 'Academy & plans', label: 'Academy account created', type: 'date', ops: DATE_OPS, get: academyDate('joined') },
  { key: 'academy_trial_start', group: 'Academy & plans', label: 'Academy trial started', type: 'date', ops: DATE_OPS, get: academyDate('trial_start') },
  { key: 'academy_trial_end', group: 'Academy & plans', label: 'Academy trial ends / ended', type: 'date', ops: DATE_OPS, get: academyDate('trial_end') },
  { key: 'pnm_status', group: 'Academy & plans', label: 'Pick n Mix plan', type: 'enum', options: ['active', 'starting', 'ended', 'none'], ops: ['in', 'not_in'], get: planStatus, hint: 'From the plan statements (start and end dates). A payment in the last year is not "active".' },
  { key: 'pnm_type', group: 'Academy & plans', label: 'Pick n Mix plan type (any plan)', type: 'enum', options: ['monthly', 'quarterly', 'annual'], ops: ['in', 'not_in'], get: planTypes },
  { key: 'open_band', group: 'Email activity', label: 'Email activity (warm / cooling / cold)', type: 'enum', options: ['warm', 'cooling', 'cooling_partial', 'cold', 'none_recorded', 'insufficient'], ops: ['in', 'not_in'], get: openBand, hint: 'Warm = opened in the last 90 days, cooling 91–180, cold older. An open is a recorded signal, not proof of reading.' },
  { key: 'campaign_received', group: 'Email activity', label: 'Campaign delivered', type: 'records', ops: COUNT_OPS, records: 'deliveries', hint: 'Latest 40 fully collected campaigns; older campaigns stay unknown.' },
  { key: 'campaign_opened', group: 'Email activity', label: 'Campaign opened', type: 'records', ops: REC_OPS, records: 'opens', hint: 'Latest 40 fully collected campaigns.' },
  { key: 'click', group: 'Email activity', label: 'Clicked a link (campaign / topic / link)', type: 'records', ops: COUNT_OPS, records: 'clicks', hint: 'Topic = link topic map v1 (what the link was about), not a product category.' },
  { key: 'last_open', group: 'Email activity', label: 'First open of the latest opened campaign', type: 'date', ops: DATE_OPS, get: (R) => engDate(R, 'last_open_at') },
  { key: 'last_click', group: 'Email activity', label: 'Latest link click', type: 'date', ops: DATE_OPS, get: (R) => engDate(R, 'last_click_at') },
  { key: 'last_emailed', group: 'Email activity', label: 'Last campaign delivered', type: 'date', ops: DATE_OPS, get: (R) => engDate(R, 'last_delivered_at') },
  { key: 'delivered_count', group: 'Email activity', label: 'Campaigns delivered', type: 'number', ops: NUM_OPS, get: (R) => eng(R, 'delivered_campaigns') },
  { key: 'opened_count', group: 'Email activity', label: 'Campaigns opened', type: 'number', ops: NUM_OPS, get: (R) => eng(R, 'opened_campaigns') },
  { key: 'clicked_count', group: 'Email activity', label: 'Campaigns clicked', type: 'number', ops: NUM_OPS, get: (R) => eng(R, 'clicked_campaigns') },
  { key: 'relationship_hold', group: 'Data quality', label: 'Relationship hold / reply recorded', type: 'bool', ops: ['is_true', 'is_false'], stage: 'B', reason: 'Replies and holds are not recorded anywhere yet.', get: () => UNKNOWN },
  { key: 'email_invalid', group: 'Consent / contact', label: 'Email bounced / invalid', type: 'bool', ops: ['is_true', 'is_false'], stage: 'B', reason: 'Squarespace bounce events are not collected yet.', get: () => UNKNOWN },
  { key: 'academy_activity', group: 'Academy & plans', label: 'Academy activity (lessons, exams)', type: 'date', ops: DATE_OPS, stage: 'B', reason: 'Academy activity is in the Academy database and not joined to customers yet.', get: () => UNKNOWN },
  { key: 'history_incomplete', group: 'Data quality', label: 'History incomplete', type: 'bool', ops: ['is_true', 'is_false'], get: (R) => !!R.f.history_incomplete },
  { key: 'identity_review', group: 'Data quality', label: 'Needs identity review (shared email, admin, probable match)', type: 'bool', ops: ['is_true', 'is_false'], get: identityReview },
  { key: 'has_email', group: 'Data quality', label: 'Has an email address', type: 'bool', ops: ['is_true', 'is_false'], get: (R) => !!R.f.email },
  { key: 'has_location', group: 'Data quality', label: 'Location known', type: 'bool', ops: ['is_true', 'is_false'], get: (R) => miles(R) !== UNKNOWN }
];

export const FIELD = new Map(FIELDS.map((f) => [f.key, f]));
export const QUERY_VERSION = 1;

export const OPTION_LABELS = {
  beginners: 'Beginners course', lightroom: 'Lightroom course', course: 'Other course', one_to_one: '1-2-1 tuition', mentoring: 'Mentoring', abstract_macro: 'Abstract & macro', woodland: 'Woodland',
  day_workshop: 'Day workshop', residential: 'Residential workshop', academy: 'Academy', voucher_bought: 'Bought a gift voucher', voucher_redeemed: 'Used a gift voucher', pick_n_mix: 'Pick n Mix',
  paid_active: 'Paying member', trial_active: 'Trial running', trial_expired: 'Trial ended, not paying', cancelled: 'Cancelled paid plan', account_only: 'Account, never trialled', never: 'No Academy account',
  warm: 'Warm', cooling: 'Cooling', cooling_partial: 'Cooling (history part-collected)', cold: 'Cold', none_recorded: 'No opens recorded', insufficient: 'Too few emails to judge',
  active: 'Active', starting: 'Starts later', ended: 'Ended', none: 'None', member: 'Member', trial: 'Had a trial', account: 'Account only',
  monthly: 'Monthly', quarterly: 'Quarterly', annual: 'Annual', person: 'Person', organisation: 'Organisation', system: 'System / ledger label',
  squarespace: 'Squarespace contact', email_only: 'Email only (no contact)', name_only: 'Booking Sheet name only', admin: 'Alan (admin)'
};

/** Catalogue for the builder (no getters). */
export const catalogue = () => FIELDS.map(({ get, ...f }) => ({ ...f, stage: f.stage || 'A' }));

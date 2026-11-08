/**
 * Customer filter recipes (GPT addendum 7 Nov 2026) on synthetic fixtures: recipes 1, 4, 8, 9 and 11, the Stage B
 * fields they use (campaign delivered / opened, topic clicks, period spend, Academy status + dates, Pick n Mix plan) and
 * the unknown cases (never read as "no").
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { evalNode, rowCtx } from '../lib/marketing/query/evaluate.mjs';
import { validateQuery, describe } from '../lib/marketing/query/english.mjs';
import { topicsOf } from '../lib/marketing/query/topics.mjs';
import { academyStatus } from '../lib/marketing/rebuild.mjs';

const TODAY = '2026-11-08';
const C = (field, op, value) => ({ type: 'cond', field, op, value: value ?? null });
const G = (match, items) => ({ type: 'group', match, items });
const months = (n) => ({ n, unit: 'months' });
const camp = (id, sent_on) => ({ id, subject: `Campaign ${id}`, sent_on });
const CAMPS = [camp('c10', '2026-10-22'), camp('c09', '2026-09-30'), camp('c08', '2026-08-12'), camp('c07', '2026-05-01'), camp('c06', '2025-12-01'), camp('c05', '2025-09-01')];
const ctx = { centre: { lat: 52.4, lng: -1.5 }, today: TODAY, engagementComplete: true, academyFeed: true, academyDates: true, exposureBuilt: true, windows: { warm_days: 90, cooling_days: 180 },
  campaigns: { list: CAMPS, byId: new Map(CAMPS.map((c) => [c.id, c])), start: '2025-09-01' } };
const base = (f) => ({ email: 'x@example.test', subscribed: true, profile_state: 'active', suppressed: null, record_type: 'person', value: { c: { net: 0, orders: 0 }, cp: { net: 0, orders: 0 } }, cats: {}, bookings: [], purchases: [], future: [], clicks: [], camps: { d: [], o: [], k: [] }, engagement: { delivered_campaigns: 0 }, ...f });
const run = (q, facts) => evalNode(validateQuery({ root: q }).root, rowCtx({ facts, anchor_key: 'sqs:1' }, ctx)).r;

const R1 = G('all', [C('booking', 'exists', { cats: ['beginners'] }), C('booking', 'none', { cats: ['lightroom'] }), C('miles', 'lte', 30), C('eligible', 'is_true')]);
const R4 = G('all', [G('any', [C('spend_net', 'gte', 500), C('orders', 'gte', 3)]), C('purchase', 'exists', { within: months(24) }), C('eligible', 'is_true')]);
const R8 = G('all', [C('academy_status', 'in', ['trial_expired']), C('academy_trial_end', 'within_last', { n: 90, unit: 'days' }), C('eligible', 'is_true')]);
const R9 = G('all', [C('campaign_opened', 'exists', { email_id: 'c10' }), C('click', 'none', { email_id: 'c10' }), C('eligible', 'is_true')]);
const R11 = G('all', [C('record_type', 'in', ['person']), C('orders', 'eq', 0), C('future_booking', 'none', {}), C('identity_review', 'is_false'), C('history_incomplete', 'is_false'),
  C('academy_status', 'in', ['never', 'account_only']), C('campaign_received', 'count_gte', { count: 3, within: months(12) }), C('campaign_opened', 'none', { within: months(12) }), C('click', 'none', { within: months(12) })]);

test('recipe 1: beginners booked, no Lightroom, near, emailable — unknown when a name-only record could hide Lightroom', () => {
  const near = { lat: 52.41, lng: -1.51 };
  const yes = base({ ...near, cats: { beginners: { c: 1, p: 0 } }, bookings: [{ cats: ['beginners'], date: '2026-03-01' }] });
  assert.equal(run(R1, yes), 'yes');
  assert.equal(run(R1, { ...yes, bookings: [...yes.bookings, { cats: ['lightroom'], date: '2026-05-01' }] }), 'no');
  assert.equal(run(R1, { ...yes, cats: { beginners: { c: 1, p: 0 }, lightroom: { c: 0, p: 1 } } }), 'unknown');
  assert.equal(run(R1, { ...yes, lat: null, lng: null }), 'unknown');
});

test('recipe 4: valuable returning clients — spend or orders, bought within 24 months', () => {
  const p = base({ value: { c: { net: 640, orders: 2 }, cp: { net: 640, orders: 2 } }, purchases: [{ level: 'c', date: '2025-06-01', net: 640, cats: [] }] });
  assert.equal(run(R4, p), 'yes');
  assert.equal(run(R4, { ...p, purchases: [{ level: 'c', date: '2023-06-01', net: 640, cats: [] }] }), 'no');
});

test('recipe 8: Academy trial ended within 90 days, not paying; Academy feed missing → unknown', () => {
  const p = base({ academy_detail: { status: 'trial_expired', trial_end: '2026-10-01' } });
  assert.equal(run(R8, p), 'yes');
  assert.equal(run(R8, { ...p, academy_detail: { status: 'paid_active', trial_end: '2026-10-01' } }), 'no');
  assert.equal(evalNode(R8, rowCtx({ facts: p, anchor_key: 'sqs:1' }, { ...ctx, academyFeed: false })).r, 'unknown');
  assert.equal(academyStatus({ had_trial: true }, { start: '2026-10-01', end: '2026-10-15' }, TODAY), 'trial_expired');
  assert.equal(academyStatus({}, { start: '2026-11-01', end: '2026-11-15' }, TODAY), 'trial_active');
  assert.equal(academyStatus({ active_member: true }, null, TODAY), 'paid_active');
});

test('recipe 9: opened campaign X, no click on X; a campaign outside the stored window is unknown', () => {
  const p = base({ camps: { d: ['c10'], o: ['c10'], k: [] }, engagement: { delivered_campaigns: 1 } });
  assert.equal(run(R9, p), 'yes');
  assert.equal(run(R9, { ...p, clicks: [{ email_id: 'c10', url: 'alanranger.com/x', at: '2026-10-23T09:00:00Z' }] }), 'no');
  assert.equal(run(R9, { ...p, camps: { d: ['c10'], o: [], k: [] } }), 'no');
  const old = G('all', [C('campaign_opened', 'exists', { email_id: 'c01' })]);
  assert.equal(run(old, p), 'unknown');
  assert.equal(run(R9, { ...p, camps: undefined }), 'unknown');
  const heavy = { ...p, clicks: Array.from({ length: 60 }, (_, i) => ({ email_id: 'c09', url: `alanranger.com/p${i}`, at: '2026-10-01T09:00:00Z' })) };
  assert.equal(run(R9, heavy), 'yes');
  assert.equal(run(R9, { ...heavy, camps: { d: ['c10'], o: ['c10'], k: ['c10'] } }), 'no');
});

test('recipe 11: clean-up review needs enough exposure and no opens or clicks in the window', () => {
  const silent = base({ camps: { d: ['c10', 'c09', 'c08', 'c07'], o: [], k: [] }, engagement: { delivered_campaigns: 4 }, academy_detail: { status: 'never' } });
  assert.equal(run(R11, silent), 'yes');
  assert.equal(run(R11, { ...silent, camps: { d: ['c10', 'c09'], o: [], k: [] }, engagement: { delivered_campaigns: 2 } }), 'no');
  assert.equal(run(R11, { ...silent, camps: { d: ['c10', 'c09', 'c08', 'c07'], o: ['c08'], k: [] } }), 'no');
  assert.equal(run(R11, { ...silent, value: { c: { net: 90, orders: 1 }, cp: { net: 90, orders: 1 } } }), 'no');
});

test('Stage B: topic clicks, period spend, plan status', () => {
  assert.deepEqual(topicsOf('alanranger.com/photography-services/beginners-lightroom-photography-course').slice(0, 3), ['lightroom', 'beginners', 'courses']);
  const p = base({ clicks: [{ url: 'alanranger.com/blogs/art-of-macro-photography', at: '2026-09-01T10:00:00Z', email_id: 'c09' }], engagement: { delivered_campaigns: 3 } });
  assert.equal(run(C('click', 'exists', { topics: ['macro'], within: months(6) }), p), 'yes');
  assert.equal(run(C('click', 'exists', { topics: ['lightroom'] }), p), 'no');
  const buyer = base({ purchases: [{ level: 'c', date: '2025-12-10', net: 300 }, { level: 'c', date: '2026-02-01', net: 200 }, { level: 'c', date: '2024-06-01', net: 900 }] });
  assert.equal(run(C('spend_period', 'sum_gte', { amount: 450, after: '2025-11-01', before: '2026-03-01' }), buyer), 'yes');
  assert.equal(run(C('spend_period', 'sum_gte', { amount: 600, after: '2025-11-01', before: '2026-03-01' }), buyer), 'no');
  assert.equal(run(C('orders_period', 'count_lte', { count: 1, after: '2025-11-01' }), { ...buyer, history_incomplete: true }), 'no');
  assert.equal(run(C('orders_period', 'count_lte', { count: 2, after: '2025-11-01' }), { ...buyer, history_incomplete: true }), 'unknown');
  assert.equal(run(C('orders_period', 'count_lte', { count: 2, after: '2025-11-01' }), buyer), 'yes');
  assert.equal(run(C('pnm_status', 'in', ['active']), base({ plans: [{ starts: '2026-10-01', ends: '2027-09-30' }] })), 'yes');
  assert.equal(run(C('pnm_status', 'in', ['active']), base({ plans: [{ starts: '2025-01-01', ends: '2025-12-31' }] })), 'no');
  assert.match(describe(validateQuery({ root: R9 }).root), /campaign/);
  assert.throws(() => validateQuery({ root: C('email_invalid', 'is_true') }), /not available yet/);
});

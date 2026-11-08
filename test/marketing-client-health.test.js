/**
 * Client list health (8 Nov 2026) on synthetic fixtures: GPT's acceptance examples (client-list-health section E), the
 * three tags' boundaries and precedence, and that every panel number re-runs in Customers to the same count.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { clientHealth, consentTag, emailTag, healthSummary, monthsBefore, overlays, purchaseTag } from '../lib/marketing/client-health.mjs';
import { protectedReason } from '../lib/marketing/cleanup.mjs';
import { rowCtx } from '../lib/marketing/query/evaluate.mjs';
import { FIELD } from '../lib/marketing/query/fields.mjs';
import { validateQuery } from '../lib/marketing/query/english.mjs';
import { runQuery } from '../lib/marketing/query/table.mjs';

const TODAY = '2026-11-08';
const ctx = { today: TODAY, asOf: TODAY, engagementComplete: true, campaigns: { list: [{ id: 'c1', sent_on: '2026-10-22' }], byId: new Map(), start: '2026-01-01' }, windows: { warm_days: 90, cooling_days: 180 }, exposureBuilt: true };
const emailCtx = { asOf: TODAY, complete: true, lastCampaign: '2026-10-22' };
const sub = { email: 'a@example.com', subscribed: true, profile_state: 'active', suppressed: null, record_type: 'person' };
const buy = (date, extra = {}) => ({ level: 'c', src: 'squarespace', date, net: 95, ...extra });
const eng = (e) => ({ delivered_campaigns: 5, opened_campaigns: 0, clicked_campaigns: 0, ...e });
const value = (net = 95) => ({ value: { c: { orders: 1, net }, cp: { orders: 1 }, p: {} } });
let seq = 0;
const person = (facts, anchor = 'sqs:x') => ({ person_id: `p${String(seq += 1).padStart(3, '0')}`, anchor_key: anchor, facts: { record_type: 'person', ...facts } });
const rowOf = (p) => ({ ...rowCtx(p, ctx), windows: ctx.windows });
const get = (key, facts) => FIELD.get(key).get(rowOf(person(facts)));

test('E1: bought 2 months ago + unsubscribed → 0–6 months, not subscribed, counted as recent not eligible, never eligible', () => {
  const f = { ...sub, subscribed: false, purchases: [buy('2026-09-08')], ...value() };
  assert.equal(get('purchase_band', f), 'p0_6');
  assert.equal(get('consent_state', f), 'not_subscribed');
  assert.equal(get('eligible', f), false);
  const h = clientHealth([person(f)], rowOf, { asOf: TODAY });
  assert.equal(h.cards.recent_not_eligible.total.n, 1);
  assert.equal(h.cards.recent_not_eligible.not_subscribed.n, 1);
  assert.equal(healthSummary(h).recent_not_eligible.not_subscribed, 1);
});

test('E2: bought 8 months ago + clicked 10 days ago + subscribed → >6–12 months, email hot, can email (each dimension separate)', () => {
  const f = { ...sub, purchases: [buy('2026-03-08')], engagement: eng({ opened_campaigns: 3, clicked_campaigns: 1, last_click_at: '2026-10-29T10:00:00Z', last_open_at: '2026-10-29T09:00:00Z' }) };
  assert.deepEqual([get('purchase_band', f), get('email_health', f), get('consent_state', f)], ['p6_12', 'hot', 'can_email']);
});

test('E3: bought 30 months ago + opened 20 days ago → lapsed, warm open-only; a reactivation opportunity, not dead', () => {
  const f = { ...sub, purchases: [buy('2024-05-08')], engagement: eng({ opened_campaigns: 2, last_open_at: '2026-10-19T18:00:00Z' }) };
  assert.equal(get('purchase_band', f), 'p24_plus');
  assert.equal(get('email_health', f), 'warm_open');
  const h = clientHealth([person(f)], rowOf, { asOf: TODAY });
  assert.equal(h.cards.lapsed_engaged.open_only.n, 1);
  assert.equal(h.cards.lapsed_engaged.click_supported.n, 0);
});

test('E4: new subscriber with no emails → email health unknown (not emailed yet), never cold / no response / a clean-up candidate', () => {
  const f = { ...sub, profile_created: '2026-11-01T10:00:00Z', engagement: null };
  const t = emailTag(f, emailCtx);
  assert.equal(t.state, 'e_unknown');
  assert.equal(t.reason, 'subscribed_after_last_collected_campaign');
  assert.equal(emailTag({ ...f, profile_created: '2026-01-01' }, emailCtx).reason, 'not_emailed_yet');
  assert.equal(get('purchase_band', f), 'p_none');
  const h = clientHealth([person(f)], rowOf, { asOf: TODAY });
  assert.equal(h.email_health.states.e_unknown.n, 1);
  assert.equal(h.email_health.states.cold.n + h.email_health.states.no_response.n, 0);
});

test('E5: bought 18 months ago + future booking → >12–24 months plus booked ahead; protected from clean-up', () => {
  const f = { ...sub, purchases: [buy('2025-05-08')], future: [{ date: '2026-12-05', title: 'Woodland workshop', level: 'c', cats: [] }], booking_count: 1, ...value() };
  assert.equal(get('purchase_band', f), 'p12_24');
  assert.equal(get('booked_ahead', f), true);
  assert.deepEqual(overlays(f, TODAY).booked_ahead, { date: '2026-12-05', title: 'Woodland workshop' });
  assert.ok(protectedReason(f, TODAY));
  assert.equal(get('booked_ahead', { ...f, future: [{ date: '2026-12-05', level: 'p' }] }), false, 'a probable (name-match) booking is not "booked ahead"');
});

test('E6: no recorded response but a recent buyer / member / manual hold → no-response signal, still protected from clean-up', () => {
  const silent = { ...sub, engagement: eng({ delivered_campaigns: 6 }), value: { c: { orders: 0, net: 0 }, cp: { orders: 0 } }, booking_count: 0, future: [], cats: {} };
  assert.equal(get('email_health', silent), 'no_response');
  assert.equal(protectedReason(silent, TODAY), null);
  assert.equal(protectedReason({ ...silent, purchases: [buy('2026-08-01')], ...value() }, TODAY), 'buyer');
  assert.equal(protectedReason({ ...silent, academy_detail: { status: 'paid_active' } }, TODAY), 'academy_member');
  const held = { ...silent, relationship_hold: { reason: 'Talking about a commission', set_at: '2026-11-08T09:00:00Z' } };
  assert.equal(protectedReason(held, TODAY), 'relationship_hold');
  assert.equal(get('relationship_hold', held), true);
  assert.equal(get('email_health', held), 'no_response', 'a hold changes no tag');
  assert.equal(get('consent_state', held), 'can_email');
});

test('E7: unknown source / probable-only / incomplete history → Unknown row, never "no evidenced purchase"', () => {
  assert.equal(get('purchase_band', { ...sub, purchases: [buy('2026-10-01', { level: 'p', src: 'booking_sheet' })] }), 'p_unknown');
  assert.equal(get('purchase_band', { ...sub, history_incomplete: true }), 'p_unknown');
  assert.equal(get('purchase_band', { ...sub, cats: { lightroom: { c: 0, p: 1 } } }), 'p_unknown');
  const both = purchaseTag({ ...sub, history_incomplete: true, purchases: [buy('2026-10-01'), buy('2026-10-20', { level: 'p' })] }, TODAY);
  assert.equal(both.band, 'p0_6', 'a confirmed purchase classifies by its evidence');
  assert.equal(both.last, '2026-10-01', 'the probable later sale never sets the band');
  assert.equal(both.probable_last, '2026-10-20');
  assert.equal(both.incomplete, true);
  assert.equal(get('email_health', { ...sub, email: null }), 'e_unknown');
  assert.equal(emailTag({ ...sub, engagement: eng({ delivered_campaigns: 6 }) }, { ...emailCtx, complete: false }).state, 'e_unknown');
  assert.equal(emailTag({ ...sub, engagement: eng({ last_open_at: '2025-01-01T10:00:00Z', opened_campaigns: 1 }) }, { ...emailCtx, complete: false }).state, 'e_unknown', 'cold needs complete coverage');
});

test('undated confirmed purchases (plan payments without a date) → Unknown, never "no evidenced purchase"; dated ones still set the band', () => {
  const undated = [buy(null, { src: 'plan', net: 4500 }), buy(undefined, { src: 'plan', net: 150 })];
  const t = purchaseTag({ ...sub, purchases: undated }, TODAY);
  assert.equal(t.band, 'p_unknown');
  assert.equal(t.reason, 'confirmed_purchases_without_dates');
  assert.equal(t.undated_confirmed, 2);
  assert.equal(get('purchase_band', { ...sub, purchases: undated }), 'p_unknown');
  assert.equal(purchaseTag({ ...sub, purchases: [...undated, buy('2025-12-01')] }, TODAY).band, 'p6_12', 'the latest dated one sets the band');
  assert.equal(purchaseTag({ ...sub, purchases: [buy(null, { cancelled: true }), buy(null, { duplicate_of: '#9', net: 0 })] }, TODAY).band, 'p_none', 'cancelled / duplicate undated rows are not purchases');
  const h = clientHealth([person({ ...sub, purchases: undated })], rowOf, { asOf: TODAY });
  assert.equal(h.cards.purchase_unknown.total.n, 1);
  assert.equal(h.cards.subscribers_no_purchase.total.n, 0);
  assert.equal(runQuery([person({ ...sub, purchases: undated })], { root: h.cards.purchase_unknown.total.root }, ctx).total, 1);
});

test('email day count: whole London calendar days from the response day (180 = cooling, 181 = cold), any time of day', () => {
  const st = (iso) => emailTag({ ...sub, engagement: eng({ last_open_at: iso, opened_campaigns: 1 }) }, emailCtx);
  assert.deepEqual([st('2026-05-12T00:05:00+01:00').state, st('2026-05-12T00:05:00+01:00').days], ['cooling', 180]);
  assert.deepEqual([st('2026-05-12T23:55:00+01:00').state, st('2026-05-12T23:55:00+01:00').days], ['cooling', 180]);
  assert.deepEqual([st('2026-05-11T23:30:00Z').state, st('2026-05-11T23:30:00Z').days], ['cooling', 180], '23:30 UTC on 11 May is 00:30 on 12 May in London (BST)');
  assert.deepEqual([st('2026-05-11T22:30:00Z').state, st('2026-05-11T22:30:00Z').days], ['cold', 181], '22:30 UTC = 23:30 on 11 May in London');
});

test('only paid, own purchases count: cancelled, duplicate, refunded, zero and attendee places do not', () => {
  const nope = [buy('2026-10-01', { cancelled: true }), buy('2026-10-02', { duplicate_of: '#123', net: 0 }), buy('2026-10-03', { net: -50, refund_line: true }), buy('2026-10-04', { net: 0 })];
  assert.equal(get('purchase_band', { ...sub, purchases: nope }), 'p_none');
  assert.equal(get('purchase_band', { ...sub, purchases: [], bookings: [{ role: 'attendee', date: '2026-10-01' }], booking_count: 1 }), 'p_none');
  assert.equal(purchaseTag({ purchases: [buy('2026-10-01T23:30:00Z'), buy('2024-01-01', { src: 'plan' })] }, TODAY).last, '2026-10-02', 'London day of the order time');
});

test('boundary dates classify exactly once (calendar months, inclusive) and month ends clamp', () => {
  const cases = [['2026-05-08', 'p0_6'], ['2026-05-07', 'p6_12'], ['2025-11-08', 'p6_12'], ['2025-11-07', 'p12_24'], ['2024-11-08', 'p12_24'], ['2024-11-07', 'p24_plus'], ['2026-11-08', 'p0_6']];
  for (const [d, band] of cases) assert.equal(purchaseTag({ purchases: [buy(d)] }, TODAY).band, band, d);
  assert.equal(monthsBefore('2026-08-31', 6), '2026-02-28');
  assert.equal(monthsBefore('2028-08-31', 6), '2028-02-29');
  assert.equal(monthsBefore('2026-01-15', 12), '2025-01-15');
  const people = cases.map(([d]) => person({ ...sub, purchases: [buy(d)] }));
  const h = clientHealth(people, rowOf, { asOf: TODAY });
  assert.equal(h.matrix.total.people.n, people.length);
  assert.equal(h.matrix.rows.reduce((a, r) => a + r.total.people.n, 0), people.length);
});

test('email health: day windows (not months) and the exclusive order', () => {
  const at = (d) => `${d}T12:00:00Z`;
  const st = (e) => emailTag({ ...sub, engagement: eng(e) }, emailCtx).state;
  assert.equal(st({ last_click_at: at('2026-10-09'), clicked_campaigns: 1 }), 'hot');
  assert.equal(st({ last_click_at: at('2026-10-08'), clicked_campaigns: 1 }), 'warm_click');
  assert.equal(st({ last_click_at: at('2026-08-01'), last_open_at: at('2026-10-30'), clicked_campaigns: 1, opened_campaigns: 2 }), 'warm_open');
  assert.equal(st({ last_open_at: at('2026-08-10'), opened_campaigns: 1 }), 'warm_open');
  assert.equal(st({ last_open_at: at('2026-08-09'), opened_campaigns: 1 }), 'cooling');
  assert.equal(st({ last_open_at: at('2026-05-12'), opened_campaigns: 1 }), 'cooling');
  assert.equal(st({ last_open_at: at('2026-05-11'), opened_campaigns: 1 }), 'cold');
  assert.equal(st({ delivered_campaigns: 2 }), 'too_few');
  assert.equal(st({ delivered_campaigns: 3 }), 'no_response');
  assert.equal(st({ opened_campaigns: 1 }), 'e_unknown', 'a response without a recorded time is not "no response"');
});

test('consent: exclusive precedence, overlapping reasons kept, never inferred from a purchase', () => {
  assert.equal(consentTag({ ...sub, suppressed: 'unsubscribed_elsewhere' }).state, 'blocked');
  assert.deepEqual(consentTag({ ...sub, subscribed: false, suppressed: 'complaint' }).reasons, ['blocked:complaint', 'not_subscribed']);
  assert.equal(consentTag({ ...sub, subscribed: false }).state, 'not_subscribed');
  assert.equal(consentTag({ email: 'b@example.com', profile_state: 'none', subscribed: false }).state, 'email_no_contact');
  assert.equal(consentTag({ email: 'b@example.com', profile_state: 'deleted', subscribed: false }).state, 'email_no_contact');
  assert.equal(consentTag({ email: null, profile_state: 'none', purchases: [buy('2026-10-01')], plans: [{ starts: '2026-01-01' }] }).state, 'no_email');
  assert.equal(consentTag({ email: 'c@example.com', profile_state: 'none', purchases: [buy('2026-10-01')], academy_detail: { status: 'paid_active' } }).state, 'email_no_contact');
});

test('people vs addresses: a shared email is two people and one address; organisations, system labels and Alan apart; tile 9 reconciles', () => {
  const shared = { ...sub, email: 'family@example.com', email_shared: true };
  const people = [
    person(shared, 'sqs:1'), person({ ...shared, subscribed: false, profile_state: 'none' }, 'email:1'),
    person({ ...sub, email: 'org@example.com', record_type: 'organisation' }, 'sqs:2'),
    person({ email: null, name: 'Pick n Mix Subs', record_type: 'system' }, 'name:pnm'),
    person({ ...sub, email: 'alan@alanranger.com', admin: true }, 'sqs:3'),
    person({ ...sub, email: 'gone@example.com', stale: true }, 'sqs:4')
  ];
  const h = clientHealth(people, rowOf, { asOf: TODAY });
  assert.equal(h.matrix.total.people.n, 2, 'owner / test addresses are not people in the matrix');
  assert.equal(h.matrix.total.addresses, 1);
  assert.equal(h.matrix.rows.find((r) => r.band === 'p_none').total.addresses, 1);
  assert.equal(h.apart.organisations.total, 1);
  assert.equal(h.apart.system_labels, 1);
  assert.equal(h.apart.owners.total, 1);
  assert.deepEqual([h.reconciliation.can_email_people, h.reconciliation.owner_addresses, h.reconciliation.organisations, h.reconciliation.tile9, h.reconciliation.gap], [1, 1, 1, 3, 0]);
});

/** Minimal stand-in for the Supabase client: records each chain, answers select / insert / update. */
function fakeSb(row) {
  const log = [];
  const answer = (st) => {
    const ops = st.ops.map(([k]) => k);
    if (ops.includes('insert')) return { data: { hold_id: 'h1', set_at: '2026-11-08T09:00:00Z' }, error: null };
    if (ops.includes('update')) return { data: [{ hold_id: 'h1' }], error: null };
    return { data: row, error: null };
  };
  const from = (table) => {
    const st = { table, ops: [] };
    log.push(st);
    const b = new Proxy({}, { get: (_, k) => {
      if (k === 'then') return (res) => res(answer(st));
      if (k === 'maybeSingle' || k === 'single') return async () => answer(st);
      return (...a) => { st.ops.push([k, a]); return b; };
    } });
    return b;
  };
  return { from, log };
}

test('relationship hold: typed reason, one active hold, logged in its table and on the person at once; clearing keeps the record', async () => {
  const { QUERY_POSTS } = await import('../lib/marketing/query/api.mjs');
  const row = { person_id: 'p1', anchor_key: 'sqs:9', facts: { ...sub } };
  await assert.rejects(QUERY_POSTS['relationship-hold-set'](fakeSb(row), { person_id: 'p1', reason: 'short' }), /10\+ characters/);
  const sb = fakeSb(row);
  const out = await QUERY_POSTS['relationship-hold-set'](sb, { person_id: 'p1', reason: 'Discussing a school commission' });
  assert.equal(out.relationship_hold.reason, 'Discussing a school commission');
  const ins = sb.log.find((s) => s.table === 'marketing_relationship_holds').ops.find(([k]) => k === 'insert')[1][0];
  assert.deepEqual([ins.person_id, ins.anchor_key], ['p1', 'sqs:9']);
  const patch = sb.log.filter((s) => s.table === 'customer_person').flatMap((s) => s.ops).find(([k]) => k === 'update')[1][0];
  assert.equal(patch.facts.relationship_hold.hold_id, 'h1');
  assert.equal(patch.facts.subscribed, true, 'the rest of the facts are kept');
  await assert.rejects(QUERY_POSTS['relationship-hold-set'](fakeSb({ ...row, facts: { relationship_hold: { reason: 'x' } } }), { person_id: 'p1', reason: 'Another reason here' }), /already has/);
  const sb2 = fakeSb({ ...row, facts: { relationship_hold: { reason: 'x' } } });
  const cleared = await QUERY_POSTS['relationship-hold-clear'](sb2, { person_id: 'p1', reason: 'Commission finished, no hold' });
  assert.equal(cleared.cleared, 1);
  const upd = sb2.log.find((s) => s.table === 'marketing_relationship_holds').ops;
  assert.ok(upd.find(([k]) => k === 'update')[1][0].cleared_at);
  assert.ok(!upd.some(([k]) => k === 'delete'));
});

test('every panel number re-runs in Customers to the same count (no undecided rows), and its query validates', () => {
  const people = [
    person({ ...sub, subscribed: false, purchases: [buy('2026-09-08')], ...value(120) }),
    person({ ...sub, email: 'b@example.com', purchases: [buy('2026-03-08')], engagement: eng({ last_click_at: '2026-10-29T10:00:00Z', clicked_campaigns: 1 }) }),
    person({ ...sub, email: 'c@example.com', purchases: [buy('2024-05-08')], engagement: eng({ last_open_at: '2026-10-19T10:00:00Z', opened_campaigns: 1 }) }),
    person({ email: null, profile_state: 'none', purchases: [buy('2026-07-01')], future: [{ date: '2026-12-01', level: 'c' }], ...value(300) }),
    person({ ...sub, email: 'd@example.com', suppressed: 'bounced', purchases: [buy('2025-01-01')] }),
    person({ ...sub, email: 'e@example.com', history_incomplete: true }),
    person({ ...sub, email: 'f@example.com', engagement: eng({ delivered_campaigns: 1 }) })
  ];
  const h = clientHealth(people, rowOf, { asOf: TODAY });
  const nums = [];
  const walk = (o, path) => {
    if (!o || typeof o !== 'object') return;
    if (o.root && typeof o.n === 'number') { nums.push([path, o]); return; }
    Object.entries(o).forEach(([k, v]) => walk(v, `${path}.${k}`));
  };
  walk({ matrix: h.matrix, cards: h.cards, email_health: h.email_health }, '');
  assert.ok(nums.length > 60);
  for (const [path, o] of nums.filter(([p]) => !p.endsWith('.net'))) {
    const r = runQuery(people, { root: o.root }, ctx);
    assert.equal(r.total, o.n, path);
    assert.equal(r.results.unknown, 0, path);
    assert.deepEqual(validateQuery({ root: o.root }).root, o.root, path);
  }
  assert.equal(h.cards.recent_not_eligible.total.n, 2);
  assert.equal(h.cards.recent_not_eligible.booked_ahead.n, 1);
  assert.equal(h.cards.recent_not_eligible.net, 420);
  assert.equal(h.email_health.sum, h.email_health.denominator.n);
  assert.equal(h.email_health.sums_exactly, true);
});

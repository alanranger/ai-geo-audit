/**
 * Identity match order (Alan, option 1, 9 Nov 2026) on synthetic fixtures (example.com, no real people):
 * row email → order ref → exact unique full name; never merged into owner / permanently excluded records; consent and
 * suppression unchanged; everything unresolved is the review queue that Customers counts as "undecided".
 *   node --test test/marketing-identity-match-order.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import xlsx from 'xlsx';
import { computeAll } from '../lib/marketing/rebuild.mjs';
import { clientHealth, Q } from '../lib/marketing/client-health.mjs';
import { rowCtx } from '../lib/marketing/query/evaluate.mjs';
import { runQuery } from '../lib/marketing/query/table.mjs';
import { emailHash } from '../lib/marketing/store.mjs';
import { OWNER_EXCLUSION, resolveName, nameDirectory } from '../lib/marketing/identity-names.mjs';
import { parseWorkshopsTab } from '../lib/booking-sheet-workshops.mjs';
import { parseContactTabs } from '../lib/booking-sheet-contacts.mjs';

const TODAY = '2026-11-09';
const profile = (id, email, first, last, extra = {}) => ({ profile_id: id, email, first_name: first, last_name: last, accepts_marketing: true, missing_since: null, ...extra });
const order = (id, num, email, extra = {}) => ({ order_id: id, order_number: num, customer_email: email, created_on: '2026-08-01T10:00:00Z', grand_total_gbp: 100, refunded_total_gbp: 0, payment_state: 'PAID', fulfillment_status: 'FULFILLED', testmode: false, ...extra });
const ws = (id, name, extra = {}) => ({ id, event_start: '2026-08-10', theme_location: 'Woodland Walk', source: 'Google', order_ref: null, client_name: name, email: null, is_multi_day: false, ...extra });
const tx = (row, name, amount, extra = {}) => ({ source_workbook: 'Sales 2026', source_row: row, txn_date: '2026-09-01', client_name: name, category_label: '7. 1-2-1', event_label: 'x', channel: null, is_redemption: false, amount, funding: 'Stripe', ...extra });

function source(over = {}) {
  return {
    profiles: [
      profile('p1', 'ann@example.com', 'Ann', 'Lee'), profile('p2', 'sam@example.com', 'Sam', 'Shaw', { accepts_marketing: false }),
      profile('p3', 'kim@example.com', 'Kim', 'Day'), profile('p4', 'kim.day@example.com', 'Kim', 'Day'),
      profile('po', 'owner@example.com', 'Alan', 'Ranger'), profile('pt', 'test@example.com', 'Alan', 'Ranger'),
      profile('p5', 'ex@example.com', 'Ex', 'Client'), profile('p6', 'res@example.com', 'Rhea', 'Stone'), profile('p7', 'chris@example.com', 'Christopher', 'Bell'),
      profile('p8', 'chrissie@example.com', 'Chrissie', 'Bell')
    ],
    orders: [order('o1', 3001, 'sam@example.com', { attendee_email: 'sam@example.com', attendee_first_name: 'Sam', attendee_last_name: 'Shaw' }), order('o2', 3002, 'ann@example.com')],
    lines: [],
    workshops: [
      ws('w1', 'Ann Lee', { email: 'ann@example.com', order_ref: '#03002' }), ws('w2', 'Sam Shaw', { order_ref: '#03001' }),
      ws('w3', 'Pat Gift', { order_ref: '#03002' }), ws('w4', 'Lee Newby', { email: 'lee@example.com' })
    ],
    courses: [],
    transactions: [
      tx(1, 'Ann Lee', 120), tx(2, 'Kim Day', 80), tx(3, 'Chris Bell', 60), tx(4, 'Alan Ranger', 217), tx(5, 'Ex Client', 25),
      tx(6, 'Rhea Stone', 50), tx(7, 'Pure Photo', 300, { funding: 'Bank' }), tx(8, 'Nobody Known', 40), tx(9, 'Lee Newby', 30)
    ],
    suppression: [{ email_hash: emailHash('ex@example.com'), reason: OWNER_EXCLUSION, resolved_at: null }, { email_hash: emailHash('res@example.com'), reason: 'unsubscribed', resolved_at: null }],
    owners: [{ email: 'owner@example.com' }],
    members: [], geo: [], canonicalIndex: new Map(), overrides: [],
    ...over
  };
}

const build = (over) => computeAll(source(over), TODAY);
const linkOf = (st, source, id) => st.links.find((l) => l.source === source && l.source_id === id);
const ctx = { today: TODAY, asOf: TODAY, engagementComplete: true, windows: { warm_days: 90, cooling_days: 180 } };
const peopleOf = (facts) => [...facts].map(([anchor, f], i) => ({ person_id: `id${String(i).padStart(3, '0')}`, anchor_key: anchor, facts: f }));
const rowOf = (p) => ({ ...rowCtx(p, ctx), windows: ctx.windows });

test('match order: (1) the row email, (2) the order ref, (3) an exact unique full name — no separate name-only person', () => {
  const { st } = build();
  assert.deepEqual([linkOf(st, 'bs_workshop', 'w1').anchor, linkOf(st, 'bs_workshop', 'w1').match_method], ['sqs:p1', 'email_exact']);
  assert.deepEqual([linkOf(st, 'bs_workshop', 'w2').anchor, linkOf(st, 'bs_workshop', 'w2').match_method], ['sqs:p2', 'order_ref+form_name']);
  const t1 = linkOf(st, 'bs_transaction', 'Sales 2026:1');
  assert.deepEqual([t1.anchor, t1.match_method, t1.confirmed], ['sqs:p1', 'name_exact_unique', true]);
  assert.equal(linkOf(st, 'bs_workshop', 'w4').anchor, 'email:lee@example.com', 'a sheet email with no Squarespace contact is its own email record');
  assert.equal(linkOf(st, 'bs_transaction', 'Sales 2026:9').anchor, 'email:lee@example.com', 'the sheet email names Lee: the sale joins that address');
  for (const a of ['name:ann lee', 'name:sam shaw', 'name:lee newby']) assert.equal(st.persons.has(a), false, a);
});

test('the row email wins over a name match; a second address for the same name makes the name ambiguous (review)', () => {
  const { st, facts } = build({ workshops: [ws('w5', 'Ann Lee', { email: 'other@example.com' })] });
  assert.equal(linkOf(st, 'bs_workshop', 'w5').anchor, 'email:other@example.com');
  assert.equal(linkOf(st, 'bs_transaction', 'Sales 2026:1').anchor, 'name:ann lee');
  assert.equal(facts.get('name:ann lee').identity_pending, 'multiple_candidates');
});

test('Alan\'s own or business address on a client row never moves the row (falls through to order / name)', () => {
  const { st } = build({ workshops: [ws('w6', 'Ann Lee', { email: 'owner@example.com' }), ws('w7', 'Sam Shaw', { email: 'info@alanranger.com', order_ref: '#03001' })] });
  assert.deepEqual([linkOf(st, 'bs_workshop', 'w6').anchor, linkOf(st, 'bs_workshop', 'w6').match_method], ['sqs:p1', 'name_exact_unique']);
  assert.equal(linkOf(st, 'bs_workshop', 'w7').anchor, 'sqs:p2');
});

test('auto-merge moves the sale and £ onto the email-holding person (confirmed, sets the purchase band)', () => {
  const { facts } = build();
  const ann = facts.get('sqs:p1');
  assert.equal(ann.value.c.net, 220, 'order £100 + sheet 1-2-1 £120');
  assert.equal(ann.value.p.net, 0);
  assert.equal(ann.attached_records, 0);
});

test('consent and suppression of the merged-into person are unchanged; a suppressed-but-resubscribed contact stays blocked', () => {
  const before = build({ transactions: [], workshops: [] }).facts;
  const after = build().facts;
  for (const a of ['sqs:p1', 'sqs:p2', 'sqs:p6']) {
    const pick = (f) => [f.email, f.subscribed, f.suppressed, f.profile_state];
    assert.deepEqual(pick(after.get(a)), pick(before.get(a)), a);
  }
  assert.equal(after.get('sqs:p6').value.c.net, 50, 'the sale joined Res');
  const res = peopleOf(after).find((p) => p.anchor_key === 'sqs:p6');
  assert.equal(runQuery([res], { root: Q.people(Q.consent(['blocked'])) }, ctx).total, 1);
});

test('never merged into owner records: Alan\'s name stays his own record (owner), every "Alan Ranger" is owner / test', () => {
  const { st, facts } = build();
  assert.equal(linkOf(st, 'bs_transaction', 'Sales 2026:4').anchor, 'name:alan ranger');
  assert.equal(st.links.some((l) => l.anchor === 'sqs:po' && l.source.startsWith('bs_')), false);
  assert.deepEqual([facts.get('name:alan ranger').owner, facts.get('name:alan ranger').owner_kind], [true, 'owner_name']);
  assert.deepEqual([facts.get('sqs:po').owner_kind, facts.get('sqs:pt').owner_kind], ['address', 'owner_name']);
  const recentNoEmail = Q.people(Q.band(['p0_6', 'p6_12']), Q.consent(['no_email']));
  const r = runQuery(peopleOf(facts), { root: recentNoEmail }, ctx);
  assert.equal(r.members.some((p) => p.anchor_key === 'name:alan ranger'), false, 'owner leak closed');
});

test('never merged into a permanently excluded client; their records are counted apart, suppression unchanged', () => {
  const { st, facts } = build({ workshops: [ws('w9', 'Ex Client', { email: 'ex@example.com', order_ref: '#03002' })] });
  assert.equal(linkOf(st, 'bs_transaction', 'Sales 2026:5').anchor, 'name:ex client');
  assert.deepEqual([linkOf(st, 'bs_workshop', 'w9').anchor, linkOf(st, 'bs_workshop', 'w9').match_method], ['name:ex client', 'owner_exclusion_email']);
  assert.deepEqual([facts.get('name:ex client').owner, facts.get('name:ex client').owner_kind], [true, 'exclusion']);
  assert.deepEqual([facts.get('sqs:p5').owner_kind, facts.get('sqs:p5').suppressed, facts.get('sqs:p5').value.c.net], ['exclusion', OWNER_EXCLUSION, 0]);
});

test('unresolved names go to the review queue (several candidates / fuzzy / buyer-only); B2B and no-candidate names do not', () => {
  const { st, facts } = build();
  assert.equal(facts.get('name:kim day').identity_pending, 'multiple_candidates');
  assert.equal(facts.get('name:chris bell').identity_pending, 'fuzzy_name');
  assert.equal(facts.get('name:pat gift').identity_pending, 'buyer_only_order_ref');
  assert.equal(linkOf(st, 'bs_workshop', 'w3').candidate_anchor, 'sqs:p1');
  assert.equal(linkOf(st, 'bs_workshop', 'w3').confirmed, false);
  assert.deepEqual([facts.get('name:pure photo').record_type, facts.get('name:pure photo').identity_pending], ['organisation', null]);
  assert.equal(facts.get('name:nobody known').identity_pending, null);
  assert.equal(resolveName(nameDirectory({ profiles: [profile('a', 'jo@example.com', 'Jo', 'Smith'), profile('b', 'jo2@example.com', 'Jo', 'Brown')] }, {}), 'Jo').kind, 'partial');
  assert.equal(resolveName(nameDirectory({ profiles: [profile('a', 'jo@example.com', 'Jo', 'Smith')] }, { rules: false }), 'Jo').kind, 'partial', '9 Nov behaviour (rules off)');
});

test('the review link counts the queue: panel number = Customers query = undecided in the recent "no email held" query', () => {
  const people = peopleOf(build().facts);
  const h = clientHealth(people, rowOf, { asOf: TODAY });
  const queue = people.filter((p) => p.facts.identity_pending && !p.facts.owner && p.facts.record_type === 'person').length;
  assert.equal(queue, 3);
  assert.equal(h.apart.identity_review.n, queue);
  assert.equal(runQuery(people, { root: h.apart.identity_review.root }, ctx).total, queue);
  const recentNoEmail = Q.people(Q.band(['p0_6', 'p6_12']), Q.consent(['no_email']));
  const r = runQuery(people, { root: recentNoEmail }, ctx);
  const cell = h.matrix.rows.filter((x) => ['p0_6', 'p6_12'].includes(x.band)).reduce((a, x) => a + x.cells.no_email.people.n, 0);
  assert.equal(r.total, cell, 'decided "no email held" = the panel cell');
  assert.deepEqual(runQuery(people, { root: recentNoEmail }, ctx, { show: 'unknown' }).members.map((p) => p.anchor_key).sort(), ['name:chris bell', 'name:kim day']);
  assert.equal(r.results.unknown, 2, 'the "undecided — review" link counts the unresolved recent buyers');
});

/* ---------- sheet sync: emails read from the tabs ---------- */

const book = (sheets) => {
  const wb = xlsx.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(aoa), name);
  return wb;
};

test('Workshops tab: "Email Address" is synced trimmed and lower-cased; a cell without "@" is no email', () => {
  const head = ['Event Date', 'Workshop-Location/Theme', 'Time/Package', 'Duration', 'source', 'Order Ref', 'Date Booked', 'Paid', 'Balance', 'Prefix', 'First Name', 'Last Name', 'Email Address'];
  const wb = book({ Workshops: [head, [46000, 'Woodland', '', '4hrs', 'Google', '#03001', 45990, 50, 0, 'Ms', 'Ann', 'Lee', '  Ann@Example.COM  '], [46001, 'Woodland', '', '4hrs', 'Google', '', '', 50, 0, '', 'Bo', 'Wu', 'n/a']] });
  const { rows } = parseWorkshopsTab(wb, { propertyUrl: 'p' });
  assert.deepEqual(rows.map((r) => [r.client_name, r.email, r.order_ref]), [['Ann Lee', 'ann@example.com', '#03001'], ['Bo Wu', null, null]]);
});

test('other email-bearing tabs: 1-2-1\'s (header on row 5), Mentoring (unlabelled name columns), JLR requestor; Alt Email ignored', () => {
  const wb = book({
    "1-2-1's": [[], [], [], [], ["No'", 'Date Booked', 'order Ref', 'Paid', 'Email Address', 'Prefix', 'First Name', 'Last Name', 'Alt Email'], [1, 45000, '#0123', 90, 'One@Example.com ', 'Mr', 'Oli', 'One', 'alt@example.com']],
    'Mentoring ': [["No'", 'Email Address', '', '', 'Feedback method'], [1, 'ment@example.com', 'Mia', 'Mentee', 'Zoom']],
    'JLR Bookings': [['Request ID', 'Course Name', 'Requestor Name', 'Requestor Email'], ['R1', 'Lightroom', 'Jay Ell', 'JAY@example.com']],
    'Sales 2026': [['x']]
  });
  const { rows, tabs } = parseContactTabs(wb, { propertyUrl: 'p' });
  assert.deepEqual(rows.map((r) => [r.tab, r.client_name, r.email]), [['1-2-1', 'Oli One', 'one@example.com'], ['Mentoring', 'Mia Mentee', 'ment@example.com'], ['JLR Bookings', 'Jay Ell', 'jay@example.com']]);
  assert.deepEqual(tabs, { '1-2-1': 1, Mentoring: 1, 'JLR Bookings': 1 });
});

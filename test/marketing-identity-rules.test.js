/**
 * Identity auto-match rules 1–4 + Alan's stored identity decisions (10 Nov 2026) on synthetic fixtures (example.com /
 * example-jlr test domains, no real people): JLR → private address, same mailbox on another provider, a single fuzzy /
 * partial candidate, typo addresses; never into owner / excluded / relationship-hold records; decisions win over the
 * rules and survive every rebuild; consent of every kept record is unchanged.
 *   node --test test/marketing-identity-rules.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAll, loadIdentityDecisions } from '../lib/marketing/rebuild.mjs';
import { clientHealth } from '../lib/marketing/client-health.mjs';
import { rowCtx } from '../lib/marketing/query/evaluate.mjs';
import { emailHash } from '../lib/marketing/store.mjs';
import { OWNER_EXCLUSION } from '../lib/marketing/identity-names.mjs';
import { choosePrimary, groupRule, guardOk, isJlrEmail, oneEditApart, relation } from '../lib/marketing/identity-aliases.mjs';

const TODAY = '2026-11-10';
const profile = (id, email, first, last, extra = {}) => ({ profile_id: id, email, first_name: first, last_name: last, accepts_marketing: true, missing_since: null, ...extra });
const order = (id, num, email, created = '2026-08-01T10:00:00Z') => ({ order_id: id, order_number: num, customer_email: email, created_on: created, grand_total_gbp: 100, refunded_total_gbp: 0, payment_state: 'PAID', fulfillment_status: 'FULFILLED', testmode: false });
const ws = (id, name, email = null, date = '2026-08-10') => ({ id, event_start: date, theme_location: 'Woodland Walk', source: 'Google', order_ref: null, client_name: name, email, is_multi_day: false });
const tx = (row, name, amount = 50) => ({ source_workbook: 'Sales 2026', source_row: row, txn_date: '2026-09-01', client_name: name, category_label: '2. Workshops Non Residential', event_label: 'x', channel: null, is_redemption: false, amount, funding: 'Stripe' });
const contact = (id, tab, name, email) => ({ id, tab, client_name: name, email, date_booked: '2026-05-01', event_date: null });

/** Each name below has a sheet sale (name only) and several candidate addresses. */
function source(over = {}) {
  return {
    profiles: [
      profile('pj', 'jo.work@jaguarlandrover.com', 'Jo', 'Jlr', { accepts_marketing: false }),
      profile('ps', 'sam.sky@example.com', 'Sam', 'Sky'),
      profile('pt', 'tina.typo@example.com', 'Tina', 'Typo', { accepts_marketing: false }),
      profile('pc', 'christopher@example.com', 'Christopher', 'Cole'),
      profile('po', 'owner@example.com', 'Olive', 'Owner'),
      profile('pb', 'banned@example.com', 'Ben', 'Banned'),
      profile('ph', 'held@example.com', 'Hal', 'Held'),
      profile('pk', 'kat.kept@example.com', 'Kat', 'Kept'), profile('pk2', 'kat.other@example.com', 'Kat', 'Kept', { accepts_marketing: false }),
      profile('pu', 'uma.one@example.com', 'Uma', 'Unmatched'), profile('pu2', 'uma.two@example.com', 'Uma', 'Unmatched')
    ],
    orders: [order('o1', 4001, 'jo.work@jaguarlandrover.com', '2025-05-01T10:00:00Z')],
    lines: [],
    workshops: [ws('w1', 'Jo Jlr', 'jo.home@example.com'), ws('w2', 'Sam Sky', 'sam.sky@example.net'), ws('w3', 'Tina Typo', 'tinatypo@example.com', '2026-10-01'),
      ws('w4', 'Owen Owner', 'owen.owner@example.net'), ws('w5', 'Ben Banned', 'ben.banned@example.net'), ws('w6', 'Hal Held', 'hal.held@example.net'), ws('w7', 'Kat Kept', 'kat.third@example.com')],
    courses: [],
    contacts: [contact('c1', 'Mentoring', 'Owen Owner', 'owner@example.com')],
    transactions: [tx(1, 'Jo Jlr'), tx(2, 'Sam Sky'), tx(3, 'Tina Typo'), tx(4, 'Chris Cole'), tx(5, 'Ben Banned'), tx(6, 'Hal Held'), tx(7, 'Kat Kept'), tx(8, 'Uma Unmatched'), tx(9, 'Owen Owner')],
    suppression: [{ email_hash: emailHash('jo.work@jaguarlandrover.com'), reason: 'JLR address, not subscribed at first sync (7 Nov 2026)', resolved_at: null },
      { email_hash: emailHash('banned@example.com'), reason: OWNER_EXCLUSION, resolved_at: null }],
    owners: [{ email: 'owner@example.com' }],
    holds: [{ hold_id: 'h1', anchor_key: 'sqs:ph', reason: 'relationship', set_by: 'Alan', set_at: '2026-11-01' }],
    members: [], geo: [], canonicalIndex: new Map(), overrides: [],
    ...over
  };
}
const build = (over) => computeAll(source(over), TODAY);
const linkOf = (st, src, id) => st.links.find((l) => l.source === src && l.source_id === id);
const CONSENT = (f) => [f.email, f.subscribed, f.suppressed, f.profile_state, f.consent_source];

test('pure rules: JLR domains, one edit apart, same local part (r2) vs typo (r4), primary choice', () => {
  assert.ok(isJlrEmail('a@jaguarlandrover.com') && isJlrEmail('a@uk.jlr.com') && isJlrEmail('a@landrover.co.uk') && !isJlrEmail('a@notjlr-fans.com'));
  assert.ok(oneEditApart('jo@gmail.com', 'jo@gnail.com') && oneEditApart('jo@gmail.com', 'jo@gmail.co') && !oneEditApart('ab@x.com', 'ba@x.com'));
  assert.equal(relation('jsmith@gmail.com', 'jsmith@hotmail.com'), 'r2');
  assert.equal(relation('j.smith@gmail.com', 'jsmith@gmail.com'), 'r4');
  assert.equal(relation('jonsmith@x.com', 'jonsmth@x.com'), 'r4');
  assert.equal(relation('j.smith@gmail.com', 'jsmith@hotmail.com'), null, 'punctuation rule needs the same domain');
  const info = { contact: new Map([['b@x.com', { subscribed: false }], ['c@x.com', { subscribed: true }]]), lastUsed: new Map([['a@x.com', '2026-10-01'], ['b@x.com', '2025-01-01']]) };
  assert.equal(choosePrimary(['a@x.com', 'b@x.com'], info), 'b@x.com', 'a Squarespace contact wins over more recent use');
  assert.equal(choosePrimary(['b@x.com', 'c@x.com'], info), 'c@x.com', 'two contacts: the subscribed one');
  assert.equal(choosePrimary(['a@x.com', 'd@x.com'], info), 'a@x.com', 'no contact: the most recently used');
  assert.equal(groupRule(['p@x.com', 'q@y.com'], info), null, 'two unrelated private addresses stay for review');
  assert.equal(groupRule(['p@x.com', 'w@jlr.com', 'v@jaguar.com'], info).rule, 'r1_jlr_private');
});

test('rule 1: JLR work address + one private address → the private one; the JLR contact is an alias with its own consent', () => {
  const { st, facts } = build();
  const sale = linkOf(st, 'bs_transaction', 'Sales 2026:1');
  assert.deepEqual([sale.anchor, sale.match_method, sale.confirmed], ['email:jo.home@example.com', 'name_r1_jlr_private', true]);
  assert.equal(linkOf(st, 'sqs_order', 'o1').anchor, 'email:jo.home@example.com', 'the JLR address\'s order belongs to the person');
  const jlr = facts.get('sqs:pj');
  assert.deepEqual([jlr.alias_of, jlr.attached_to], ['email:jo.home@example.com', 'email:jo.home@example.com']);
  assert.deepEqual(CONSENT(jlr), CONSENT(build({ identityRules: false }).facts.get('sqs:pj')), 'the JLR contact keeps its own consent / suppression');
  const home = facts.get('email:jo.home@example.com');
  assert.deepEqual(home.aliases.map((a) => [a.email, a.profile_state, a.suppressed?.slice(0, 3)]), [['jo.work@jaguarlandrover.com', 'active', 'JLR']]);
  assert.equal(home.jlr.c, 0, 'the JLR channel flag is unchanged by the merge (category, not channel)');
  assert.equal(facts.has('name:jo jlr'), false, 'the name record is merged, not queued');
});

test('rule 2: same mailbox on another provider → one person, primary = the Squarespace contact', () => {
  const { st, facts } = build();
  assert.equal(linkOf(st, 'bs_transaction', 'Sales 2026:2').match_method, 'name_r2_same_local');
  assert.equal(linkOf(st, 'bs_workshop', 'w2').anchor, 'sqs:ps', 'the other provider\'s row joins the contact');
  assert.equal(facts.has('email:sam.sky@example.net'), false, 'the email-only alias record is no longer produced (kept as stale on save)');
  assert.deepEqual(facts.get('sqs:ps').aliases.map((a) => [a.email, a.profile_state]), [['sam.sky@example.net', 'none']]);
});

test('rule 3: a fuzzy or partial name with exactly one candidate is accepted; two candidates stay for review', () => {
  const { st } = build();
  assert.deepEqual([linkOf(st, 'bs_transaction', 'Sales 2026:4').anchor, linkOf(st, 'bs_transaction', 'Sales 2026:4').match_method], ['sqs:pc', 'name_r3_fuzzy']);
  const two = build({ profiles: [...source().profiles, profile('pc2', 'chrissy@example.com', 'Chrissy', 'Cole')] });
  assert.equal(two.facts.get('name:chris cole').identity_pending, 'fuzzy_name');
  const partial = build({ transactions: [tx(20, 'Christopher')] });
  assert.equal(linkOf(partial.st, 'bs_transaction', 'Sales 2026:20').match_method, 'name_r3_partial');
});

test('rule 4: typo addresses (punctuation-insensitive local part) → one person; with no contact on the typo, the contact is primary', () => {
  const { st, facts } = build();
  assert.deepEqual([linkOf(st, 'bs_transaction', 'Sales 2026:3').anchor, linkOf(st, 'bs_transaction', 'Sales 2026:3').match_method], ['sqs:pt', 'name_r4_typo']);
  assert.equal(linkOf(st, 'bs_workshop', 'w3').anchor, 'sqs:pt');
  assert.deepEqual(CONSENT(facts.get('sqs:pt')), CONSENT(build({ identityRules: false }).facts.get('sqs:pt')), 'primary consent unchanged');
});

test('never auto-merge into owner / excluded / relationship-hold records: those names stay for review', () => {
  const { st, facts } = build({ transactions: [tx(5, 'Ben Banned'), tx(6, 'Hal Held')], contacts: [], workshops: [ws('w5', 'Ben Banned', 'banned@example.net'), ws('w6', 'Hal Held', 'held@example.net')] });
  assert.equal(linkOf(st, 'bs_transaction', 'Sales 2026:6').anchor, 'name:hal held', 'held contact: same mailbox, but no rule merge');
  assert.equal(facts.get('name:hal held').identity_pending, 'multiple_candidates');
  assert.equal(facts.has('email:held@example.net'), true, 'the other address stays its own record');
  const unheld = build({ holds: [], transactions: [tx(6, 'Hal Held')], contacts: [], workshops: [ws('w6', 'Hal Held', 'held@example.net')] });
  assert.equal(linkOf(unheld.st, 'bs_transaction', 'Sales 2026:6').match_method, 'name_r2_same_local', 'without the hold, rule 2 would merge');
  assert.equal(guardOk({ primary: 'a@x.com', aliases: ['owner@example.com'] }, 'name:a', { heldAnchors: new Set(), separatePairs: new Set(), blocked: (e) => e === 'owner@example.com' }), false);
  assert.equal(linkOf(st, 'bs_transaction', 'Sales 2026:5').anchor, 'name:ben banned', 'excluded client: never merged');
  assert.equal(facts.get('sqs:pb').aliases, undefined);
  assert.equal(facts.get('sqs:ph').aliases, undefined);
  const owner = build({ contacts: [], workshops: [ws('w4', 'Olive Owner', 'olive@example.net')], transactions: [tx(11, 'Olive Owner')] });
  assert.equal(linkOf(owner.st, 'bs_transaction', 'Sales 2026:11').anchor, 'name:olive owner', 'Alan\'s own address: owner record, never a merge');
  assert.equal(owner.facts.get('sqs:po').aliases, undefined);
});

const DECISIONS = [
  { kind: 'attach', subject_anchor: 'name:kat kept', target_anchor: 'sqs:pk2' },
  { kind: 'alias', subject_anchor: 'email:kat.third@example.com', target_anchor: 'sqs:pk2' },
  { kind: 'separate', subject_anchor: 'sqs:pk', target_anchor: 'sqs:pk2' },
  { kind: 'unmatched', subject_anchor: 'name:uma unmatched', target_anchor: null }
];

test('Alan\'s decisions: attach / alias / separate / unmatched; decisions win over the rules', () => {
  const plain = build();
  assert.equal(plain.facts.get('name:kat kept').identity_pending, 'multiple_candidates');
  assert.equal(plain.facts.get('name:uma unmatched').identity_pending, 'multiple_candidates');
  const { st, facts } = build({ identityDecisions: DECISIONS });
  assert.deepEqual([linkOf(st, 'bs_transaction', 'Sales 2026:7').anchor, linkOf(st, 'bs_transaction', 'Sales 2026:7').match_method], ['sqs:pk2', 'name_decision']);
  assert.equal(linkOf(st, 'bs_workshop', 'w7').anchor, 'sqs:pk2', 'the alias address joins the primary Alan chose (not the subscribed contact)');
  assert.equal(facts.get('sqs:pk').alias_of, undefined, 'separate: never merged');
  assert.deepEqual([facts.get('name:uma unmatched').identity_pending, linkOf(st, 'bs_transaction', 'Sales 2026:8').match_method], [null, 'name_unmatched_decided']);
  assert.deepEqual(st.identityPlan.decisions, { applied: 4, skipped_guard: 0, skipped_invalid: 0 });
  const typoOverride = build({ identityDecisions: [{ kind: 'attach', subject_anchor: 'name:tina typo', target_anchor: 'email:tinatypo@example.com' }, { kind: 'alias', subject_anchor: 'sqs:pt', target_anchor: 'email:tinatypo@example.com' }] });
  assert.equal(linkOf(typoOverride.st, 'bs_transaction', 'Sales 2026:3').anchor, 'email:tinatypo@example.com', 'Alan\'s primary wins over rule 4');
  assert.equal(typoOverride.facts.get('sqs:pt').alias_of, 'email:tinatypo@example.com');
});

test('a separate decision blocks a rule merge; a decision naming an owner / excluded / held record is never applied', () => {
  const sep = build({ identityDecisions: [{ kind: 'separate', subject_anchor: 'sqs:ps', target_anchor: 'email:sam.sky@example.net' }] });
  assert.equal(sep.facts.get('name:sam sky').identity_pending, 'multiple_candidates');
  const bad = build({ identityDecisions: [{ kind: 'attach', subject_anchor: 'name:hal held', target_anchor: 'sqs:ph' }, { kind: 'alias', subject_anchor: 'email:ben.banned@example.net', target_anchor: 'sqs:pb' }, { kind: 'alias', subject_anchor: 'sqs:ps', target_anchor: 'sqs:po' }] });
  assert.deepEqual(bad.st.identityPlan.decisions, { applied: 0, skipped_guard: 3, skipped_invalid: 0 });
  assert.equal(bad.facts.get('sqs:ps').alias_of, undefined);
});

test('stored decisions survive a rebuild: loaded by person_id every run → the same merge each time', async () => {
  const ids = { 'd-sub': 'name:kat kept', 'd-pk2': 'sqs:pk2', 'd-third': 'email:kat.third@example.com', 'd-uma': 'name:uma unmatched' };
  const tables = {
    marketing_identity_decisions: [{ kind: 'attach', subject_person_id: 'd-sub', target_person_id: 'd-pk2', cleared_at: null }, { kind: 'alias', subject_person_id: 'd-third', target_person_id: 'd-pk2', cleared_at: null },
      { kind: 'unmatched', subject_person_id: 'd-uma', target_person_id: null, cleared_at: null }, { kind: 'alias', subject_person_id: 'd-uma', target_person_id: 'd-pk2', cleared_at: '2026-11-10' }],
    customer_person: Object.entries(ids).map(([person_id, anchor_key]) => ({ person_id, anchor_key }))
  };
  const loaded = await loadIdentityDecisions(stubClient(tables));
  assert.equal(loaded.length, 3, 'cleared decisions are not applied');
  const first = build({ identityDecisions: loaded });
  const second = build({ identityDecisions: await loadIdentityDecisions(stubClient(tables)) });
  for (const f of [first, second]) assert.equal(linkOf(f.st, 'bs_workshop', 'w7').anchor, 'sqs:pk2');
  assert.deepEqual(JSON.stringify([...second.facts]), JSON.stringify([...first.facts]), 'same facts on every rebuild');
  assert.deepEqual(await loadIdentityDecisions(stubClient({ customer_person: [] }, ['marketing_identity_decisions'])), [], 'no table yet → no decisions');
});

test('consent of every record kept by both builds is unchanged; rules off = the 9 Nov build', () => {
  const off = build({ identityRules: false }).facts;
  const on = build({ identityDecisions: DECISIONS }).facts;
  for (const [anchor, f] of on) if (off.has(anchor)) assert.deepEqual(CONSENT(f), CONSENT(off.get(anchor)), anchor);
  assert.equal(off.get('name:jo jlr').identity_pending, 'multiple_candidates', 'rules off: still queued');
  assert.equal(off.get('name:chris cole').identity_pending, 'fuzzy_name', 'rules off: no rule 3');
});

test('a subscribed alias contact is a second address of the person, not a gap in the tile 9 reconciliation', () => {
  const { facts } = build({ profiles: [...source().profiles, profile('pk3', 'kat.third@example.com', 'Kat', 'Kept')], identityDecisions: [{ kind: 'alias', subject_anchor: 'sqs:pk3', target_anchor: 'sqs:pk' }] });
  const people = [...facts].map(([anchor_key, f], i) => ({ person_id: `id${i}`, anchor_key, facts: f }));
  const ctx = { today: TODAY, asOf: TODAY, engagementComplete: true, windows: { warm_days: 90, cooling_days: 180 } };
  const h = clientHealth(people, (p) => ({ ...rowCtx(p, ctx), windows: ctx.windows }), { asOf: TODAY });
  assert.equal(h.reconciliation.alias_addresses, 1);
  assert.equal(h.reconciliation.gap, 0);
});

/** Minimal Supabase stand-in for selectAll(): from().select().is()/in()/order()/range(). */
function stubClient(tables, missing = []) {
  return {
    from(table) {
      let rows = [...(tables[table] || [])];
      const q = {
        select: () => q, order: () => q,
        is: (col, v) => { rows = rows.filter((r) => (r[col] ?? null) === v); return q; },
        in: (col, vals) => { rows = rows.filter((r) => vals.includes(r[col])); return q; },
        range: async (a, b) => (missing.includes(table) ? { data: null, error: { message: 'relation does not exist' } } : { data: rows.slice(a, b + 1), error: null })
      };
      return q;
    }
  };
}

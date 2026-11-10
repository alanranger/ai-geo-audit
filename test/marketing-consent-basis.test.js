/**
 * Soft opt-in consent basis (10 Nov 2026, Stage 2) on synthetic fixtures (example.com, no real people):
 * marketing_decisions consent_basis rows → facts.consent_source = soft_opt_in_existing_customer for exactly those
 * addresses, before and after a Squarespace contact exists; exclusion / revoked rows never apply; subscribed /
 * suppressed / profile_state never change; the badge mark and query field; Decisions views unaffected; CSV columns.
 *   node --test test/marketing-consent-basis.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAll } from '../lib/marketing/rebuild.mjs';
import { badgesOf, consentTag } from '../lib/marketing/client-health.mjs';
import { FIELD } from '../lib/marketing/query/fields.mjs';
import { rowCtx } from '../lib/marketing/query/evaluate.mjs';
import { decisionIndex } from '../lib/marketing/decision-state.mjs';
import { emailHash } from '../lib/marketing/store.mjs';
import { SOFT_OPT_IN, SOFT_OPT_IN_BATCH, SOFT_OPT_IN_EXCLUDED, SOFT_OPT_IN_LABEL, consentBasisByHash } from '../lib/marketing/consent-basis.mjs';
import { decisionRows } from '../scripts/marketing-consent-basis-record.mjs';
import { safeOut, splitName, toCsv } from '../scripts/marketing-soft-opt-in-export.mjs';

const TODAY = '2026-11-10';
const profile = (id, email, first, last, extra = {}) => ({ profile_id: id, email, first_name: first, last_name: last, accepts_marketing: false, missing_since: null, ...extra });
const ws = (id, name, email) => ({ id, event_start: '2026-09-10', theme_location: 'Woodland Walk', source: 'Google', order_ref: null, client_name: name, email, is_multi_day: false });
const basisRow = (email, decision = SOFT_OPT_IN) => ({ decision_key: `consent_basis|${emailHash(email)}`, kind: 'consent_basis', ref_key: emailHash(email), decision });
const BATCH_ROW = { decision_key: `consent_basis|${SOFT_OPT_IN_BATCH}`, kind: 'consent_basis', ref_key: SOFT_OPT_IN_BATCH, decision: `${SOFT_OPT_IN} (batch of 2)` };

function source(over = {}) {
  return {
    profiles: [profile('p1', 'sub@example.com', 'Sue', 'Sub', { accepts_marketing: true }), profile('p2', 'declined@example.com', 'Dee', 'Clined')],
    orders: [], lines: [], courses: [], transactions: [], contacts: [], members: [], geo: [], canonicalIndex: new Map(), overrides: [], owners: [],
    workshops: [ws('w1', 'Ann Soft', 'ann@example.com'), ws('w2', 'Bob Other', 'bob@example.com'), ws('w3', 'Cat Excl', 'cat@example.com')],
    suppression: [],
    consentBasis: [BATCH_ROW, basisRow('ann@example.com'), basisRow('cat@example.com', SOFT_OPT_IN_EXCLUDED), basisRow('bob@example.com', 'revoked')],
    ...over
  };
}
const build = (over) => computeAll(source(over), TODAY).facts;
const PICK = (f) => ({ subscribed: f.subscribed, suppressed: f.suppressed, profile_state: f.profile_state });
const without = (f) => { const { consent_source: _c, ...rest } = f; return rest; };

test('only an active per-person basis row applies; exclusion, revoked and the batch row do not', () => {
  const basis = consentBasisByHash(source().consentBasis);
  assert.deepEqual([...basis.keys()], [emailHash('ann@example.com')]);
  const facts = build();
  assert.equal(facts.get('email:ann@example.com').consent_source, SOFT_OPT_IN);
  assert.equal(facts.get('email:bob@example.com').consent_source, 'no_squarespace_profile', 'revoked row: no basis');
  assert.equal(facts.get('email:cat@example.com').consent_source, 'no_squarespace_profile', 'exclusion row: never swept in');
});

test('collateral: only consent_source of the basis people changes; subscribed / suppressed / profile_state never do', () => {
  const before = build({ consentBasis: [] });
  const after = build();
  for (const [anchor, f] of after) {
    assert.deepEqual(without(f), without(before.get(anchor)), anchor);
    assert.deepEqual(PICK(f), PICK(before.get(anchor)), anchor);
    if (anchor !== 'email:ann@example.com') assert.equal(f.consent_source, before.get(anchor).consent_source, anchor);
  }
  assert.equal(consentTag(after.get('email:ann@example.com')).state, 'email_no_contact', 'the basis never makes anyone emailable by itself');
});

test('the basis persists after the Squarespace import / profile sync (new contact, subscribed or not) and across rebuilds', () => {
  const imported = build({ profiles: [...source().profiles, profile('p9', 'ann@example.com', 'Ann', 'Soft', { accepts_marketing: true })] });
  const ann = imported.get('sqs:p9');
  assert.deepEqual([ann.consent_source, ann.subscribed, ann.profile_state], [SOFT_OPT_IN, true, 'active']);
  assert.equal(consentTag(ann).state, 'can_email', 'subscription comes from Squarespace only');
  const again = build({ profiles: [...source().profiles, profile('p9', 'ann@example.com', 'Ann', 'Soft', { accepts_marketing: true })] });
  assert.equal(JSON.stringify([...again]), JSON.stringify([...imported]), 'same facts on the next rebuild');
});

test('dashboard: badge mark "Soft opt-in (existing customer, Nov 2026)" and a Customers field, only on those people', () => {
  const facts = build();
  const ctx = { today: TODAY, asOf: TODAY, engagementComplete: true, windows: { warm_days: 90, cooling_days: 180 } };
  const R = (anchor) => rowCtx({ person_id: anchor, anchor_key: anchor, facts: facts.get(anchor) }, ctx);
  const mark = (anchor) => badgesOf(facts.get(anchor), R(anchor)).marks.find((m) => m.key === 'soft_opt_in');
  assert.ok(mark('email:ann@example.com').tip.startsWith(SOFT_OPT_IN_LABEL));
  assert.equal(mark('email:bob@example.com'), undefined);
  assert.equal(FIELD.get('soft_opt_in').get(R('email:ann@example.com')), true);
  assert.equal(FIELD.get('soft_opt_in').get(R('sqs:p1')), false);
});

test('Decisions views / blockedCounts read their own kinds only: consent_basis rows change nothing', () => {
  const base = [{ kind: 'keep_blocked', ref_key: 'h1' }, { kind: 'deferred', ref_key: 'step|x' }, { kind: 'plan_approved', ref_key: 'p', decided_at: '2026-11-08' }];
  const a = decisionIndex(base);
  const b = decisionIndex([...base, ...source().consentBasis]);
  assert.deepEqual([[...b.keptBlocked], [...b.deferred], b.planApproved], [[...a.keptBlocked], [...a.deferred], a.planApproved]);
});

test('record rows: one batch row, one row per person keyed by email hash, the exclusion row; no personal data', () => {
  const people = new Map([['a', { email: 'ann@example.com' }], ['x', { email: 'cat@example.com' }]]);
  const rows = decisionRows(people, emailHash, ['a'], ['x']);
  assert.equal(rows[0].decision_key, `consent_basis|${SOFT_OPT_IN_BATCH}`);
  assert.deepEqual(rows.slice(1).map((r) => [r.ref_key, r.decision]), [[emailHash('ann@example.com'), SOFT_OPT_IN], [emailHash('cat@example.com'), SOFT_OPT_IN_EXCLUDED]]);
  assert.ok(!JSON.stringify(rows).includes('@'), 'no addresses stored');
  assert.ok(rows.every((r) => r.kind === 'consent_basis' && r.decided_by === 'Alan'));
});

test('CSV: Email, First Name, Last Name only; quoted when needed; never inside the repo or a synced folder', () => {
  const csv = toCsv([{ email: 'ann@example.com', facts: { name: 'Ann Mary Soft' } }, { email: 'o@example.com', facts: { name: 'O\'Neil, Jr' } }]);
  assert.equal(csv, 'Email,First Name,Last Name\r\nann@example.com,Ann,Mary Soft\r\no@example.com,"O\'Neil,",Jr\r\n');
  assert.deepEqual(splitName(''), { first: '', last: '' });
  assert.throws(() => safeOut('outputs/x.csv'));
  assert.throws(() => safeOut('C:/Users/alan/Google Drive/x.csv'));
  assert.ok(safeOut('C:/TEMP/soft-opt-in/x.csv'));
});

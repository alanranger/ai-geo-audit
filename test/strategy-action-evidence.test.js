import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceHit, evidenceRuleFor, loadActionsWithEvidence, tickChanges } from '../lib/strategy-action-evidence.mjs';
import { actionPatch, manualTickRefusal } from '../api/aigeo/strategy-actions.js';

const PROP = 'https://www.alanranger.com';
const ROW = { id: 14, property_url: PROP, action_key: 'q1-pnm-newsletter', quarter_key: 'q1-2026', label: 'Pick n Mix launch newsletter', due_week_start: '2026-11-02', sort_order: 14, is_ticked: true, ticked_at: '2026-11-08T12:14:57.065+00:00', created_at: '2026-10-07T15:37:08.85313+00:00', updated_at: '2026-11-08T12:14:57.065+00:00', status: null, waiting_on: null };
const GIFT = { ...ROW, id: 15, action_key: 'q1-xmas-gift', label: 'Christmas gift push for beginners course', is_ticked: true };
const SENT = { email_id: 'e-pnm', subject: 'Your Pick n Mix Kick-Starter', sent_on: '2026-11-10T10:00:04.000+00:00', message_count: 127, delivered: 126, campaign_key: null };
const RULE = evidenceRuleFor(ROW);

test('the rule is found by action_key (stable) and by label; actions without a rule stay manual', () => {
  assert.equal(RULE.id, 'pick-n-mix-launch');
  assert.equal(evidenceRuleFor({ action_key: 'x', label: 'Pick n Mix launch newsletter' }).id, 'pick-n-mix-launch');
  assert.equal(evidenceRuleFor(GIFT), null);
});

test('never evidence: a schedule (no send report), a report dated in the future, no recipients, before 10 Nov, linked elsewhere', () => {
  const now = '2026-11-08T13:00:00.000Z';
  assert.equal(evidenceHit(RULE, [], now), null, 'scheduled stage / draft id alone = no send report');
  assert.equal(evidenceHit(RULE, [SENT], now), null, 'a report dated after now is not a collected send');
  const later = '2026-11-10T12:00:00.000Z';
  assert.equal(evidenceHit(RULE, [{ ...SENT, message_count: 0, delivered: 0 }], later), null);
  assert.equal(evidenceHit(RULE, [{ ...SENT, sent_on: '2026-11-09T10:00:00+00:00' }], later), null);
  assert.equal(evidenceHit(RULE, [{ ...SENT, campaign_key: 'email|2026-11-09' }], later), null);
  assert.equal(evidenceHit(RULE, [{ ...SENT, subject: 'Kick-Starter launch', campaign_key: 'theme|pick-n-mix-kick-starter-2026-11' }], later).email_id, 'e-pnm', 'linked to the campaign counts without the words');
});

test('stale tick is cleared (only is_ticked + ticked_at); after the 10 Nov send is collected it ticks automatically', () => {
  assert.deepEqual(tickChanges([ROW, GIFT], [], '2026-11-08T13:00:00.000Z'), [{ id: 14, action_key: 'q1-pnm-newsletter', before: { is_ticked: true, ticked_at: ROW.ticked_at }, after: { is_ticked: false, ticked_at: null } }]);
  const cleared = { ...ROW, is_ticked: false, ticked_at: null };
  assert.deepEqual(tickChanges([cleared], [SENT], '2026-11-10T12:00:00.000Z')[0].after, { is_ticked: true, ticked_at: '2026-11-10T10:00:04.000Z' });
  assert.deepEqual(tickChanges([{ ...cleared, is_ticked: true, ticked_at: '2026-11-10T10:00:04.000Z' }], [SENT], '2026-11-10T12:00:00.000Z'), [], 'idempotent');
});

/** Minimal Supabase stand-in: records updates, returns the given rows. */
function fakeSb(rows, sqs, { sqsError = null } = {}) {
  const writes = [];
  const query = (table) => {
    const q = { filters: {}, patch: null };
    const chain = {
      select: () => chain, order: () => chain, limit: () => chain, gte: () => chain,
      eq: (k, v) => { q.filters[k] = v; return chain; },
      update: (p) => { q.patch = p; return chain; },
      then: (res, rej) => Promise.resolve(q.patch ? apply() : (table === 'sqs_email_campaigns' ? { data: sqsError ? null : sqs, error: sqsError } : { data: rows, error: null })).then(res, rej)
    };
    function apply() {
      if (!('id' in q.filters) || !('property_url' in q.filters)) return { error: null };
      writes.push({ table, id: q.filters.id, patch: q.patch });
      Object.assign(rows.find((r) => r.id === q.filters.id), q.patch);
      return { error: null };
    }
    return chain;
  };
  return { from: query, writes };
}

test('summary load writes only the two tick columns, annotates the evidence, and never writes when evidence cannot be read', async () => {
  const rows = [{ ...ROW }, { ...GIFT }];
  const sb = fakeSb(rows, []);
  const out = await loadActionsWithEvidence(sb, PROP, new Date('2026-11-08T13:00:00Z'));
  assert.deepEqual(sb.writes, [{ table: 'strategy_quarter_actions', id: 14, patch: { is_ticked: false, ticked_at: null } }]);
  const before = { ...ROW };
  assert.deepEqual(Object.keys(rows[0]).filter((k) => JSON.stringify(rows[0][k]) !== JSON.stringify(before[k])).sort(), ['is_ticked', 'ticked_at']);
  assert.equal(out.find((a) => a.id === 14).evidence.state, 'waiting');
  assert.equal(out.find((a) => a.id === 15).evidence, undefined);
  assert.equal(rows[1].is_ticked, true, 'manual action untouched');

  const sb2 = fakeSb(rows, [SENT]);
  const after = await loadActionsWithEvidence(sb2, PROP, new Date('2026-11-10T12:00:00Z'));
  assert.deepEqual(sb2.writes[0].patch, { is_ticked: true, ticked_at: '2026-11-10T10:00:04.000Z' });
  assert.equal(after.find((a) => a.id === 14).evidence.sent.email_id, 'e-pnm');

  const sb3 = fakeSb([{ ...ROW }], null, { sqsError: { message: 'down' } });
  await loadActionsWithEvidence(sb3, PROP, new Date('2026-11-08T13:00:00Z'));
  assert.equal(sb3.writes.length, 0);
});

test('PATCH refuses a manual tick on an evidence-ruled action; label / date edits and other actions stay allowed', () => {
  assert.match(manualTickRefusal(ROW), /ticks itself from evidence/);
  assert.equal(manualTickRefusal(GIFT), null);
  assert.deepEqual(actionPatch({ is_ticked: true }, 'T'), { updated_at: 'T', is_ticked: true, ticked_at: 'T' });
  assert.deepEqual(actionPatch({ due_week_start: '2026-11-16T00:00' }, 'T'), { updated_at: 'T', due_week_start: '2026-11-16' });
});

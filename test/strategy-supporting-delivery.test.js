/**
 * A delivery with a supporting link (on itself or its campaign) counts for that initiative's next action, while its
 * primary attribution (revenue, sends, purpose mix) stays with one initiative.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { assemblePlan } from '../lib/strategy-initiatives.mjs';

const TODAY = '2026-11-09';
const ini = (k, extra = {}) => ({ initiative_key: k, kind: 'initiative', title: k, quarter_keys: ['q1-2026'], owner: 'GPT', status_rule: { type: 'not_set' }, focus: {}, ...extra });
const row = (key, stage, at) => ({ campaign_key: key, kind: 'theme', title: key, stage, sent_on: null, actual_sends: null, reserved_sends: stage === 'scheduled' ? 11 : null, window_start: at.slice(0, 10), window_end: at.slice(0, 10), planned_send_on: at.slice(0, 10), scheduled_for: stage === 'scheduled' ? at : null, stage_history: [{ stage, scheduled_for: at }] });

function fixture(extraLinks = []) {
  return {
    today: TODAY, txns: [], gpRates: [], master: {}, diary: [], actions: [], insights: null, roadmap: [], roadmapNow: {}, pnm: {}, courseLastNights: [], assets: [],
    campaign: { weeks: [{ week: '2026-11-09', steps: [] }], campaigns: [] },
    initiatives: [ini('q1-academy'), ini('prog-learning-relationships', { kind: 'programme', measure: 'purpose' }), ini('housekeeping', { kind: 'housekeeping', status_rule: { type: 'none' } })],
    quarters: [{ quarter_key: 'q1-2026', label: 'Q1', start_date: '2026-10-01', end_date: '2026-12-31', initiative_keys: ['q1-academy'], programme_key: 'prog-learning-relationships', housekeeping_key: 'housekeeping' }],
    campaignRows: [row('theme|academy-return', 'scheduled', '2026-11-12T09:30:00Z'), row('theme|academy-8w', 'drafted', '2026-12-01T09:00:00Z')],
    links: [{ ref_type: 'campaign', ref_key: 'theme|academy-8w', initiative_key: 'q1-academy', role: 'primary' }, ...extraLinks]
  };
}
const SUPPORT = { ref_type: 'campaign', ref_key: 'theme|academy-return', initiative_key: 'q1-academy', role: 'supporting' };

test('without a supporting link the Academy next action is its own 1 Dec draft', () => {
  const a = assemblePlan(fixture()).initiatives['q1-academy'];
  assert.equal(a.next.day, '2026-12-01');
});

test('a campaign supporting link makes its scheduled send the Academy next action (12 Nov)', () => {
  const p = assemblePlan(fixture([SUPPORT]));
  const a = p.initiatives['q1-academy'];
  assert.equal(a.next.day, '2026-11-12');
  assert.equal(a.next.key, 'send|theme|academy-return');
  assert.equal(a.next.then.day, '2026-12-01');
  assert.equal(a.deliveries.find((d) => d.key === 'send|theme|academy-return').role, 'supporting');
  assert.equal(a.status.kind, 'target_proposal', 'a supporting delivery does not invent a target');
  assert.equal(a.status.label, 'Target: GPT proposal due no date set');
});

test('a supporting link never moves the primary attribution or double-counts the mix', () => {
  const before = assemblePlan(fixture());
  const after = assemblePlan(fixture([SUPPORT]));
  assert.equal(after.links['delivery|send|theme|academy-return'].initiative_key, before.links['delivery|send|theme|academy-return'].initiative_key);
  assert.deepEqual(after.purpose_mix.by_primary, before.purpose_mix.by_primary);
  assert.ok(after.initiatives['prog-learning-relationships'].deliveries.some((d) => d.key === 'send|theme|academy-return'));
});

test('a delivery-level supporting link counts the same way', () => {
  const a = assemblePlan(fixture([{ ...SUPPORT, ref_type: 'delivery', ref_key: 'send|theme|academy-return' }])).initiatives['q1-academy'];
  assert.equal(a.next.day, '2026-11-12');
});

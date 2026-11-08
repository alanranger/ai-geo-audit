/**
 * Part 5 (combined fixes 7 Nov 2026) on synthetic fixtures: clean-up protected records are decided on the server, and
 * the list-load gates (production loads off until the residual risk is accepted, automations check, TEST names).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, protectedReason } from '../lib/marketing/cleanup.mjs';
import { loadRefusal } from '../lib/marketing/list-load.mjs';
import { IMPORT_BLOCK } from '../lib/marketing/import-block.mjs';

const TODAY = '2026-11-08';
const silent = { value: { c: { orders: 0, net: 0 }, cp: { orders: 0 } }, booking_count: 0, future: [], cats: {}, record_type: 'person' };

test('protected records: buyers, bookings, members, active plans, organisations, unknown / probable history', () => {
  assert.equal(protectedReason(silent, TODAY), null);
  assert.equal(protectedReason({ ...silent, value: { c: { orders: 1, net: 95 }, cp: { orders: 1 } } }, TODAY), 'buyer');
  assert.equal(protectedReason({ ...silent, value: { c: { orders: 0, net: 0 }, cp: { orders: 1 } } }, TODAY), 'buyer');
  assert.equal(protectedReason({ ...silent, future: [{ date: '2026-12-01' }] }, TODAY), 'booking');
  assert.equal(protectedReason({ ...silent, academy_detail: { status: 'trial_active' } }, TODAY), 'academy_member');
  assert.equal(protectedReason({ ...silent, plans: [{ starts: '2026-10-01', ends: '2027-09-30' }] }, TODAY), 'active_plan');
  assert.equal(protectedReason({ ...silent, plans: [{ starts: '2025-01-01', ends: '2025-12-31' }] }, TODAY), null);
  assert.equal(protectedReason({ ...silent, record_type: 'organisation' }, TODAY), 'organisation');
  assert.equal(protectedReason({ ...silent, history_incomplete: true }, TODAY), 'unknown_history');
  assert.equal(protectedReason({ ...silent, cats: { lightroom: { c: 0, p: 1 } } }, TODAY), 'unknown_history');
  assert.equal(protectedReason({ ...silent, email_shared: true }, TODAY), 'unknown_history');
  assert.ok(ACTIONS.delete_record && ACTIONS.retain && Object.keys(ACTIONS).length === 7);
});

test('list loads: production on since Alan accepted the residual risk; automations check still required; TEST names only for tests', () => {
  const real = { status: 'pending_import', is_test: false, campaign_key: 'email|2026-11-09', list_name: 'ARP | Jan | Beginners | 2026-11-08' };
  assert.equal(IMPORT_BLOCK.production_load_blocked, false);
  assert.equal(IMPORT_BLOCK.residual_risk_accepted_by, 'Alan, 8 Nov 2026, via Claude');
  assert.equal(IMPORT_BLOCK.csv_blocked, true);
  assert.equal(loadRefusal(real, { automations_checked: true }), null);
  assert.match(loadRefusal(real, {}), /automations check/);
  assert.match(loadRefusal(real), /automations check/);
  assert.match(loadRefusal({ ...real, status: 'load_queued' }, { automations_checked: true }), /snapshot is load_queued/);
  assert.match(loadRefusal({ ...real, status: 'blocked_do_not_send' }, { automations_checked: true }), /snapshot is blocked_do_not_send/);
  assert.match(loadRefusal({ ...real, campaign_key: null }), /campaign record/);
  assert.equal(loadRefusal({ status: 'pending_import', is_test: true, list_name: 'ARP | TEST | load 3' }), null);
  assert.match(loadRefusal({ status: 'pending_import', is_test: true, list_name: 'ARP | Jan' }), /TEST/);
  assert.match(loadRefusal({ ...real, status: 'loaded' }), /snapshot is loaded/);
});

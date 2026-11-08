/**
 * Send rule (8 Nov 2026): a send to a dashboard-loaded list needs a Pre-send PASS in the 30 minutes before it; the
 * Monday brief flags any that didn't have one. Synthetic fixtures only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESEND_VALID_MIN, SEND_RULE, passBefore, presendState } from '../lib/marketing/list-load.mjs';
import { noPassAlerts } from '../lib/marketing/health.mjs';

const SENT = '2026-11-10T09:00:00.000Z';
const minsBefore = (m) => new Date(Date.parse(SENT) - m * 60000).toISOString();
const exp = (log, latest) => ({ load_result: { presend_log: log }, presend_at: latest?.at || null, presend_result: latest ? { result: latest.result } : null });

test('send rule text and window', () => {
  assert.equal(SEND_RULE, 'Press Pre-send check, then send in Squarespace within 30 minutes');
  assert.equal(PRESEND_VALID_MIN, 30);
});

test('passBefore: only a PASS in the 30 minutes before the send counts', () => {
  assert.equal(passBefore(exp([{ at: minsBefore(10), result: 'PASS' }]), SENT), minsBefore(10));
  assert.equal(passBefore(exp([{ at: minsBefore(30), result: 'PASS' }]), SENT), minsBefore(30));
  assert.equal(passBefore(exp([{ at: minsBefore(31), result: 'PASS' }]), SENT), null);
  assert.equal(passBefore(exp([{ at: minsBefore(5), result: 'FAIL' }]), SENT), null);
  assert.equal(passBefore(exp([{ at: minsBefore(-2), result: 'PASS' }]), SENT), null, 'a PASS after the send does not count');
  assert.equal(passBefore(exp([{ at: minsBefore(40), result: 'PASS' }, { at: minsBefore(20), result: 'PASS' }]), SENT), minsBefore(20));
  assert.equal(passBefore(exp([], { at: minsBefore(3), result: 'PASS' }), SENT), minsBefore(3), 'latest presend_at counts without a log');
  assert.equal(passBefore({}, SENT), null);
});

test('presendState: PASS lasts 30 minutes, then NOT CHECKED', () => {
  const now = Date.parse(SENT);
  assert.equal(presendState({ presend_at: minsBefore(29), presend_result: { result: 'PASS' } }, now).state, 'pass');
  assert.equal(presendState({ presend_at: minsBefore(31), presend_result: { result: 'PASS' } }, now).state, 'not_checked');
  assert.equal(presendState({ presend_at: minsBefore(1), presend_result: { result: 'FAIL' } }, now).state, 'fail');
});

test('Monday brief: flags sends to dashboard lists with no PASS before them; TEST lists ignored', () => {
  const rows = [
    { subject: 'Jan news', list_name: 'ARP | Jan | Beginners | 2026-11-08', sent_on: SENT, is_test: false, pass_before: null },
    { subject: 'Feb news', list_name: 'ARP | Feb | All | 2026-11-08', sent_on: SENT, is_test: false, pass_before: minsBefore(5) },
    { subject: 'Test', list_name: 'ARP | TEST | x', sent_on: SENT, is_test: true, pass_before: null }
  ];
  const out = noPassAlerts(rows);
  assert.equal(out.length, 1);
  assert.match(out[0], /Jan news/);
  assert.match(out[0], /without a Pre-send PASS in the 30 minutes before the send/);
});

/**
 * After-send check (lib/marketing/list-load.mjs reconcileRecipients): a recipient who passed the checked audience and
 * unsubscribed from that same email afterwards is not "outside the checked audience"; a suppression seen before the
 * send, or someone not in the checked audience, still is.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileRecipients } from '../lib/marketing/list-load.mjs';
import { emailHash } from '../lib/marketing/store.mjs';

const SENT_ON = '2026-11-08T17:00:13Z';
const sent = ['a@x.test', 'b@x.test', 'c@x.test', 'd@x.test'].map((email) => ({ email }));
const ok = new Set(['a@x.test', 'b@x.test', 'c@x.test']);

test('unsubscribed from the email afterwards = in the checked audience; suppressed before or never checked = flagged', () => {
  const sup = new Map([[emailHash('a@x.test'), '2026-11-09T05:15:02Z'], [emailHash('b@x.test'), '2026-11-01T09:00:00Z']]);
  assert.deepEqual(reconcileRecipients(sent, ok, sup, SENT_ON), { flagged: 2, unsubscribed_after: 1 }, 'b suppressed before the send, d not checked; a unsubscribed after');
  assert.deepEqual(reconcileRecipients(sent.slice(0, 3), ok, new Map([[emailHash('a@x.test'), '2026-11-09T05:15:02Z']]), SENT_ON), { flagged: 0, unsubscribed_after: 1 });
});

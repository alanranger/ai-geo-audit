/**
 * People in the identity review queue (facts.identity_pending): the consent badge says "Undecided (identity review)",
 * the same answer the query gives (consent_state undecided), never "No email held". Others keep their consent badge.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { badgesOf } from '../lib/marketing/client-health.mjs';

test('review-queue person: consent badge "Undecided (identity review)"; others unchanged', () => {
  const pending = badgesOf({ identity_pending: true }, { today: '2026-11-09' });
  assert.equal(pending.consent.key, 'undecided');
  assert.equal(pending.consent.label, 'Undecided (identity review)');
  assert.match(pending.consent.tip, /review queue/);
  const noEmail = badgesOf({}, { today: '2026-11-09' });
  assert.equal(noEmail.consent.key, 'no_email');
  assert.equal(noEmail.consent.label, 'No email held');
});

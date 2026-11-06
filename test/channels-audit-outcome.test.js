import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../lib/acquisition/channels-audit-outcome.js';

const LABELS = ['DataForSEO AI mentions', 'YouTube channel stats', 'GA4 channel sessions'];
const { acqAuditOutcome } = globalThis;

test('every pull worked: "Channels audit complete"', () => {
  const o = acqAuditOutcome(LABELS, [{ ok: true }, { ok: true }, { ok: true }]);
  assert.equal(o.ok, true);
  assert.equal(o.title, 'Channels audit complete');
});

test('YouTube failed, GA4 still ran: one honest "Done with 1 problem" line, never "complete"', () => {
  const plain = "YouTube: Google's sign-in service had a temporary error — try again in a few minutes. Earlier figures already saved today are kept.";
  const o = acqAuditOutcome(LABELS, [{ ok: true, rows_written: 35 }, { ok: false, error: 'youtube_oauth: internal_failure', plain }, { ok: true, rows_written: 120 }]);
  assert.equal(o.ok, false);
  assert.equal(o.line, `Done with 1 problem: ${plain}`);
  assert.doesNotMatch(o.line, /complete|failed/i);
});

test('a pull without a plain reason is named with its error', () => {
  const o = acqAuditOutcome(LABELS, [{ ok: false, error: 'HTTP 504' }, { ok: true }, { ok: false, error: 'ga4_oauth: invalid_grant' }]);
  assert.equal(o.line, 'Done with 2 problems: DataForSEO AI mentions (HTTP 504); GA4 channel sessions (ga4_oauth: invalid_grant)');
});

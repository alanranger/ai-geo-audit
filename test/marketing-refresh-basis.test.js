/**
 * Live-audit corrections 13:07 (question 2026-11-09 (g)), items 1 and 7, on synthetic fixtures: ONE recipient basis
 * (the provider's committed count; later exclusions as a labelled line, recipients unchanged) and a refresh result that
 * says complete / partial (which providers) / failed, with "Last checked … · complete | partial: …".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { audienceOf, providerBasis } from '../lib/marketing/delivery-reserve.mjs';
import { lastCheckedLabel, refreshOutcome } from '../lib/marketing/delivery-status-board.mjs';

const GIFTS_EXPORT = { eligible_count: 370, owner: { included: true, count: 0, business_copy: 1, kinds: {} } };

test('gifts: one basis — 365 people + 1 business copy = 366 sends, "5 since unsubscribed / removed" labelled', () => {
  const d = { amount: 366, amount_from: 'squarespace_schedule', snapshot: { export_id: 'x' } };
  const a = audienceOf(d, {}, null, GIFTS_EXPORT);
  assert.deepEqual([a.people, a.business_copy, a.sends, a.basis], [365, 1, 366, 'provider']);
  assert.equal(a.people + a.business_copy, a.sends, 'the sum always adds up');
  assert.deepEqual([a.frozen_people, a.since_frozen], [370, 5]);
  assert.match(a.since_frozen_line, /^5 since unsubscribed \/ removed from the Squarespace list \(frozen: 370 people\)$/);
});

test('no provider count yet: the frozen snapshot is the basis and nothing is relabelled', () => {
  const a = audienceOf({ amount: 371, amount_from: 'snapshot', snapshot: { export_id: 'x' } }, {}, null, GIFTS_EXPORT);
  assert.deepEqual([a.people, a.sends, a.basis, a.since_frozen], [370, 371, 'snapshot', undefined]);
  assert.deepEqual(providerBasis({ people: 126, business_copy: 1, owner_addresses: 0 }, 127, 'provider'), { people: 126, frozen_people: 126, since_frozen: 0 });
  const grew = providerBasis({ people: 10, business_copy: 1, owner_addresses: 0 }, 12, 'provider');
  assert.deepEqual([grew.people, grew.since_frozen], [11, -1]);
  assert.match(grew.since_frozen_line, /1 more on the Squarespace list than frozen/);
});

test('refresh result: Squarespace queued / running = partial; all done = complete; a failed provider is named', () => {
  const ok = { ok: true };
  const running = refreshOutcome({ request: { status: 'running' }, meta: ok, youtube: { ok: true, videos: 7 } });
  assert.deepEqual([running.state, running.text], ['partial', 'partial: Squarespace still running']);
  assert.deepEqual(running.providers, { squarespace: 'running', meta: 'ok', youtube: 'ok' });
  assert.deepEqual(refreshOutcome({ request: { status: 'done' }, meta: ok, youtube: ok }).state, 'complete');
  const metaFail = refreshOutcome({ request: { status: 'done' }, meta: { ok: false, error: 'x' }, youtube: ok });
  assert.deepEqual([metaFail.state, metaFail.text], ['partial', 'partial: Meta failed']);
  const skipped = refreshOutcome({ request: { status: 'done' }, meta: { ok: true, skipped: 'checked in the last 5 minutes' }, youtube: ok });
  assert.equal(skipped.state, 'complete', 'a skipped recent Meta check is not a failure');
  assert.equal(refreshOutcome({ request: { status: 'failed' }, meta: { ok: false }, youtube: { ok: false } }).state, 'failed');
});

test('"Last checked" says complete or partial, in Europe/London time', () => {
  const at = '2026-11-09T13:08:00Z';
  assert.equal(lastCheckedLabel(at, refreshOutcome({ request: { status: 'running' }, meta: { ok: true }, youtube: { ok: true } })), 'Last checked 13:08 (Europe/London) · partial: Squarespace still running');
  assert.equal(lastCheckedLabel(at, refreshOutcome({ request: { status: 'done' }, meta: { ok: true }, youtube: { ok: true } })), 'Last checked 13:08 (Europe/London) · complete');
  assert.equal(lastCheckedLabel(at, null), 'Last checked 13:08 (Europe/London) · complete');
});

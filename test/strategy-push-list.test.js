import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPushList, statusLabel } from '../lib/strategy-diary.mjs';

const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

test('under-half-full events are Low and pushed soonest first', () => {
  const diary = [
    { date: day(14), title: 'Beginners course', booked: 0, cap: 4, be: 2, be_free: 2, rag: 'red', left: 4, unsold_gbp: 600 },
    { date: day(11), title: 'Woodland Walk', booked: 1, cap: 6, be: 1, be_free: 1, rag: 'amber', left: 5, unsold_gbp: 75 },
    { date: day(12), title: 'Padley Gorge', booked: 1, cap: 6, be: 1, be_free: 1, rag: 'amber', left: 5, unsold_gbp: 500 },
    { date: day(18), title: 'Lake District', booked: 0, cap: 4, be: 3, be_free: 3, rag: 'red', left: 4, unsold_gbp: 4000 },
    { date: day(6), title: 'Padley Gorge (half full)', booked: 3, cap: 6, be: 1, be_free: 1, rag: 'green', left: 3, unsold_gbp: 300 },
  ];
  const push = buildPushList(diary, 56, 3);
  assert.deepEqual(push.map((p) => p.title), ['Woodland Walk', 'Padley Gorge', 'Beginners course']);
  assert.equal(push[0].gap, 'only 1/6 — needs 2 more to be half full');
  assert.equal(push[2].gap, 'needs 2 more to run (time free)');
});

test('statusLabel: 1 of 6 is Low even when it covers costs; half full is OK', () => {
  assert.equal(statusLabel(1, 6, 1), 'Low');
  assert.equal(statusLabel(3, 6, 1), 'OK');
  assert.equal(statusLabel(0, 6, 1), 'No bookings');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRunRate } from '../lib/strategy-run-rate.mjs';

const snap = (event_date, event_type, event_key, sheet_booked, snapshot_date) => ({
  event_date, event_type, event_key, sheet_booked, snapshot_date,
});

test('run rate since 7 Oct: day / residential / course + average (live-shaped rows)', () => {
  const rows = [
    snap('2026-10-10', 'residential', '2026-10-10|wales', 2, '2026-10-08'),
    snap('2026-10-12', 'course', '2026-10-12|course|beginners', 0, '2026-10-07'),
    snap('2026-10-14', 'course', '2026-10-14|course|beginners', 0, '2026-10-07'),
    snap('2026-10-16', 'walk', '2026-10-16|woodland walk', 0, '2026-10-16'),
    snap('2026-10-17', 'day', '2026-10-17|padley', 5, '2026-10-17'),
    snap('2026-10-18', 'day', '2026-10-18|masterclass', 3, '2026-10-18'),
    // Dual-session day: combined row wrongly 0, sessions booked → ran, counted once.
    snap('2026-10-24', 'day', '2026-10-24|batsford', 0, '2026-10-24'),
    snap('2026-10-24', 'day', '2026-10-24|batsford|AM', 4, '2026-10-24'),
    snap('2026-10-24', 'day', '2026-10-24|batsford|PM', 5, '2026-10-24'),
    // Future event excluded.
    snap('2026-11-01', 'day', '2026-11-01|padley', 3, '2026-10-26'),
  ];
  const r = computeRunRate(rows, { from: '2026-10-07', toExclusive: '2026-10-26' });
  assert.equal(r.countLine, '3/4 | 1/1 | 0/2 | 4/7');
  assert.equal(r.pctLine, '75% / 100% / 0% / 58.3%');
});

test('uses the latest snapshot for each event (bookings that later cancel to 0 = did not run)', () => {
  const rows = [
    snap('2026-10-20', 'day', '2026-10-20|x', 2, '2026-10-10'),
    snap('2026-10-20', 'day', '2026-10-20|x', 0, '2026-10-19'),
  ];
  const r = computeRunRate(rows, { from: '2026-10-07', toExclusive: '2026-10-26' });
  assert.equal(r.countLine, '0/1 | — | — | 0/1');
});

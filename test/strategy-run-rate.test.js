import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRunRate, eventOutcomes } from '../lib/strategy-run-rate.mjs';

const snap = (event_date, event_type, title, snapshot_date, capacity = 6, qty_in_stock = 6) => ({ event_date, event_type, title, snapshot_date, capacity, qty_in_stock, sheet_booked: 0 });

test('shared definition (V04): ran = Booking Sheet attendees; withdrawn leaves the base; AM/PM count once', () => {
  const snaps = [
    snap('2026-10-10', 'residential', 'Wales', '2026-10-09'),
    snap('2026-10-12', 'course', 'Beginners course', '2026-10-11'),
    snap('2026-10-14', 'course', 'Beginners course', '2026-10-01'),
    snap('2026-10-17', 'day', 'Padley', '2026-10-16'),
    snap('2026-10-24', 'day', 'Batsford AM', '2026-10-23'),
    snap('2026-10-24', 'day', 'Batsford PM', '2026-10-23'),
    snap('2026-10-25', 'walk', 'Woodland walk', '2026-10-24', 8, 4),
    snap('2026-11-20', 'day', 'Future', '2026-11-07')
  ];
  const courses = [{ from_date: '2026-10-12', client_name: 'A' }];
  const workshops = [{ event_start: '2026-10-17', client_name: 'B', is_multi_day: false }, { event_start: '2026-10-24', client_name: 'C', is_multi_day: false }];
  const out = eventOutcomes({ snaps, today: '2026-11-08', courses, workshops });
  const by = Object.fromEntries(out.map((e) => [`${e.date} ${e.type}`, e.outcome]));
  assert.equal(by['2026-10-14 course'], 'withdrawn');
  assert.equal(by['2026-10-10 residential'], 'cancelled');
  assert.equal(by['2026-10-25 day'], 'cancelled');
  assert.equal(out.filter((e) => e.date === '2026-10-24').length, 1);
  assert.equal(out.find((e) => e.date === '2026-10-25').mismatch, true);
  const r = computeRunRate(out);
  assert.equal(r.countLine, '2/3 | 0/1 | 1/1 | 3/5');
  assert.equal(r.avg_pct, 60);
});

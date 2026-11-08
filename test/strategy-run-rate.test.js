import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeRunRate, eventOutcomes, outcomesNeedingRecord, recordReason, runCounts } from '../lib/strategy-run-rate.mjs';
import { runTile } from '../lib/strategy-insights/demand.mjs';
import { historyEntry, outcomeRow } from '../api/aigeo/strategy-event-outcomes.js';

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

/* ---------- cancellation records (8 Nov 2026), live fixture ---------- */

const fx = JSON.parse(readFileSync(new URL('./fixtures/strategy-event-outcomes-20261108.json', import.meta.url), 'utf8'));
const expand = (rows, extra) => rows.flatMap((r) => Array.from({ length: r.n }, () => ({ ...r, ...extra })));
const workshops = expand(fx.workshopAttendeesPerDate, { client_name: 'attendee' });
const courses = expand(fx.courseAttendeesPerDate, { client_name: 'attendee' });
const base = { snaps: fx.snaps, today: fx.today, courses, workshops };
const attendeesOn = (date) => workshops.filter((w) => w.event_start === date).length;

test('before records: Since 7 Oct = 5/8 day (62.5%); Batsford 24 Oct and walk 6 Nov "reason not recorded"; 25 Oct counted as ran', () => {
  const out = eventOutcomes(base);
  const r = computeRunRate(out);
  assert.equal(r.countLine, '5/8 | — | — | 5/8');
  assert.equal(r.pctLine, '62.5% / — / — / 62.5%');
  assert.deepEqual(outcomesNeedingRecord(out).map((e) => e.date), ['2026-10-24', '2026-11-06']);
  assert.equal(out.find((e) => e.date === '2026-10-25').outcome, 'ran');
});

test('after records: recorded cancellations leave the base — Ran % of held = 4/5 (80%); nothing left to record', () => {
  const out = eventOutcomes({ ...base, records: fx.records });
  const r = computeRunRate(out);
  assert.equal(r.countLine, '4/5 | — | — | 4/5');
  assert.equal(r.pctLine, '80% / — / — / 80%');
  assert.equal(r.cancelled_recorded, 3);
  assert.equal(r.withdrawn, 5);
  assert.equal(outcomesNeedingRecord(out).length, 0);
  const day = runCounts(out.filter((e) => e.type === 'day'));
  assert.deepEqual(day, { listed: 10, ran: 4, withdrawn: 2, cancelled: 4, cancelledRecorded: 3, held: 5, pct: 80 });
  const b25 = out.find((e) => e.date === '2026-10-25');
  assert.equal(b25.outcome, 'cancelled');
  assert.equal(b25.recorded, true);
  assert.equal(b25.reason, 'other: moved to Sun 25 Oct, then cancelled (bookings mixed: transferred to Peak District Photography Workshop Padley Gorge 1 Nov, 1 refunded, 1 credit held)');
  assert.equal(out.find((e) => e.date === '2026-11-06').reason, 'low bookings (bookings transferred to Woodland Photography Walk 4 Dec (1))');
  assert.equal(out.find((e) => e.date === '2026-10-16').reason, 'no bookings');
});

test('transfers never count twice: Peak District 1 Nov keeps 8 attendees and ran; 4 Dec keeps 1 of 6 booked', () => {
  const out = eventOutcomes({ ...base, records: fx.records });
  assert.equal(out.find((e) => e.date === '2026-11-01').outcome, 'ran');
  assert.equal(attendeesOn('2026-11-01'), 8);
  const dec4 = fx.snaps.find((s) => s.event_date === '2026-12-04');
  assert.equal(dec4.capacity - dec4.qty_in_stock, 1);
  assert.equal(attendeesOn('2026-12-04'), 1);
  assert.equal(out.some((e) => e.date === '2026-12-04'), false);
});

test('a record with cancelled = false does not change the outcome', () => {
  const records = [{ ...fx.records[1], cancelled: false }];
  assert.equal(eventOutcomes({ ...base, records }).find((e) => e.date === '2026-10-25').outcome, 'ran');
});

test('events tile: same rule as F5, recorded reasons shown, rule stated in the foot', () => {
  const t = runTile({ ...base, eventRecords: fx.records, scorecard: [] });
  const day = t.table2.rows[0];
  assert.equal(day[1].v, 10);
  assert.equal(day[2].v, 4);
  assert.equal(day[3].v, '80%');
  assert.equal(day[4].v, 2);
  assert.match(String(day[5].v), /^4: Cancelled: other: moved to Sun 25 Oct, then cancelled/);
  assert.match(String(day[5].v), /Cancelled: low bookings \(bookings transferred to Woodland Photography Walk 4 Dec \(1\)\)/);
  assert.match(String(day[5].v), /1 no bookings$/);
  assert.doesNotMatch(String(day[5].v), /reason not recorded/);
  assert.match(t.foot, /Ran % of held = ran ÷ \(listed − withdrawn − cancelled with a recorded reason\)/);
  assert.doesNotMatch(t.foot, /Diary showed bookings/);
});

test('recordReason without counts or bookings outcome', () => {
  assert.equal(recordReason({ reason: 'weather' }), 'weather');
  assert.equal(recordReason({ reason: 'venue', bookings_outcome: 'refunded', refunded_count: 3 }), 'venue (bookings refunded: 3 refunded)');
});

test('API row: typed, validated, history entry has no person id', () => {
  const now = '2026-11-08T12:00:00.000Z';
  const row = outcomeRow({ run_key: '2026-11-06|day|woodland photography walk kenilworth cra', cancelled: true, reason: 'low_bookings', bookings_outcome: 'transferred', transferred_to_date: '2026-12-04', transferred_count: '1', refunded_count: '' }, 'https://www.alanranger.com', now);
  assert.equal(row.event_date, '2026-11-06');
  assert.equal(row.transferred_count, 1);
  assert.equal(row.refunded_count, null);
  assert.equal(row.set_by, 'Alan (dashboard, admin key)');
  const h = historyEntry({ ...row, credit_held_person_id: '00000000-0000-0000-0000-000000000000' });
  assert.equal(h.credit_held_person_linked, true);
  assert.equal('credit_held_person_id' in h, false);
  assert.throws(() => outcomeRow({ run_key: 'bad', reason: 'weather' }, 'p', now), /run_key/);
  assert.throws(() => outcomeRow({ run_key: '2026-11-06|day|x', reason: 'other' }, 'p', now), /needs a note/);
  assert.throws(() => outcomeRow({ run_key: '2026-11-06|day|x' }, 'p', now), /needs a reason/);
  assert.throws(() => outcomeRow({ run_key: '2026-11-06|day|x', reason: 'storm' }, 'p', now), /reason must be one of/);
  assert.throws(() => outcomeRow({ run_key: '2026-11-06|day|x', reason: 'venue', refunded_count: -1 }, 'p', now), /whole number/);
});

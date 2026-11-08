import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeRunRate, creditLabel, creditMarker, creditsHeld, eventOutcomes, outcomesNeedingRecord, recordReason, runCounts, runKey } from '../lib/strategy-run-rate.mjs';
import { cancelledText, runTile } from '../lib/strategy-insights/demand.mjs';
import { historyEntry, outcomeRow, saveOutcome, setByOf, transfersRow } from '../api/aigeo/strategy-event-outcomes.js';
import { eventBriefNotes } from '../lib/strategy-summary.mjs';
import { eventNoteLines } from '../lib/ceo-weekly/strategyScorecard.js';

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

/* ---------- cancellation records + Alan's rule "B" (8 Nov 2026), live fixture ---------- */

const fx = JSON.parse(readFileSync(new URL('./fixtures/strategy-event-outcomes-20261108.json', import.meta.url), 'utf8'));
const expand = (rows, extra) => rows.flatMap((r) => Array.from({ length: r.n }, () => ({ ...r, ...extra })));
const workshops = expand(fx.workshopAttendeesPerDate, { client_name: 'attendee' });
const courses = expand(fx.courseAttendeesPerDate, { client_name: 'attendee' });
const base = { snaps: fx.snaps, today: fx.today, courses, workshops };
const attendeesOn = (date) => workshops.filter((w) => w.event_start === date).length;
const ruleA = (out) => { const o = out.filter((e) => e.type === 'day'); const held = o.length - o.filter((e) => e.outcome === 'withdrawn' || (e.outcome === 'cancelled' && e.recorded)).length; return `${o.filter((e) => e.outcome === 'ran').length}/${held}`; };

test('no records: Since 7 Oct = 5/8 day (62.5%); Batsford 24 Oct and walk 6 Nov need a record; 23 and 25 Oct counted as ran', () => {
  const out = eventOutcomes(base);
  const r = computeRunRate(out);
  assert.equal(r.countLine, '5/8 | — | — | 5/8');
  assert.equal(r.pctLine, '62.5% / — / — / 62.5%');
  assert.deepEqual(outcomesNeedingRecord(out).map((e) => e.date), ['2026-10-24', '2026-11-06']);
  assert.equal(out.find((e) => e.date === '2026-10-23').outcome, 'ran');
  assert.equal(out.find((e) => e.date === '2026-10-25').outcome, 'ran');
});

test('before this change (live 88b35cf): first-pass records, every recorded cancellation out of the base = 4/5 (80%)', () => {
  assert.equal(ruleA(eventOutcomes({ ...base, records: fx.recordsFirstPass })), '4/5');
});

test('after: 23–25 Oct cancelled (other, not counted), 6 Nov low bookings + 16 Oct no bookings counted = 3/5 (60%, amber)', () => {
  const out = eventOutcomes({ ...base, records: fx.records });
  const r = computeRunRate(out);
  assert.equal(r.countLine, '3/5 | — | — | 3/5');
  assert.equal(r.pctLine, '60% / — / — / 60%');
  assert.equal(r.cancelled_counted, 2);
  assert.equal(r.cancelled_outside, 3);
  assert.equal(r.withdrawn, 5);
  assert.equal(outcomesNeedingRecord(out).length, 0);
  assert.deepEqual(runCounts(out.filter((e) => e.type === 'day')), { listed: 10, ran: 3, withdrawn: 2, cancelled: 5, cancelledCounted: 2, cancelledOutside: 3, held: 5, pct: 60 });
  const b23 = out.find((e) => e.date === '2026-10-23');
  assert.equal(b23.outcome, 'cancelled');
  assert.equal(b23.outside, true);
  assert.equal(b23.reason, 'other: moved, then cancelled (bookings mixed: transferred to Peak District Photography Workshop Padley Gorge 1 Nov and to The Secrets of Woodland Photography 10 Jan (1), 3 refunded, 1 credit held)');
  assert.equal(out.find((e) => e.date === '2026-10-24').reason, 'other: moved to Sun 25 Oct, then cancelled (bookings mixed)');
  const w6 = out.find((e) => e.date === '2026-11-06');
  assert.equal(w6.outside, false);
  assert.equal(w6.reason, 'low bookings (bookings transferred to Woodland Photography Walk 4 Dec (1))');
});

test('Alan\'s rule B by reason: weather / venue / leader / other leave the base; low bookings, no bookings, no reason stay', () => {
  const key = runKey(fx.snaps.find((s) => s.event_date === '2026-10-17'));
  const held = (reason) => runCounts(eventOutcomes({ ...base, records: [{ run_key: key, cancelled: true, reason }] }).filter((e) => e.type === 'day')).held;
  assert.equal(held('weather'), 7);
  assert.equal(held('venue'), 7);
  assert.equal(held('leader_unavailable'), 7);
  assert.equal(held('other'), 7);
  assert.equal(held('low_bookings'), 8);
});

test('transfers never count twice: Peak District 1 Nov keeps 8 attendees and ran; 4 Dec keeps 1 of 6; 10 Jan is not Batsford attendance', () => {
  const out = eventOutcomes({ ...base, records: fx.records });
  assert.equal(out.find((e) => e.date === '2026-11-01').outcome, 'ran');
  assert.equal(attendeesOn('2026-11-01'), 8);
  const dec4 = fx.snaps.find((s) => s.event_date === '2026-12-04');
  assert.equal(dec4.capacity - dec4.qty_in_stock, 1);
  assert.equal(attendeesOn('2026-12-04'), 1);
  assert.equal(out.some((e) => e.date >= '2026-11-08'), false);
  assert.equal(out.filter((e) => /batsford/i.test(e.title) && e.outcome === 'ran').length, 0);
});

test('a record with cancelled = false does not change the outcome', () => {
  const records = [{ ...fx.records[0], cancelled: false }];
  assert.equal(eventOutcomes({ ...base, records }).find((e) => e.date === '2026-10-23').outcome, 'ran');
});

test('events tile: split "counted · not counted", same rule as F5, amber at 60%, rule stated in the foot', () => {
  const t = runTile({ ...base, eventRecords: fx.records, scorecard: [] });
  const day = t.table2.rows[0];
  assert.deepEqual([day[1].v, day[2].v, day[3].v, day[3].rag, day[4].v], [10, 3, '60%', 'amber', 2]);
  assert.match(String(day[5].v), /^Cancelled: 1 no bookings · 1 low bookings \(counted\) · 3 other \(not counted\) — Batsford Arboretum Autumn Photography Workshop 23 Oct: other: moved, then cancelled/);
  assert.doesNotMatch(String(day[5].v), /reason not recorded/);
  assert.match(t.foot, /ran ÷ \(listed − withdrawn − cancelled for reasons outside Alan's control\)/);
  assert.match(t.foot, /Counted \(stay in the base as didn't run\): low bookings, no bookings, and cancellations with no reason recorded/);
  assert.doesNotMatch(t.foot, /Diary showed bookings/);
});

test('tile split counts unrecorded cancellations as "no reason recorded" (counted)', () => {
  const out = eventOutcomes(base).filter((e) => e.type === 'day' && e.outcome === 'cancelled');
  assert.equal(cancelledText(out), 'Cancelled: 1 no bookings · 2 no reason recorded (counted)');
});

test('credit held: label, marker only while linked and unused, one credit across Batsford', () => {
  const rec = fx.records[0];
  assert.equal(creditLabel(rec), 'credit held · Batsford Oct 2026');
  assert.deepEqual(creditMarker({ ...rec, set_at: 'x' }), { label: 'credit held · Batsford Oct 2026', count: 1, run_key: rec.run_key, event_date: '2026-10-23', set_at: 'x' });
  assert.equal(creditMarker({ ...rec, credit_used_on: '2027-02-01' }), null);
  assert.equal(creditMarker({ ...rec, credit_held_person_id: null }), null);
  const held = creditsHeld(fx.records);
  assert.equal(held.length, 1);
  assert.equal(held.reduce((a, c) => a + c.count, 0), 1);
  assert.equal(creditsHeld([{ ...rec, credit_used_on: '2027-02-01' }]).length, 0);
});

test('Monday brief: "record what happened" lines and the credit note, no names', () => {
  const before = eventBriefNotes(eventOutcomes(base), []);
  assert.deepEqual(before.record_needed.map((e) => e.date), ['2026-10-24', '2026-11-06']);
  const after = eventBriefNotes(eventOutcomes({ ...base, records: fx.records }), fx.records);
  assert.equal(after.record_needed.length, 0);
  assert.deepEqual(after.credits_held.map((c) => ({ count: c.count, label: c.label, person_linked: c.person_linked, has_id: 'person_id' in c })), [{ count: 1, label: 'credit held · Batsford Oct 2026', person_linked: true, has_id: false }]);
  const lines = eventNoteLines({ ...after, record_needed: before.record_needed });
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^Record what happened: .+ Sat 24 Oct — diary 10 booked, Booking Sheet 0 attendees, no cancellation record$/);
  assert.equal(lines[2], '1 client: credit held · Batsford Oct 2026 — open commitment until used, not revenue');
  assert.deepEqual(eventNoteLines({}), []);
});

test('recordReason without counts or bookings outcome', () => {
  assert.equal(recordReason({ reason: 'weather' }), 'weather');
  assert.equal(recordReason({ reason: 'venue', bookings_outcome: 'refunded', refunded_count: 3 }), 'venue (bookings refunded: 3 refunded)');
});

test('API row: typed, validated, transfers list, Claude set_by dated, history entry has no person id', () => {
  const now = '2026-11-08T12:00:00.000Z';
  assert.equal(setByOf({ via: 'claude' }, now), 'Alan via Claude, 8 Nov 2026');
  const row = outcomeRow({ run_key: '2026-11-06|day|woodland photography walk kenilworth cra', cancelled: true, reason: 'low_bookings', bookings_outcome: 'transferred', transferred_to_date: '2026-12-04', transferred_count: '1', refunded_count: '' }, 'https://www.alanranger.com', now);
  assert.equal(row.event_date, '2026-11-06');
  assert.equal(row.transferred_count, 1);
  assert.deepEqual(row.transfers, [{ title: null, date: '2026-12-04', count: 1 }]);
  assert.equal(row.refunded_count, null);
  assert.equal(row.set_by, 'Alan (dashboard, admin key)');
  const h = historyEntry({ ...row, credit_held_person_id: '00000000-0000-0000-0000-000000000000' });
  assert.equal(h.credit_held_person_linked, true);
  assert.equal('credit_held_person_id' in h, false);
  assert.deepEqual(transfersRow({ transfers: [{ title: 'A', date: '2026-11-01' }, { title: 'B', date: '2027-01-10', count: 1 }] }).transfers.map((t) => t.count), [null, 1]);
  assert.throws(() => transfersRow({ transfers: [{ title: 'A' }] }), /needs the date/);
  assert.throws(() => outcomeRow({ run_key: 'bad', reason: 'weather' }, 'p', now), /run_key/);
  assert.throws(() => outcomeRow({ run_key: '2026-11-06|day|x', reason: 'other' }, 'p', now), /needs a note/);
  assert.throws(() => outcomeRow({ run_key: '2026-11-06|day|x' }, 'p', now), /needs a reason/);
  assert.throws(() => outcomeRow({ run_key: '2026-11-06|day|x', reason: 'storm' }, 'p', now), /reason must be one of/);
  assert.throws(() => outcomeRow({ run_key: '2026-11-06|day|x', reason: 'venue', refunded_count: -1 }, 'p', now), /whole number/);
  assert.throws(() => outcomeRow({ run_key: '2026-11-06|day|x', reason: 'venue', credit_used_on: 'soon' }, 'p', now), /credit_used_on/);
});

/** Tiny in-memory stand-in for the two tables saveOutcome touches. */
function fakeDb(tables) {
  const q = (name) => {
    const f = {};
    const api = {
      select: () => api, eq: (k, v) => { f[k] = v; return api; },
      maybeSingle: async () => ({ data: (tables[name] || []).find((r) => Object.entries(f).every(([k, v]) => r[k] === v)) || null, error: null }),
      upsert: async (row) => { tables[name] = [...(tables[name] || []).filter((r) => r.run_key !== row.run_key), row]; return { error: null }; },
      update: (patch) => ({ eq: async (k, v) => { tables[name] = tables[name].map((r) => (r[k] === v ? { ...r, ...patch } : r)); return { error: null }; } })
    };
    return api;
  };
  return { from: q, tables };
}

test('save: credit marker set on the linked person; a dashboard save without the person keeps the link; used credit clears it', async () => {
  const pid = '00000000-0000-4000-8000-000000000001';
  const db = fakeDb({ customer_person: [{ person_id: pid, facts: { other: 1 } }], strategy_event_outcomes: [] });
  const now = '2026-11-08T12:00:00.000Z';
  const body = { run_key: fx.records[0].run_key, event_title: fx.records[0].event_title, reason: 'other', reason_note: 'moved, then cancelled', credit_held_count: 1 };
  await saveOutcome(db, outcomeRow({ ...body, credit_held_person_id: pid }, 'p', now));
  assert.deepEqual(db.tables.customer_person[0].facts.credit_held.map((c) => c.label), ['credit held · Batsford Oct 2026']);
  assert.equal(db.tables.customer_person[0].facts.other, 1);
  const kept = await saveOutcome(db, outcomeRow({ ...body, refunded_count: 3 }, 'p', now), { keepPerson: true });
  assert.equal(kept.credit_marker, 'set');
  assert.equal(db.tables.strategy_event_outcomes[0].credit_held_person_id, pid);
  await saveOutcome(db, outcomeRow({ ...body, credit_used_on: '2027-02-01' }, 'p', now), { keepPerson: true });
  assert.deepEqual(db.tables.customer_person[0].facts.credit_held, []);
  assert.equal(db.tables.strategy_event_outcomes[0].history.length, 3);
});

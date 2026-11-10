/**
 * Alan, 10 Nov 2026: the roadmap beginners actual counts bookings. Actual = non-JLR beginners booked onto courses dated
 * 1 Oct → the milestone date (taught + booked), labelled "booked/taught". The Decisions rule keeps "taught".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { beginnersActual, kpiBoxes, measureFor, nonJlrBeginnerDates } from '../lib/strategy-initiative-measures.mjs';
import { kpiTargetOf } from '../lib/strategy-initiatives.mjs';
import { alanDecisions } from '../lib/strategy-decisions.mjs';

const WHO = { by: 'Alan via Claude', at: '2026-11-10T21:45:00Z', why: 'Jan milestone resized to the 13 Jan course capacity (4 places)' };
const ROADMAP = [
  { key: 'dec26', label: 'Dec 26', plans: 3, beginners_non_jlr: 0, beginners_note: 'moved to January course (Alan, 9 Nov)', returning_r12: 16000 },
  { key: 'jan27', label: 'Jan course', due: '2027-01-27', only: ['beginners_non_jlr'], beginners_non_jlr: 4, decided: WHO },
  { key: 'mar27', label: 'Mar 27', plans: 6, beginners_non_jlr: 17, returning_r12: 18000 }
];
const COURSES = [
  { is_booking_row: true, is_beginners: true, source_bucket: 'Google', from_date: '2027-01-13' },
  { is_booking_row: true, is_beginners: false, source_bucket: 'JLR', from_date: '2027-01-12' },
  { is_booking_row: true, is_beginners: true, source_bucket: 'JLR', from_date: '2027-01-13' },
  { is_booking_row: true, is_beginners: true, source_bucket: 'Gift', from_date: '2026-09-15' },
  { is_booking_row: false, is_beginners: true, source_bucket: 'Google', from_date: '2027-02-10' }
];
const ctx = (today, dates) => ({ today, roadmap: ROADMAP, pnm: { since_relaunch: 0 }, roadmapNow: { beginners_non_jlr: 0, beginners_booked_dates: dates, returning_r12: 11192 }, txns: [], gpRates: [], master: {} });
const Q1 = { quarter_key: 'q1-2026', milestone_key: 'dec26', start_date: '2026-10-01', end_date: '2026-12-31' };
const Q2 = { quarter_key: 'q2-2027', milestone_key: 'mar27', start_date: '2027-01-01', end_date: '2027-03-31' };
const DATES = nonJlrBeginnerDates(COURSES);
const LIVE = ctx('2026-11-10', DATES);
const beg = (q, state, c) => kpiBoxes(q, state, c).find((k) => k.key === 'beginners');
const quarters = (c) => [{ key: 'q1-2026', kpis: kpiBoxes(Q1, 'current', c) }, { key: 'q2-2027', kpis: kpiBoxes(Q2, 'future', c) }];
const LEARNERS = { quarter_keys: ['q2-2027'], focus: { metrics: ['beginners'] } };

test('booking dates: non-JLR beginners booking rows from 1 Oct, past and future (JLR, non-beginners, pre-FY excluded)', () => {
  assert.deepEqual(DATES, ['2027-01-13']);
  assert.deepEqual(beginnersActual(LIVE, '2027-01-27'), { n: 1, basis: 'booked/taught' });
  assert.deepEqual(beginnersActual(LIVE, '2027-01-12'), { n: 0, basis: 'booked/taught' }, 'a course after the milestone date does not count');
});

test('Q1 box: moved to Jan course, "4 by 27 Jan (1 booked/taught)"; Q2 box value unchanged, sub names the booked count', () => {
  const q1 = beg(Q1, 'current', LIVE);
  assert.deepEqual([q1.value, q1.target, q1.actual, q1.actual_label], ['moved to Jan course', null, 1, 'booked/taught']);
  assert.match(q1.sub, /^4 by 27 Jan \(1 booked\/taught\) · moved to January course/);
  const q2 = beg(Q2, 'future', LIVE);
  assert.deepEqual([q2.value, q2.target, q2.actual, q2.actual_label, q2.by], ['4 by 27 Jan · 17 by Mar 27', 4, 1, 'booked/taught', '2027-01-27']);
  assert.equal(q2.sub, 'cumulative since 1 Oct 2026 · 1 booked/taught by 27 Jan');
});

test('New-year learners line: Target 4 · Actual 1 (booked/taught) · Gap 3 by 27 Jan; rendered with the label', () => {
  const t = kpiTargetOf(LEARNERS, quarters(LIVE), LIVE);
  assert.deepEqual([t.target, t.actual, t.gap, t.window.end, t.actual_label], [4, 1, 3, '2027-01-27', 'booked/taught']);
  const win = { addEventListener() {} };
  win.window = win;
  vm.runInNewContext(fs.readFileSync(new URL('../lib/strategy-quarter-plan.js', import.meta.url), 'utf8'), { window: win, document: { addEventListener() {}, getElementById: () => ({}), createElement: () => ({}), head: { appendChild() {} } }, console, Date, Math, Number, String, JSON, Set, Map, Intl });
  const ini = { key: 'l', kind: 'initiative', title: 'New-year learners & progression', status: { label: 'Planned' }, revenue: t, next: null, campaigns: [], deliveries: [], actions: [], assets: [], measure: {} };
  const html = win.stQuarterPlanHtml({ quarter_plan: { as_of: '2026-11-10', quarters: [{ key: 'q2-2027', label: 'Q2', state: 'future', display: 'full', start_date: '2027-01-01', end_date: '2027-03-31', theme: 't', initiative_keys: ['l'], kpis: [] }], initiatives: { l: ini } }, actions: [] });
  assert.match(html, /Target <b>4 beginners<\/b> · Actual <b>1<\/b> <span class="qp-ref">booked\/taught<\/span> · Gap <b>3<\/b> <span class="qp-ref">\(by 27 Jan\)<\/span>/);
});

test('same rule for every beginners milestone (one code path): Q2 current in Jan = "Non-JLR beginners booked/taught 1 / 4"; milestones line says both', () => {
  const jan = ctx('2027-01-05', DATES);
  const q2 = beg(Q2, 'current', jan);
  assert.deepEqual([q2.label, q2.value, q2.actual], ['Non-JLR beginners booked/taught', '1 / 4', 1]);
  const m = measureFor({ measure: 'milestones', quarter_keys: ['q2-2027'], focus: { metrics: ['beginners'] } }, { ...jan, quarters: [Q2] });
  assert.match(m.lines[0].sub, /1 booked\/taught on courses to 31 Mar 2027 · 0 taught so far$/);
});

test('no booking dates (older callers): falls back to taught, labelled "taught" (previous behaviour)', () => {
  const old = ctx('2026-11-10', undefined);
  const t = kpiTargetOf(LEARNERS, quarters(old), old);
  assert.deepEqual([t.actual, t.gap, t.actual_label], [0, 4, 'taught']);
  assert.match(beg(Q1, 'current', old).sub, /^4 by 27 Jan · moved/);
});

test('Decisions keep "taught": no beginners decision for the decided 4; an undecided 8 still fires; bookings never feed the rule', () => {
  const ins = { rows: { mix: [{ key: 'mix-pick-n-mix', numbers: { courses: [{ start: '2027-01-13', booked: 1, state: 'running' }] } }] } };
  const QP = { quarters: [{ key: 'q2-2027', label: 'Q2 · Jan–Mar 2027', start_date: '2027-01-01', end_date: '2027-03-31' }] };
  const run = (roadmap) => alanDecisions({ today: '2026-11-10', roadmap, taught: 0, insights: ins, quarterPlan: QP });
  assert.deepEqual(run(ROADMAP), []);
  assert.deepEqual(run(ROADMAP.map((r) => (r.key === 'jan27' ? { ...r, decided: undefined } : r))), [], '4 places on the 13 Jan course reach an undecided 4');
  const eight = run(ROADMAP.map((r) => (r.key === 'jan27' ? { ...r, decided: undefined, beginners_non_jlr: 8 } : r)));
  assert.equal(eight.length, 1);
  assert.equal(eight[0].numbers.taught, 0, 'the rule reads taught (0), not booked (1)');
});

/**
 * Alan, 9 Nov 2026: the non-JLR beginners target moves from 31 Dec to the end of the January course (Wed 27 Jan 2027).
 * The roadmap carries a dated stop (`due`); the Q1 / Q2 KPI boxes, initiative target lines and the Decisions rule read it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { kpiBoxes } from '../lib/strategy-initiative-measures.mjs';
import { kpiTargetOf } from '../lib/strategy-initiatives.mjs';
import { alanDecisions } from '../lib/strategy-decisions.mjs';

const WHO = { by: 'Alan via Claude', at: '2026-11-09T08:55:00Z', why: 'no promoted beginners course before 13 Jan' };
const BEFORE = [{ key: 'dec26', label: 'Dec 26', plans: 3, beginners_non_jlr: 8, returning_r12: 16000, gp_t3: 2800 }, { key: 'mar27', label: 'Mar 27', plans: 6, beginners_non_jlr: 17, returning_r12: 18000, gp_t3: 3000 }];
const AFTER = [
  { ...BEFORE[0], beginners_non_jlr: 0, beginners_note: 'moved to January course (Alan, 9 Nov)', history: [{ field: 'beginners_non_jlr', from: 8, to: 0, ...WHO }] },
  { key: 'jan27', label: 'Jan course', due: '2027-01-27', only: ['beginners_non_jlr'], beginners_non_jlr: 8, decided: WHO, history: [{ field: 'beginners_non_jlr', from: null, to: 8, ...WHO }] },
  BEFORE[1]
];
const ctx = (roadmap) => ({ today: '2026-11-09', roadmap, pnm: { since_relaunch: 0 }, roadmapNow: { beginners_non_jlr: 0, returning_r12: 11192 }, txns: [], gpRates: [], master: {} });
const Q1 = { quarter_key: 'q1-2026', milestone_key: 'dec26', start_date: '2026-10-01', end_date: '2026-12-31' };
const Q2 = { quarter_key: 'q2-2027', milestone_key: 'mar27', start_date: '2027-01-01', end_date: '2027-03-31' };
const COURSES = [{ start: '2027-01-13', booked: 1, state: 'running' }];
const QP = { quarters: [{ key: 'q1-2026', label: 'Q1 · Oct–Dec 2026', start_date: '2026-10-01', end_date: '2026-12-31' }, { key: 'q2-2027', label: 'Q2 · Jan–Mar 2027', start_date: '2027-01-01', end_date: '2027-03-31' }] };
const ins = { rows: { mix: [{ key: 'mix-pick-n-mix', numbers: { courses: COURSES } }] } };
const beg = (q, state, roadmap) => kpiBoxes(q, state, ctx(roadmap)).find((k) => k.key === 'beginners');

test('before: Q1 box 0 / 8 by 31 Dec and the beginners decision fires (unchanged behaviour)', () => {
  assert.equal(beg(Q1, 'current', BEFORE).value, '0 / 8');
  assert.equal(alanDecisions({ today: '2026-11-09', roadmap: BEFORE, taught: 0, insights: ins, quarterPlan: QP }).length, 1);
});

test('after: Q1 box "Non-JLR beginners: moved to Jan course"; Q2 box "8 by 27 Jan · 17 by Mar 27"', () => {
  const q1 = beg(Q1, 'current', AFTER);
  assert.deepEqual([q1.label, q1.value, q1.target], ['Non-JLR beginners', 'moved to Jan course', null]);
  assert.match(q1.sub, /^8 by 27 Jan · moved to January course \(Alan, 9 Nov\)/);
  const q2 = beg(Q2, 'future', AFTER);
  assert.deepEqual([q2.value, q2.target, q2.by], ['8 by 27 Jan · 17 by Mar 27', 8, '2027-01-27']);
});

test('after: the Q2 initiative line reads the dated stop; Decisions has 0 rows because the next milestone is decided', () => {
  const quarters = [{ key: 'q1-2026', kpis: kpiBoxes(Q1, 'current', ctx(AFTER)) }, { key: 'q2-2027', kpis: kpiBoxes(Q2, 'future', ctx(AFTER)) }];
  const t = kpiTargetOf({ quarter_keys: ['q2-2027'], focus: { metrics: ['beginners'] } }, quarters, ctx(AFTER));
  assert.deepEqual([t.target, t.actual, t.gap, t.window.end], [8, 0, 8, '2027-01-27']);
  assert.deepEqual(alanDecisions({ today: '2026-11-09', roadmap: AFTER, taught: 0, insights: ins, quarterPlan: QP }), []);
  const undecided = AFTER.map((r) => (r.key === 'jan27' ? { ...r, decided: undefined } : r));
  assert.equal(alanDecisions({ today: '2026-11-09', roadmap: undecided, taught: 0, insights: ins, quarterPlan: QP }).length, 1, 'the rule still fires for an undecided milestone');
});

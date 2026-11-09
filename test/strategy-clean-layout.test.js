/**
 * Strategy clean layout (QUESTION-2026-11-08-strategy-tab-clean-layout): Decisions computed from data, the month split
 * behind "sales still needed", revenue target / actual / gap per initiative, the Strategy tiles built from the Marketing
 * Overview tile builders, and Planned's first item.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { alanDecisions, beginnersDecision, milestoneDate } from '../lib/strategy-decisions.mjs';
import { monthSplit } from '../lib/strategy-insights/money.mjs';
import { revenueOf } from '../lib/strategy-initiatives.mjs';

const ROADMAP = [{ key: 'dec26', label: 'Dec 26', beginners_non_jlr: 8, plans: 3 }, { key: 'mar27', label: 'Mar 27', beginners_non_jlr: 17 }];
const COURSES = [{ start: '2026-11-09', booked: 0, state: 'not_promoted' }, { start: '2026-12-01', booked: 0, state: 'not_promoted' }, { start: '2027-01-13', booked: 1, state: 'running' }];
const QUARTERS = [{ key: 'q1-2026', label: 'Q1 · Oct–Dec 2026', start_date: '2026-10-01', end_date: '2026-12-31' }, { key: 'q2-2027', label: 'Q2 · Jan–Mar 2027', start_date: '2027-01-01', end_date: '2027-03-31' }];

test('beginners decision: Q1 target 8, next promoted course 13 Jan (1 booked) → the Dec milestone cannot be met; Keep / Move to Q2 / Change', () => {
  const d = beginnersDecision({ today: '2026-11-08', roadmap: ROADMAP, taught: 0, courses: COURSES, quarters: QUARTERS });
  assert.equal(milestoneDate('dec26'), '2026-12-31');
  assert.match(d.what, /^Q1 target: 8 non-JLR beginners by Thu 31 Dec/);
  assert.match(d.why, /0 taught so far and the next promoted course is Wed 13 Jan \(1 booked\), so the Dec milestone can't be met/);
  assert.deepEqual([d.options, d.due, d.numbers.reachable], [['Keep', 'Move to Q2', 'Change'], '2026-12-31', 0]);
});

test('no decision when promoted courses before the milestone can still reach it; GPT / Claude tasks never appear', () => {
  const ok = beginnersDecision({ today: '2026-11-08', roadmap: ROADMAP, taught: 6, courses: [{ start: '2026-12-01', booked: 0, state: 'running' }] });
  assert.equal(ok, null);
  const ins = { rows: { mix: [{ key: 'mix-pick-n-mix', numbers: { courses: COURSES } }] } };
  const list = alanDecisions({ today: '2026-11-08', roadmap: [], roadmapFallback: ROADMAP, taught: 0, insights: ins, quarterPlan: { quarters: QUARTERS } });
  assert.deepEqual(list.map((x) => x.kind), ['target']);
});

test('sales still needed: each month and the running total to its month end (to 31 Dec, to 31 Jan)', () => {
  const m = monthSplit([{ y: 2026, m: 11 }, { y: 2026, m: 12 }, { y: 2027, m: 1 }], [5505, 5191, 4332]);
  assert.deepEqual(m.map((x) => [x.label, x.needed, x.to_end, x.end]), [['Nov', 5505, 5505, '2026-11-30'], ['Dec', 5191, 10696, '2026-12-31'], ['Jan', 4332, 15028, '2027-01-31']]);
});

test('revenue per initiative: target / actual (at least) / gap (at most) for Gifts; "—" with the owner where no revenue target', () => {
  const gift = revenueOf({ owner: 'GPT' }, { target_total: 2100, window: { end: '2026-12-31' }, target_lines: [{ label: 'Gift voucher issue receipts', actual: 0 }, { label: 'Gift 1-to-1 sales', actual: null }] });
  assert.deepEqual([gift.target, gift.actual, gift.actual_complete, gift.gap, gift.unknown], [2100, 0, false, 2100, ['Gift 1-to-1 sales']]);
  assert.deepEqual(revenueOf({ owner: 'GPT', owner_detail: 'GPT (targeting)' }, { kind: 'dated' }), { target: null, owner: 'GPT (targeting)', note: 'no revenue target set' });
});

function browser() {
  const win = { addEventListener() {}, document: null };
  const ctx = { window: win, document: { addEventListener() {}, getElementById: () => null, querySelector: () => null }, setTimeout, console, Intl, Date, Math, Number, String, JSON, Promise };
  ctx.window.window = ctx.window;
  for (const f of ['marketing-overview-tiles.js', 'marketing-schedule-model.js', 'strategy-layout.js']) vm.runInNewContext(fs.readFileSync(new URL(`../lib/${f}`, import.meta.url), 'utf8'), ctx);
  return ctx.window;
}

test('Strategy tiles reuse the Marketing builders: Repeat clients + Academy progression moved here; sales tiles retired', () => {
  const w = browser();
  const s = {
    insights: { rows: { money: [{ key: 'money-next-3', numbers: { required: 15028, inHand: 4765, potential: 7765, window_end: '2027-01-31', months: monthSplit([{ y: 2026, m: 11 }, { y: 2026, m: 12 }, { y: 2027, m: 1 }], [5505, 5191, 4332]) } }, { key: 'money-this-month', title: 'This month · November', numbers: { sales: 250, sales_target: 5755, of_target_pct: 4, gp: 200, gp_target: 4000 } }], mix: [{ key: 'mix-returning', headline: { value: '15%' }, comparison: '1 of 2', table: { rows: [] } }, { key: 'mix-pick-n-mix', numbers: { since_relaunch: 0, status_line: 'Relaunch Tue 10 Nov · 0 plans yet' } }] } },
    roadmap_now: { returning_r12: 11192 }, roadmap: ROADMAP.map((r) => ({ ...r, returning_r12: 16000 })),
    quarter_plan: { quarters: [{ state: 'current', kpis: [{ key: 'plans', target: 3, sub: 'cumulative from relaunch 10 Nov · by 31 Dec' }] }] },
    decisions: [beginnersDecision({ today: '2026-11-08', roadmap: ROADMAP, taught: 0, courses: COURSES, quarters: QUARTERS })]
  };
  const p = w.stLayoutParts;
  assert.equal(p.salesTile, undefined, 'Sales still needed retired');
  assert.equal(p.bookedTile, undefined, 'Booked ahead retired (a line in each month\'s detail)');
  assert.match(p.repeatTile(s).head, /£11\.2k/);
  assert.equal(p.repeatTile(s).head, w.mkOverviewTiles.tileRepeat(s).head, 'the same builder Marketing used');
  assert.equal(p.repeatTile(s).title, 'Repeat clients');
  assert.equal(p.academyTile(s).title, 'Academy progression');
  assert.match(p.plansTile(s).head, /0 .*of 3 by 31 Dec/);
  assert.doesNotMatch(p.tilesHtml(s), /Sales still needed|This month ·|Booked ahead/);
  assert.match(p.decisionsHtml(s), /Decisions for Alan \(1\)[\s\S]*13 Jan \(1 booked\)[\s\S]*Move to Q2/);
});

test('Next delivery = Planned\'s first upcoming item (scheduled / planned / draft, never done, late or resolved)', () => {
  const w = browser();
  const m = { today: '2026-11-08', items: [{ id: 'a', state: 'done', day: '2026-11-08', time: '17:00', row: 'email' }, { id: 'b', state: 'late', day: '2026-11-07', row: 'fbig' }, { id: 'c', state: 'pl', day: '2026-11-09', time: null, row: 'linkedin' }, { id: 'd', state: 'sch', day: '2026-11-09', time: '10:00', row: 'email', title: 'Something to inspire' }, { id: 'e', state: 'resolved', day: '2026-11-09', time: '08:00', row: 'email' }] };
  const first = w.mkScheduleModel.firstPlanned(m);
  assert.equal(first.id, 'd');
  assert.match(w.stLayoutParts.nextDeliveryLine(first), /Next delivery: <b>Something to inspire<\/b> · Mon 9 Nov 10:00 · scheduled in the platform/);
});

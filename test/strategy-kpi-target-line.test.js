/**
 * Correction 3 (8 Nov 2026): an initiative's target line reads the SAME Targets-panel roadmap KPI as its quarter card's
 * KPI box (joined by the initiative's target.milestone / focus.metrics), with count units (plans, beginners) or £.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { kpiBoxes } from '../lib/strategy-initiative-measures.mjs';
import { kpiKeysOf, kpiTargetOf, targetLineOf } from '../lib/strategy-initiatives.mjs';

const ROADMAP = [{ key: 'dec26', label: 'Dec 26', plans: 3, beginners_non_jlr: 8, returning_r12: 16000 }, { key: 'mar27', label: 'Mar 27', plans: 6, beginners_non_jlr: 17, returning_r12: 18000 }];
const CTX = { today: '2026-11-08', roadmap: ROADMAP, pnm: { since_relaunch: 0, relaunch: '2026-11-10' }, roadmapNow: { beginners_non_jlr: 0, returning_r12: 11192 }, txns: [], gpRates: [], master: {} };
const Q1 = { key: 'q1-2026', state: 'current', kpis: kpiBoxes({ quarter_key: 'q1-2026', milestone_key: 'dec26', start_date: '2026-10-01', end_date: '2026-12-31' }, 'current', CTX) };
const Q2 = { key: 'q2-2027', state: 'future', kpis: kpiBoxes({ quarter_key: 'q2-2027', milestone_key: 'mar27', start_date: '2027-01-01', end_date: '2027-03-31' }, 'future', CTX) };
const PNM = { initiative_key: 'q1-pnm-repeat', owner: 'GPT', quarter_keys: ['q1-2026'], target: { milestone: 'plans' }, focus: { campaign_key: 'x' } };

test('Pick n Mix initiative joins the Q1 "plans" KPI box: Target 3 plans · Actual 0 · Gap 3 by 31 Dec (same numbers as the box)', () => {
  const box = Q1.kpis.find((k) => k.key === 'plans');
  assert.deepEqual([box.value, box.target, box.actual, box.unit, box.by], ['0 / 3', 3, 0, 'plans', '2026-12-31']);
  const t = kpiTargetOf(PNM, [Q1, Q2], CTX);
  assert.deepEqual([t.kind, t.key, t.target, t.actual, t.gap, t.unit, t.window.end], ['kpi', 'plans', box.target, box.actual, 3, 'plans', '2026-12-31']);
});

test('focus.metrics joins too: a future-quarter beginners / returning KPI with the same actual function; first metric shown, others listed', () => {
  const learners = kpiTargetOf({ quarter_keys: ['q2-2027'], focus: { metrics: ['beginners'] } }, [Q1, Q2], CTX);
  assert.deepEqual([learners.target, learners.actual, learners.gap, learners.unit, learners.window.end], [17, 0, 17, 'beginners', '2027-03-31']);
  const ret = kpiTargetOf({ quarter_keys: ['q2-2027'], focus: { metrics: ['returning'] } }, [Q1, Q2], CTX);
  assert.deepEqual([ret.target, ret.actual, ret.gap, ret.unit], [18000, 11192, 6808, 'gbp']);
  assert.deepEqual(kpiKeysOf({ target: { milestone: 'plans' }, focus: { metrics: ['plans', 'returning', 'other'] } }), ['plans', 'returning']);
});

test('precedence: a revenue target wins; no roadmap KPI and no revenue target = "—" with the owner (never invented)', () => {
  const gift = targetLineOf({ owner: 'GPT' }, { target_total: 2100, target_lines: [{ label: 'v', actual: 0 }] }, [Q1], CTX);
  assert.equal(gift.target, 2100);
  const none = targetLineOf({ owner: 'Claude', quarter_keys: ['q1-2026'], focus: {} }, { kind: 'academy' }, [Q1], CTX);
  assert.deepEqual([none.target, none.owner], [null, 'Claude']);
  assert.equal(kpiTargetOf({ quarter_keys: ['q3-2027'], focus: { metrics: ['plans'] } }, [Q1, Q2], CTX), null, 'quarter without a milestone box');
});

test('rendered line uses the unit: "Target 3 plans · Actual 0 · Gap 3 (by 31 Dec)"; £ KPIs in the box format', () => {
  const win = { addEventListener() {} };
  const ctx = { window: win, document: { addEventListener() {}, getElementById: () => ({}), createElement: () => ({}), head: { appendChild() {} } }, console, Date, Math, Number, String, JSON, Set, Map, Intl };
  win.window = win;
  vm.runInNewContext(fs.readFileSync(new URL('../lib/strategy-quarter-plan.js', import.meta.url), 'utf8'), ctx);
  const ini = (key, rev) => ({ key, kind: 'initiative', title: key, status: { label: 'In progress' }, revenue: rev, next: null, campaigns: [], deliveries: [], actions: [], assets: [], measure: {} });
  const plan = { quarter_plan: { as_of: '2026-11-08', quarters: [{ key: 'q1-2026', label: 'Q1', state: 'current', display: 'full', start_date: '2026-10-01', end_date: '2026-12-31', theme: 't', initiative_keys: ['a', 'b'], kpis: [] }], initiatives: {
    a: ini('a', kpiTargetOf(PNM, [Q1], CTX)), b: ini('b', kpiTargetOf({ quarter_keys: ['q2-2027'], focus: { metrics: ['returning'] } }, [Q2], CTX))
  } }, actions: [] };
  const html = win.stQuarterPlanHtml(plan);
  assert.match(html, /Target <b>3 plans<\/b> · Actual <b>0<\/b> · Gap <b>3<\/b> <span class="qp-ref">\(by 31 Dec\)<\/span>/);
  assert.match(html, /Target <b>£18k<\/b> · Actual <b>£11\.2k<\/b> · Gap <b>£6\.8k<\/b> <span class="qp-ref">\(by 31 Mar\)<\/span>/);
});

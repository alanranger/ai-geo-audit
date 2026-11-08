/**
 * Strategy Pick n Mix tile (Alan, 8 Nov 2026): "since relaunch" counts PnM Plans tab rows from the Targets panel
 * relaunch date (default Tue 10 Nov 2026). With no row yet it reads "Relaunch Tue 10 Nov · 0 plans yet" in grey —
 * never red or overdue. Fixture rows only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickNMixTile } from '../lib/strategy-insights/mix.mjs';
import { pnmPlanInfo, relaunchDate } from '../lib/marketing/plan-sources.mjs';

const ROADMAP = [{ key: 'dec26', label: 'Dec 2026', plans: 3 }, { key: 'mar27', label: 'Mar 2027', plans: 6 }];
const HISTORY = [{ plan_key: 'old-1', email: 'old@example.com', starts: '2024-03-01', ends: '2025-02-28' }];
const sheetRow = (id, start, extra = {}) => ({ id, plan_id: `PNM-${id}`, client_name: `Client ${id}`, email: `c${id}@example.com`, start_date: start, end_date: null, plan_type: 'Annual', payment: 600, status: 'Active', source_row: id + 1, ...extra });
const tile = (today, sheetRows, kpi) => pickNMixTile({
  roadmap: ROADMAP, diary: [], today, terms: null, dontPromote: new Set(),
  planInfo: pnmPlanInfo({ sheetRows, historyPlans: HISTORY, relaunch: relaunchDate(kpi), today, incomeR12: 0 })
});

test('before the relaunch with 0 rows: "Relaunch Tue 10 Nov · 0 plans yet", grey, 0 active', () => {
  const t = tile('2026-11-08', []);
  assert.equal(t.headline.value, '0');
  assert.equal(t.headline.label, 'since relaunch');
  assert.equal(t.headline.rag, 'grey');
  assert.ok(t.comparison.startsWith('Relaunch Tue 10 Nov · 0 plans yet · target 3 by Dec · 6 by Mar (Targets panel)'), t.comparison);
  assert.match(t.comparison, /0 plans active now/);
  assert.doesNotMatch(t.comparison, /overdue|behind/i);
  assert.equal(t.numbers.status_line, 'Relaunch Tue 10 Nov · 0 plans yet');
  assert.equal(t.numbers.relaunch, '2026-11-10');
  assert.equal(t.numbers.sheet_rows, 0);
});

test('after the relaunch with still no row: same grey text (not behind, not red)', () => {
  const t = tile('2026-11-25', []);
  assert.equal(t.headline.rag, 'grey');
  assert.equal(t.numbers.status_line, 'Relaunch Tue 10 Nov · 0 plans yet');
});

test('plans sold from the relaunch date count; a tab row starting before it does not; RAG vs the Dec target', () => {
  const t = tile('2026-11-20', [sheetRow(1, '2026-11-12'), sheetRow(2, '2026-11-01'), sheetRow(3, '2026-12-01')]);
  assert.equal(t.headline.value, '2');
  assert.equal(t.headline.rag, 'red');
  assert.ok(t.comparison.startsWith('2 plans sold since the relaunch Tue 10 Nov (PnM Plans tab)'), t.comparison);
  assert.equal(t.numbers.active, 2);
  const three = tile('2026-12-20', [sheetRow(1, '2026-11-12'), sheetRow(3, '2026-12-01'), sheetRow(4, '2026-12-10')]);
  assert.equal(three.headline.rag, 'green');
});

test('the relaunch date is the Targets panel setting, not hard-coded', () => {
  const t = tile('2026-11-20', [sheetRow(1, '2026-11-12')], { pnm_relaunch_date: '2026-11-17' });
  assert.equal(t.headline.value, '0');
  assert.equal(t.numbers.status_line, 'Relaunch Tue 17 Nov · 0 plans yet');
});

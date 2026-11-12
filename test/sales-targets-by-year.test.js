import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import xlsx from 'xlsx';
import { parseSalesTargets } from '../lib/booking-sheet-sales-targets.mjs';
import {
  assembleTargetsMaster, monthTargetsFor, salesTargetsByYear, salesRowForYear, patternYear, seasonalMonthly
} from '../lib/targets-master.mjs';
import { monthSalesTarget, monthsFrom } from '../lib/strategy-sales-gap.mjs';

const W2026 = [0.0752, 0.0607, 0.04, 0.0823, 0.0963, 0.1037, 0.078, 0.0593, 0.093, 0.1214, 0.0999, 0.0902];
const W2027 = [0.094, 0.075, 0.098, 0.082, 0.082, 0.060, 0.052, 0.081, 0.104, 0.090, 0.098, 0.084];
const CATS_2027 = { 1: 550, 2: 1000, 3: 1400, 4: 400, 5: -200, 6: 80, 7: 900, 8: 150, 9: -100, 10: 75, 11: 600, 12: 300 };
const CATS_2026 = { 1: 666.67, 2: 1666.67, 3: 833.33, 4: 100, 5: -100, 6: 80, 7: 800, 8: 83, 9: -100, 10: 100, 11: 500, 12: 250 };
const LABELS = ['Courses/masterclasses', 'Workshops Non Residential', 'Workshops Residential', 'Pick n Mix Inc', 'Pick n Mix Out', 'Mentoring', '1-2-1', 'Gift Vouchers Inc', 'Gift Vouchers Out', 'Prints & Royalties', 'Commissions', 'Academy'];

/** A "Sales YYYY" sheet in the Booking Sheet layout: J labels + K..V months + W year; I categories under the header. */
function salesSheet(weights, monthly, cats) {
  const rows = Array.from({ length: 30 }, () => Array(23).fill(null));
  const put = (r, label, vals) => { rows[r][9] = label; vals.forEach((v, i) => { rows[r][10 + i] = v; }); rows[r][22] = vals.reduce((a, v) => a + v, 0); };
  put(2, 'Weighting', weights);
  put(3, 'Monthly Target', monthly);
  put(4, 'Working Days', [23, 21, 21, 22, 23, 20, 23, 22, 21, 23, 21, 22]);
  rows[5][8] = 'Sales Categories';
  LABELS.forEach((l, i) => { rows[6 + i][8] = `${i + 1}. ${l}`; rows[6 + i][9] = cats[i + 1]; });
  rows[18][8] = 'Totals';
  return xlsx.utils.aoa_to_sheet(rows);
}

test('upload parse: every "Sales YYYY" tab from 2026 on becomes its own row (2027 + 2026; older tabs and other sheets ignored)', () => {
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, salesSheet(W2027, W2027.map((w) => 61860 * w), CATS_2027), 'Sales 2027');
  xlsx.utils.book_append_sheet(wb, salesSheet(W2026, W2026.map((w) => 58556 * w), CATS_2026), 'Sales 2026');
  xlsx.utils.book_append_sheet(wb, salesSheet(W2026, W2026, CATS_2026), 'Sales 2025');
  xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet([['x']]), 'Bookings 2027');
  const { rows, warnings } = parseSalesTargets(wb);
  assert.deepEqual(warnings, []);
  assert.deepEqual(rows.map((r) => [r.year, r.source_workbook]), [[2027, 'Sales 2027'], [2026, 'Sales 2026']]);
  const r27 = rows[0];
  assert.deepEqual(r27.weighting, W2027);
  assert.deepEqual(r27.working_days, [23, 21, 21, 22, 23, 20, 23, 22, 21, 23, 21, 22]);
  assert.deepEqual(r27.category_targets, Object.fromEntries(Object.entries(CATS_2027).map(([k, v]) => [k, v])));
  assert.equal(Math.round(r27.annual_target), 61860);
  assert.equal(r27.monthly_target[0], 5814.84);
});

test('a future "Sales 2028" tab is picked up the same way', () => {
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, salesSheet(W2027, W2027, CATS_2027), 'Sales 2028');
  assert.deepEqual(parseSalesTargets(wb).rows.map((r) => r.source_workbook), ['Sales 2028']);
});

test('pattern year: the latest row at or before the year, else the earliest (2028 reuses 2027; 2025 uses 2026)', () => {
  assert.equal(patternYear([2026, 2027], 2026), 2026);
  assert.equal(patternYear([2026, 2027], 2027), 2027);
  assert.equal(patternYear([2026, 2027], 2028), 2027);
  assert.equal(patternYear([2026, 2027], 2025), 2026);
  assert.equal(patternYear([], 2026), null);
});

test('service mix: a 2026 month reads the 2026 row even when the 2027 row is newer', () => {
  const rows = [{ year: 2027, category_targets: CATS_2027 }, { year: 2026, category_targets: CATS_2026 }];
  assert.equal(salesRowForYear(rows, 2026).category_targets['8'], 83);
  assert.equal(salesRowForYear(rows, 2027).category_targets['8'], 150);
});

const BIZ = { source: 'business_targets', survival_gp_monthly: 3700, survival_gp_annual: 44400, stretch1_gp_monthly: 4000, stretch1_gp_annual: 48000, stretch2_gp_monthly: 4700, stretch2_gp_annual: 56400, effective_from: '2026-11-12' };
const RATES = { 1: 0.9, 2: 0.75, 3: 0.35, 6: 0.95, 7: 0.95, 10: 0.99, 11: 0.9, 12: 0.99 };
const gpRows = (year) => Object.entries(RATES).map(([o, r]) => ({ year, category_order: Number(o), gp_rate: r }));
const SALES_ROWS = [
  { year: 2027, weighting: W2027, category_targets: CATS_2027, category_labels: {} },
  { year: 2026, weighting: W2026, category_targets: CATS_2026, category_labels: {} }
];
const master = (iso) => assembleTargetsMaster({ biz: BIZ, salesRows: SALES_ROWS, gpRows: [...gpRows(2026), ...gpRows(2027)], asOf: new Date(iso) });

test('master: this year from its own row; by_year holds last / this / next year, each with its own weighting and mix', () => {
  const nov = master('2026-11-12T12:00:00Z');
  assert.deepEqual(nov.seasonal.weighting, W2026);
  assert.deepEqual(Object.keys(nov.by_year), ['2025', '2026', '2027']);
  assert.equal(nov.by_year[2027].pattern_year, 2027);
  assert.deepEqual(nov.by_year[2027].gp_survival, seasonalMonthly(44400, W2027));
  assert.deepEqual(nov.by_year[2026].gp_survival, nov.seasonal.survival);
  assert.deepEqual(nov.by_year[2026].sales_survival, nov.revenue_equivalent.survival_monthly);
  assert.notDeepEqual(nov.by_year[2027].sales_survival, nov.by_year[2026].sales_survival);
  const jan = master('2027-01-15T12:00:00Z');
  assert.deepEqual(jan.seasonal.weighting, W2027, 'in 2027 the Survival Cockpit / brief read the 2027 row');
  assert.deepEqual(jan.by_year[2026].gp_survival, nov.seasonal.survival, '2026 months keep the 2026 figures after New Year');
});

test('a Dec 2026 → Feb 2027 window mixes the two years (sales gap, next-3-months tile)', () => {
  const nov = master('2026-11-12T12:00:00Z');
  const byYear = salesTargetsByYear(nov);
  const months = monthsFrom('2026-12-10', 3);
  assert.deepEqual(months.map((mm) => mm.key), ['2026-12', '2027-01', '2027-02']);
  const got = months.map((mm) => monthSalesTarget(byYear, mm));
  assert.deepEqual(got, [nov.by_year[2026].sales_survival[11], nov.by_year[2027].sales_survival[0], nov.by_year[2027].sales_survival[1]]);
  assert.deepEqual(months.map((mm) => monthTargetsFor(nov, mm.y, mm.m).sales), got, 'money tile helper agrees with the sales gap');
  assert.equal(monthSalesTarget(nov.revenue_equivalent.survival_monthly, months[1]), nov.by_year[2026].sales_survival[0], 'the old one-list form still works');
});

test('Revenue / Strategy GP chart: each month weighted by its own year; years outside the range use the nearest', () => {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(new URL('../lib/monthly-chart.js', import.meta.url), 'utf8'), sandbox);
  const f = sandbox.window.MonthlyChart.seasonalFactor;
  const data = { targets: { weighting: W2026, weighting_by_year: { 2025: W2026, 2026: W2026, 2027: W2027 } } };
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  assert.ok(near(f(data)('2027-01'), 12 * W2027[0]));
  assert.ok(near(f(data)('2026-01'), 12 * W2026[0]));
  assert.ok(near(f(data)('2024-03'), 12 * W2026[2]));
  assert.ok(near(f({ targets: { weighting: W2026 } })('2027-01'), 12 * W2026[0]), 'older payload without by_year: unchanged');
  assert.equal(f({ targets: {} })('2027-01'), 1);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seasonalMonthly, tierShares, tierTargets, ytdTarget, gpFromCategoryRevenue } from '../lib/targets-master.mjs';
import { targetsPatch } from '../api/aigeo/targets-master.js';

const WEIGHTING_2026 = [0.07521252934116325, 0.06067643446464093, 0.04000145481810577, 0.08232636606021268, 0.09632395441942966,
  0.10365892349055628, 0.07802860955759541, 0.059322782171763656, 0.09301816004677799, 0.12141397128972423, 0.09990817859570883, 0.0901086357443213];

test('seasonal survival = £44,400 × Booking Sheet weighting (Alan\'s S2 figures)', () => {
  assert.deepEqual(seasonalMonthly(44400, WEIGHTING_2026), [3339, 2694, 1776, 3655, 4277, 4602, 3464, 2634, 4130, 5391, 4436, 4001]);
});

test('no weighting: flat 1/12 a month', () => {
  assert.deepEqual(seasonalMonthly(1200, null), Array(12).fill(100));
});

test('per-tier GP share = revenue mix × GP rate; revenue equivalent uses the same rate', () => {
  const rates = { 1: 0.9, 2: 0.75, 3: 0.35, 6: 0.95, 7: 0.95, 10: 0.99, 11: 0.9, 12: 0.99 };
  const shares = tierShares({ 1: 100, 2: 100, 4: 100 }, rates);
  assert.ok(Math.abs(shares[1] - 0.9 / 1.65) < 1e-9);
  assert.equal(shares[3], 0);
  const [courses] = tierTargets(Array(12).fill(1650), shares, rates, { 1: 'Courses' });
  assert.equal(courses.gp_monthly[0], 900);
  assert.equal(courses.revenue_monthly[0], 1000);
});

test('YTD target = seasonal months before this one + this month pro-rata by day', () => {
  assert.equal(ytdTarget(Array(12).fill(300), new Date(Date.UTC(2026, 2, 15))), 600 + Math.round(300 * 15 / 31) - 0);
});

test('the one GP method: revenue × its category rate', () => {
  assert.equal(gpFromCategoryRevenue([{ category_order: 1, revenue: 100 }, { category_order: 3, revenue: 100 }], { 1: 0.9, 3: 0.35 }), 125);
});

test('panel save accepts only its own fields and rejects a non-positive target', () => {
  assert.deepEqual(targetsPatch({ survival_gp_monthly: '3800', id: 9, notes: 'x' }), { survival_gp_monthly: 3800, survival_gp_annual: 45600 });
  assert.throws(() => targetsPatch({ stretch1_gp_monthly: 0 }), /positive/);
});

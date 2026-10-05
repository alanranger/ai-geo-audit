import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APPROVED_GP_TIERS,
  salesNeeded,
  closedMonthWindow,
  formatGpSurvivalLabel
} from '../lib/business-targets.mjs';

test('approved GP tiers are 3700 / 4000 / 4700', () => {
  assert.equal(APPROVED_GP_TIERS.survival_gp_monthly, 3700);
  assert.equal(APPROVED_GP_TIERS.stretch1_gp_monthly, 4000);
  assert.equal(APPROVED_GP_TIERS.stretch2_gp_monthly, 4700);
});

test('derived sales = GP / margin', () => {
  assert.equal(salesNeeded(3700, 72.5), 5103);
  assert.equal(salesNeeded(4000, 72.5), 5517);
  assert.equal(salesNeeded(4700, 72.5), 6483);
});

test('closed month window ending Oct 2026 is Jul-Sep', () => {
  const w = closedMonthWindow(new Date('2026-10-05T12:00:00Z'));
  assert.deepEqual(w, [
    { year: 2026, month: 7 },
    { year: 2026, month: 8 },
    { year: 2026, month: 9 }
  ]);
});

test('survival label mentions GP 3700', () => {
  assert.match(formatGpSurvivalLabel(), /3,700/);
  assert.match(formatGpSurvivalLabel(), /GP/);
});

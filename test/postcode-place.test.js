import test from 'node:test';
import assert from 'node:assert/strict';
import { choosePostcode, classifyPostcode, planPostcodeLookups } from '../lib/marketing/postcode-place.mjs';

test('full postcodes, typos and trailing junk stay full', () => {
  assert.deepEqual(classifyPostcode('cv4 9hw'), { key: 'CV4 9HW', precision: 'full', kind: 'full' });
  assert.deepEqual(classifyPostcode('CV23 OSP'), { key: 'CV23 0SP', precision: 'full', kind: 'full' });
  assert.deepEqual(classifyPostcode('CV83DA7'), { key: 'CV8 3DA', precision: 'full', kind: 'full' });
  assert.deepEqual(classifyPostcode('B912BU45'), { key: 'B91 2BU', precision: 'full', kind: 'full' });
  assert.deepEqual(classifyPostcode('EC1M 1AA'), { key: 'EC1M 1AA', precision: 'full', kind: 'full' });
  assert.deepEqual(classifyPostcode('W1K 1AA'), { key: 'W1K 1AA', precision: 'full', kind: 'full' });
});

test('outward codes and half-finished sectors use the district', () => {
  assert.deepEqual(classifyPostcode('GL54'), { key: 'GL54', precision: 'district', kind: 'district' });
  assert.deepEqual(classifyPostcode('CV7 7A'), { key: 'CV7', precision: 'district', kind: 'district' });
  assert.deepEqual(classifyPostcode('BN13 3'), { key: 'BN13', precision: 'district', kind: 'district' });
  assert.deepEqual(classifyPostcode('B26'), { key: 'B26', precision: 'district', kind: 'district' });
});

test('overseas codes are marked and town names are left alone', () => {
  assert.equal(classifyPostcode('K2J 0P2').kind, 'non_uk');
  assert.equal(classifyPostcode('V94XHH4').kind, 'non_uk');
  assert.equal(classifyPostcode('90210').kind, 'non_uk');
  assert.equal(classifyPostcode('STRATFORDONAVON'), null);
  assert.equal(classifyPostcode('DOLLAR'), null);
});

test('a full order postcode beats a district on the profile', () => {
  const chosen = choosePostcode('GL54', 'CV4 9HW');
  assert.equal(chosen.key, 'CV4 9HW');
  assert.equal(chosen.source, 'order_billing');
  assert.equal(choosePostcode('GL54', null).key, 'GL54');
  assert.equal(choosePostcode('CV4 9HW', 'GL54').source, 'squarespace_profile');
});

test('a cached full postcode is known and a new district is still to look up', () => {
  const plan = planPostcodeLookups(['CV4 9HW', 'GL54', '90210'], ['CV4 9HW']);
  assert.equal(plan.known, 1);
  assert.equal(plan.district.length, 1);
  assert.equal(plan.district[0].key, 'GL54');
  assert.equal(plan.non_uk, 1);
  assert.equal(plan.full.length, 0);
});

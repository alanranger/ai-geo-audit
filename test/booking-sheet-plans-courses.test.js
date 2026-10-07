import test from 'node:test';
import assert from 'node:assert/strict';
import { mapBeginnersSourceBucket } from '../lib/booking-sheet-plans-courses.mjs';

test('beginners source buckets', () => {
  assert.equal(mapBeginnersSourceBucket('Google'), 'Google');
  assert.equal(mapBeginnersSourceBucket('Goolge'), 'Google');
  assert.equal(mapBeginnersSourceBucket('Into the Blue'), 'Gift');
  assert.equal(mapBeginnersSourceBucket('Gift Voucher Out'), 'Gift');
  assert.equal(mapBeginnersSourceBucket('Existing'), 'Existing & referral');
  assert.equal(mapBeginnersSourceBucket('Referral'), 'Existing & referral');
  assert.equal(mapBeginnersSourceBucket('JLR'), 'JLR');
  assert.equal(mapBeginnersSourceBucket('ELS'), 'JLR');
  assert.equal(mapBeginnersSourceBucket('xyz'), 'Other');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { chatgptAdsView } from '../lib/chatgpt-ads-plan-data.js';

test('orders stay unproven until a captured visit exists', () => {
  const view = chatgptAdsView(false);
  assert.equal(view.tracking, 'Tracking: Academy proven · Orders not proven');
  assert.equal(view.blockers[0], 'Order tracking proof');
  assert.equal(view.campaigns.length, 2);
  assert.equal(view.campaigns[0].state, 'PAUSED');
  assert.equal(view.campaigns[1].state, 'PAUSED');
});

test('a captured visit marks orders proven and drops that blocker', () => {
  const view = chatgptAdsView(true);
  assert.equal(view.tracking, 'Tracking: Academy proven · Orders proven');
  assert.equal(view.blockers.includes('Order tracking proof'), false);
  assert.equal(view.blockers.length, 3);
});

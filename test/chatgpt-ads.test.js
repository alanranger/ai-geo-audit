import test from 'node:test';
import assert from 'node:assert/strict';
import { squarespaceOrderKey, summariseChatgptAds } from '../lib/acquisition/chatgpt-ads.js';

test('short GA4 transaction ids match Squarespace order numbers', () => {
  assert.equal(squarespaceOrderKey('03369'), '3369');
  assert.equal(squarespaceOrderKey('(not set)'), null);
  assert.equal(squarespaceOrderKey('1808834713'), null);
});

test('revenue uses the Squarespace total and leaves the rest unconfirmed', () => {
  const orders = new Map([['3369', 675]]);
  const summary = summariseChatgptAds({
    sessions: [{ sessions: 4 }],
    purchases: [
      { transaction_id: '03369', ga4_revenue: 875 },
      { transaction_id: '(not set)', ga4_revenue: 1600 }
    ],
    orders,
    excluded: new Set(),
    provider: { clicks: 10, spend_gbp: 40 },
    trials: [{ converted_at: '2026-11-18' }, {}]
  });
  assert.equal(summary.revenue_gbp, 675);
  assert.equal(summary.unconfirmed, 1);
  assert.equal(summary.purchases, 2);
  assert.equal(summary.cost_per_purchase, 20);
  assert.equal(summary.upgrades, 1);
  assert.equal(summary.upgrade_gbp, 79);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { chatgptAdsView } from '../lib/chatgpt-ads-plan-data.js';

test('the card is live, with provider clicks and spend left blank', () => {
  const view = chatgptAdsView();
  assert.equal(view.state, 'LIVE');
  assert.equal(view.since, '18 Nov 18:45');
  assert.equal(view.ends, '2 Dec 13:00');
  assert.equal(view.tracking.includes('OpenAI Pixel live'), true);
  assert.equal(view.tracking.includes('v23'), true);
  assert.equal(view.blockers, undefined);
  assert.equal(view.campaigns.every((row) => row.state === 'LIVE'), true);
  assert.equal(view.figures.visits, 0);
  assert.equal(view.figures.purchases, 0);
  assert.equal(view.figures.clicks, null);
  assert.equal(view.figures.spend_gbp, null);
});

test('supplied visits, purchases and provider figures are shown', () => {
  const view = chatgptAdsView({
    sessions: 4,
    purchases: 1,
    revenue_gbp: 5,
    trials: 1,
    provider_clicks: 12,
    provider_spend: 3.5
  });
  assert.equal(view.figures.visits, 4);
  assert.equal(view.figures.purchases, 1);
  assert.equal(view.figures.revenue_gbp, 5);
  assert.equal(view.figures.trials, 1);
  assert.equal(view.figures.clicks, 12);
  assert.equal(view.figures.spend_gbp, 3.5);
});

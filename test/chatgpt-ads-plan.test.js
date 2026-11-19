import test from 'node:test';
import assert from 'node:assert/strict';
import { chatgptAdsView } from '../lib/chatgpt-ads-plan-data.js';

test('the card is paused and shows the reported provider clicks and spend', () => {
  const view = chatgptAdsView();
  assert.equal(view.state, 'PAUSED');
  assert.equal(view.since, '19 Nov 07:11');
  assert.equal(view.ends, '2 Dec 13:00');
  assert.equal(view.tracking.includes('0 orders'), true);
  assert.equal(view.blockers, undefined);
  assert.equal(view.campaigns.every((row) => row.state === 'PAUSED'), true);
  assert.equal(view.figures.visits, 0);
  assert.equal(view.figures.purchases, 0);
  assert.equal(view.figures.clicks, 201);
  assert.equal(view.figures.spend_gbp, 455);
  assert.equal(view.spend_note.includes('£546 paid'), true);
  assert.equal(view.spend_note.includes('Earlier snapshot'), true);
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

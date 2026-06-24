import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pctChange, driftPct, buildTierFactsMap, findSlugFacts } from '../lib/revenue-truth-live-facts.mjs';

const diagnosis = {
  tier_rollup: [
    {
      tier_key: 'commissions',
      label: 'Commissions',
      pages_at_risk_gbp: 10282.5,
      severity: 'critical',
      revenue_trend: {
        y2024: { non_jlr: 7056.5, total: 7056.5 },
        y2025: { non_jlr: 2680, total: 8680 },
        y2026_ytd: { non_jlr: 2245, total: 2245 }
      },
      product_gsc_trend: { slugs: [{ slug: 'professional-commercial-photographer-coventry', impressions: 9419, clicks: 188, best_avg_position: 12.34 }] }
    }
  ]
};

test('pctChange handles zero + normal denominators', () => {
  assert.equal(pctChange(2245, 2680), -16.2);
  assert.equal(pctChange(100, 0), null);
  assert.equal(pctChange(150, 100), 50);
});

test('driftPct guards zero baseline', () => {
  assert.equal(driftPct(0, 50), null);
  assert.equal(driftPct(100, 240), 140);
});

test('buildTierFactsMap picks non-JLR by default and total when includeJlr', () => {
  const nonJlr = buildTierFactsMap(diagnosis, false).get('commissions');
  assert.equal(nonJlr.y2025, 2680);
  assert.equal(nonJlr.at_risk_gbp, 10282.5);
  assert.equal(nonJlr.yoy_25_26, pctChange(2245, 2680));

  const jlr = buildTierFactsMap(diagnosis, true).get('commissions');
  assert.equal(jlr.y2025, 8680);
  // Non-JLR snapshot is preserved for drift regardless of toggle.
  assert.equal(jlr.y2026_nonjlr, 2245);
});

test('findSlugFacts resolves across role overlays and normalises slug', () => {
  const f = findSlugFacts(diagnosis, '/professional-commercial-photographer-coventry');
  assert.equal(f.impressions, 9419);
  assert.equal(f.position, 12.3);
  assert.equal(findSlugFacts(diagnosis, 'does-not-exist'), null);
});

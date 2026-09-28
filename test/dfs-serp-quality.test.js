import test from 'node:test';
import assert from 'node:assert/strict';
import { isIncompleteSerpCrawl } from '../lib/keyword-ranking/dfs-serp-quality.js';

test('full depth-50 crawl is complete', () => {
  assert.equal(isIncompleteSerpCrawl({
    depth: 50,
    organicCount: 46,
    itemsCount: 65,
    seResultsCount: 193,
    cost: 0.008,
  }), false);
});

test('thin page-1 crawl at depth 50 is incomplete (low organic + base cost)', () => {
  assert.equal(isIncompleteSerpCrawl({
    depth: 50,
    organicCount: 6,
    itemsCount: 9,
    seResultsCount: 6,
    cost: 0.002,
  }), true);
});

test('empty items is incomplete', () => {
  assert.equal(isIncompleteSerpCrawl({ depth: 50, organicCount: 0, itemsCount: 0 }), true);
});

test('shallow depth-10 with ~9 organic is not treated as depth-50 thin', () => {
  assert.equal(isIncompleteSerpCrawl({
    depth: 10,
    organicCount: 9,
    itemsCount: 13,
    seResultsCount: 192,
    cost: 0.002,
  }), false);
});

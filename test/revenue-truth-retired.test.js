import test from 'node:test';
import assert from 'node:assert/strict';
import { effectivelyRetiredTitles } from '../lib/revenue-truth-findings.mjs';

const MENTORING = 'https://www.alanranger.com/photography-services-near-me/monthly-online-photography-mentoring';
const ZOOM = 'https://www.alanranger.com/photography-services-near-me/private-online-photography-classes-zoom';

test('a retired alias row on a live product URL is not retired; a retired row with no live product is', () => {
  const products = [
    { product_title: 'Mentoring - Monthly Subscription', product_url: MENTORING, is_retired: true },
    { product_title: 'Monthly Photography Mentoring Sessions - Online - Zoom', product_url: MENTORING, is_retired: false },
    { product_title: '1-2-1 Package - Zoom Multi-Session', product_url: ZOOM, is_retired: true },
    { product_title: 'Online Photography Classes 121 - Zoom - Package Options', product_url: ZOOM, is_retired: false },
    { product_title: '1-2-1 Single Session - 1hr Zoom', product_url: null, is_retired: true },
    { product_title: 'Old workshop', product_url: 'https://www.alanranger.com/gone', is_retired: true }
  ];
  const retired = effectivelyRetiredTitles(products);
  assert.equal(retired.has('Mentoring - Monthly Subscription'), false);
  assert.equal(retired.has('1-2-1 Package - Zoom Multi-Session'), false);
  assert.equal(retired.has('1-2-1 Single Session - 1hr Zoom'), true);
  assert.equal(retired.has('Old workshop'), true);
});

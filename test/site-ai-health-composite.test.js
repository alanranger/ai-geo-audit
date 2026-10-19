import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSiteAiHealthComposite } from '../lib/audit/siteAiHealthComposite.js';

test('weights Surface 40 + Top 40 + Brand 20', () => {
  const r = computeSiteAiHealthComposite({ surface: 37, top: 39, brand: 60 });
  // 0.4*37 + 0.4*39 + 0.2*60 = 42.4 → 42
  assert.equal(r.score, 42);
  assert.equal(r.rag, 'amber');
});

test('redistributes when Brand missing', () => {
  const r = computeSiteAiHealthComposite({ surface: 50, top: 50, brand: null });
  assert.equal(r.score, 50);
});

test('null when nothing available', () => {
  const r = computeSiteAiHealthComposite({});
  assert.equal(r.score, null);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInspectionRowByUrlMap,
  pickInspectionRowForUrl,
  resolveInspectionHitForBatchSlot,
} from '../api/aigeo/lib/gscInspectBatchMerge.js';

const prop = 'https://www.alanranger.com/';

test('batch merge: uses positional row only when inspectionUrl matches uReq', () => {
  const rows = [
    { inspectionUrl: 'https://www.alanranger.com/a', coverageState: 'A', verdict: 'PASS' },
    { inspectionUrl: 'https://www.alanranger.com/b', coverageState: 'B', verdict: 'PASS' },
  ];
  const byUrl = buildInspectionRowByUrlMap(rows);
  const hit0 = resolveInspectionHitForBatchSlot(rows, byUrl, 0, 'https://www.alanranger.com/a', prop);
  assert.equal(hit0?.coverageState, 'A');
  const hit1 = resolveInspectionHitForBatchSlot(rows, byUrl, 1, 'https://www.alanranger.com/b', prop);
  assert.equal(hit1?.coverageState, 'B');
});

test('batch merge: wrong row at slot still resolves correct hit via pick (regression)', () => {
  const rows = [
    { inspectionUrl: 'https://www.alanranger.com/b', coverageState: 'B', verdict: 'PASS' },
    { inspectionUrl: 'https://www.alanranger.com/a', coverageState: 'A', verdict: 'PASS' },
  ];
  const byUrl = buildInspectionRowByUrlMap(rows);
  const hitAt0 = resolveInspectionHitForBatchSlot(rows, byUrl, 0, 'https://www.alanranger.com/a', prop);
  assert.equal(hitAt0?.coverageState, 'A');
  const hitAt1 = resolveInspectionHitForBatchSlot(rows, byUrl, 1, 'https://www.alanranger.com/b', prop);
  assert.equal(hitAt1?.coverageState, 'B');
});

test('batch merge: comparable host match (www) finds row', () => {
  const rows = [
    {
      inspectionUrl: 'https://www.alanranger.com/path',
      coverageState: 'Submitted and indexed',
      verdict: 'PASS',
    },
  ];
  const byUrl = buildInspectionRowByUrlMap(rows);
  const hit = pickInspectionRowForUrl(
    rows,
    byUrl,
    'https://alanranger.com/path',
    'https://www.alanranger.com/'
  );
  assert.equal(hit?.coverageState, 'Submitted and indexed');
});

test('batch merge: first-wins map does not let duplicate inspectionUrl overwrite', () => {
  const rows = [
    { inspectionUrl: 'https://www.alanranger.com/x', coverageState: 'first', verdict: 'PASS' },
    { inspectionUrl: 'https://www.alanranger.com/x', coverageState: 'second', verdict: 'FAIL' },
  ];
  const byUrl = buildInspectionRowByUrlMap(rows);
  assert.equal(byUrl.get('https://www.alanranger.com/x')?.coverageState, 'first');
});

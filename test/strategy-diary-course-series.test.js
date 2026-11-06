import { test } from 'node:test';
import assert from 'node:assert/strict';
import { courseSeries } from '../lib/strategy-diary.mjs';

const feed = [
  { date: '2026-11-19', title: 'Lightroom Classic Photo Editing Classes - Week 2 of 3 -19-11', url: '/lr-wk2' },
  { date: '2026-11-09', title: 'Camera Courses For Beginners - Week 1 of 3 - Coventry 9-11', url: '/beg-wk1' },
  { date: '2026-11-12', title: 'Lightroom Classic Photo Editing Classes - Week 1 of 3 -12-11', url: '/lr-wk1' },
  { date: '2026-11-16', title: 'Camera Courses For Beginners - Week 2 of 3 - Coventry 16-11', url: '/beg-wk2' },
  { date: '2026-11-26', title: 'Lightroom Classic Photo Editing Classes - Week 3 of 3 -26-11', url: '/lr-wk3' },
  { date: '2027-01-12', title: 'Lightroom Classic Photo Editing Classes -Week 1 of 3 -12-1', url: '/lr-jan' }
];

test('every multi-week course shows once, on its Week 1 date; weeks 2 and 3 never make a row', () => {
  const rows = courseSeries(feed);
  assert.deepEqual(rows.map((r) => [r.date, r.url]), [
    ['2026-11-09', '/beg-wk1'],
    ['2026-11-12', '/lr-wk1'],
    ['2027-01-12', '/lr-jan']
  ]);
});

test('beginners keep their "3-week beginners" title; other series read "3-week course"', () => {
  const [beg, lr] = courseSeries(feed);
  assert.equal(beg.title, 'Camera Courses For Beginners - 3-week beginners - Coventry 9-11');
  assert.equal(lr.title, 'Lightroom Classic Photo Editing Classes - 3-week course');
});

test('a Week 2 listed before its Week 1 still makes no row of its own', () => {
  assert.equal(courseSeries([feed[0]]).length, 0);
});

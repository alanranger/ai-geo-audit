import test from 'node:test';
import assert from 'node:assert/strict';
import { inferTrackingMeta } from '../lib/keyword-ranking/locked-config-merge.js';
import { checkTrackedKeywordNotInRanking, checkOrphanKeepOrDrop, normKw } from '../lib/configIntegrity/checks.mjs';
import { nextOrphans, trackedOverrideRows } from '../lib/keyword-ranking/sync-tracked-page-keywords.mjs';

test('inferTrackingMeta: coventry and near me are local', () => {
  assert.equal(inferTrackingMeta('lightroom course coventry').keyword_class, 'local-money');
  assert.equal(inferTrackingMeta('lightroom course near me').tracking_location, 'Local');
  assert.equal(inferTrackingMeta('photography gift voucher').keyword_class, 'national-money');
});

test('check 7 is zero when tracked keywords are in LOCKED', () => {
  const locked = new Map([[normKw('rps courses'), { keyword: 'rps courses' }]]);
  const findings = checkTrackedKeywordNotInRanking(
    [{ target_class: 'tracked', target_keyword: 'rps courses', page_url: 'https://www.alanranger.com/rps-courses-mentoring-distinctions' }],
    locked
  );
  assert.equal(findings.length, 0);
});

test('check 7 names a missing money-page keyword', () => {
  const findings = checkTrackedKeywordNotInRanking(
    [{ target_class: 'tracked', target_keyword: 'lightroom course coventry', page_url: 'https://www.alanranger.com/photo-editing-course-coventry' }],
    new Map()
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0].detail, /not tracked in Ranking & AI/);
});

test('longtail overrides are not auto-added', () => {
  const rows = trackedOverrideRows([
    { target_class: 'longtail_by_design', target_keyword: 'how to shoot sunsets', page_url: 'https://www.alanranger.com/blog' },
    { target_class: 'tracked', target_keyword: 'rps courses', page_url: 'https://www.alanranger.com/rps-courses-mentoring-distinctions' }
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].keyword, 'rps courses');
});

test('changing a tracked keyword creates a pending keep/drop orphan', () => {
  const previousByPage = new Map([
    ['/photo-editing-course-coventry', {
      target_class: 'tracked',
      target_keyword: 'lightroom course coventry',
      page_url: 'https://www.alanranger.com/photo-editing-course-coventry'
    }]
  ]);
  const orphans = nextOrphans({
    previousByPage,
    nextOverrides: [{
      target_class: 'tracked',
      target_keyword: 'lightroom course coventry TEST',
      page_url: 'https://www.alanranger.com/photo-editing-course-coventry'
    }],
    existingOrphans: []
  });
  assert.equal(orphans.length, 1);
  assert.equal(orphans[0].status, 'pending');
  const findings = checkOrphanKeepOrDrop(orphans);
  assert.equal(findings.length, 1);
  assert.match(findings[0].detail, /keep tracking or drop/i);
});

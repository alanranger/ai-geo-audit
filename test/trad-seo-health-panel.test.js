import test from 'node:test';
import assert from 'node:assert/strict';
import { groupHealthRows, urlsOfFinding } from '../lib/fault-monitor/health-panel.js';

test('groups missing page_entities into one auto-clear line with URLs', () => {
  const findings = [
    { check: 'D5', status: 'fault', severity: 'red', title: 'No page_entities row (blog)', url: 'https://www.alanranger.com/blog-on-photography/a' },
    { check: 'D5', status: 'fault', severity: 'red', title: 'No page_entities row (course_products)', url: 'https://www.alanranger.com/photography-services-near-me/print' },
    { check: 'D5', status: 'pass', title: 'ok' }
  ];
  const rows = groupHealthRows(findings);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].auto_clears, true);
  assert.equal(rows[0].fix, '');
  assert.match(rows[0].title, /2 pages in your CSV lists no longer exist/);
  assert.equal(rows[0].urls.length, 2);
});

test('D4 names the Export 09 keywords button', () => {
  const rows = groupHealthRows([{
    check: 'D4', status: 'fault', severity: 'amber',
    title: 'Repo copy of config/09-url-target-keywords.csv is out of sync'
  }]);
  assert.equal(rows.length, 1);
  assert.match(rows[0].fix, /Export 09 keywords/);
  assert.match(rows[0].fix, /node scripts\/export-09-url-target-keywords\.mjs/);
});

test('urlsOfFinding pulls missing/extra and failed ingest URLs', () => {
  const urls = urlsOfFinding({
    check: 'D5',
    detail: {
      missing: ['https://www.alanranger.com/a'],
      extra: ['https://www.alanranger.com/b'],
      failed: [{ url: 'https://www.alanranger.com/c' }]
    }
  });
  assert.equal(urls.length, 3);
});

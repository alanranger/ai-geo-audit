import test from 'node:test';
import assert from 'node:assert/strict';
import { entityFinding, verifiedByUrl } from '../lib/fault-monitor/sync-check.js';
import { urlKey } from '../lib/fault-monitor/prefetch.js';

const DAY = 86400000;
const latest = Date.parse('2026-11-17T12:34:25.459Z');
const old = latest - 14 * DAY;

test('a page checked and left unchanged is not a stale page record', () => {
  const { map, newest } = verifiedByUrl(
    [{ page_url: 'https://www.alanranger.com/a', last_seen: new Date(old).toISOString() }],
    [{ url: 'https://www.alanranger.com/a', checked_at: new Date(latest).toISOString() }]
  );
  const row = entityFinding('a', 'https://www.alanranger.com/a', 'blog', map.get(urlKey('https://www.alanranger.com/a')), newest);
  assert.equal(row.status, 'pass');
});

test('a page the latest check did not evaluate is still flagged', () => {
  const { map, newest } = verifiedByUrl(
    [
      { page_url: 'https://www.alanranger.com/missed', last_seen: new Date(old).toISOString() },
      { page_url: 'https://www.alanranger.com/seen', last_seen: new Date(latest).toISOString() }
    ],
    [{ url: 'https://www.alanranger.com/seen', checked_at: new Date(latest).toISOString() }]
  );
  const row = entityFinding('m', 'https://www.alanranger.com/missed', 'blog', map.get(urlKey('https://www.alanranger.com/missed')), newest);
  assert.equal(row.status, 'fault');
  assert.match(row.title, /page_entities row not refreshed/);
});

test('a missing page record stays the 404 fault', () => {
  const row = entityFinding('x', 'https://www.alanranger.com/gone', 'blog', null, latest);
  assert.equal(row.severity, 'red');
  assert.match(row.title, /No page_entities row/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapDfsItemToDomainRow } from '../lib/dfs-domain-backlink-ingest.js';

test('mapDfsItemToDomainRow parses DataForSEO first_seen and last_seen', () => {
  const row = mapDfsItemToDomainRow('alanranger.com', 'run-id', {
    url_from: 'https://example.com/page',
    url_to: 'https://alanranger.com/',
    anchor: 'Example',
    first_seen: '2024-09-18 19:43:38 +00:00',
    last_seen: '2026-05-13 23:31:57 +00:00',
    dofollow: true
  });
  assert.equal(row.first_seen, '2024-09-18T19:43:38.000Z');
  assert.equal(row.last_seen, '2026-05-13T23:31:57.000Z');
});

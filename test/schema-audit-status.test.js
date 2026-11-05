import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestSchemaAudit, schemaAuditStatusFrom } from '../lib/schema-audit-status.js';

const today = { created_at: '2026-11-05T08:42:44Z', updated_at: '2026-11-05T15:01:14Z', schema_total_pages: 440,
  schema_foundation: { urlList: { source: '06', count: 440, notice: 'Using 06 (440 URLs)' } } };
const yesterday = { created_at: '2026-11-04T23:20:07Z', updated_at: '2026-11-04T23:20:11Z', schema_total_pages: 480 };

test('a same-day re-run is the newest audit: its update time and its page count, not the first run of the day', () => {
  const s = schemaAuditStatusFrom(latestSchemaAudit([yesterday, today]));
  assert.equal(s.last_synced_at, '2026-11-05T15:01:14Z');
  assert.equal(s.schema_total_pages, 440);
  assert.equal(s.url_list.notice, 'Using 06 (440 URLs)');
});

test('database stamps without a zone are given as UTC', () => {
  const s = schemaAuditStatusFrom(latestSchemaAudit([{ ...today, updated_at: '2026-11-05 15:01:14.652' }]));
  assert.equal(s.last_synced_at, '2026-11-05T15:01:14.652Z');
});

test('rows without schema pages are ignored; nothing saved gives an empty status', () => {
  assert.equal(latestSchemaAudit([{ updated_at: '2026-11-06T00:00:00Z', schema_total_pages: 0 }, yesterday]), yesterday);
  assert.deepEqual(schemaAuditStatusFrom(latestSchemaAudit([])), { source: 'schema_audit', last_synced_at: null, schema_total_pages: null, url_list: null, row_count: 0 });
});

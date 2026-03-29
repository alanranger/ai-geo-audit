import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSupabaseServiceRoleKey } from '../api/aigeo/lib/normalizeSupabaseServiceRoleKey.js';

const hdr = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
const pay = 'eyJpc3MiOiJ0ZXN0In0';
const sig43 = 'A'.repeat(43);
const sig46 = `${sig43}xyz`;

test('normalizeSupabaseServiceRoleKey: leaves valid 43-char sig unchanged', () => {
  const k = `${hdr}.${pay}.${sig43}`;
  assert.equal(normalizeSupabaseServiceRoleKey(k), k);
});

test('normalizeSupabaseServiceRoleKey: trims long signature to 43 chars', () => {
  const k = `${hdr}.${pay}.${sig46}`;
  assert.equal(normalizeSupabaseServiceRoleKey(k), `${hdr}.${pay}.${sig43}`);
});

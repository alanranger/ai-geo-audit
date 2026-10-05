import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('ceo-weekly-full-refresh.js parses (no */ inside block comments)', () => {
  const file = join(root, 'api/cron/ceo-weekly-full-refresh.js');
  const src = readFileSync(file, 'utf8');
  assert.equal(/\*\/\d/.test(src), false, 'block comment must not contain */N cron globs');
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

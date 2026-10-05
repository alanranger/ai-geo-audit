import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('ceo-weekly academy module parses', () => {
  const file = join(root, 'lib/ceo-weekly/academy.js');
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

test('email includes Academy section markers', () => {
  const src = readFileSync(join(root, 'lib/ceo-weekly/email.js'), 'utf8');
  assert.match(src, /function renderAcademySection/);
  assert.match(src, /D · The Academy|D \\u00b7 The Academy|The Academy/);
  assert.match(src, /renderAcademySection\(metrics\)/);
});

test('full catalog includes academy_refresh before email', () => {
  const src = readFileSync(join(root, 'lib/ceo-weekly/dashboard-full-catalog.js'), 'utf8');
  const academyIdx = src.indexOf("key: 'academy_refresh'");
  const emailIdx = src.indexOf("key: 'ceo_weekly_email'");
  assert.ok(academyIdx > 0);
  assert.ok(emailIdx > academyIdx);
});

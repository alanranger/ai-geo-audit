import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = join(import.meta.dirname, '..');
const SKIP = new Set(['node_modules', 'outputs', '.git']);

function files(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, out);
    else if (/\.(js|mjs)$/.test(name)) out.push(path);
  }
  return out;
}

function hits(needle) {
  return files(ROOT)
    .filter((path) => !path.endsWith('organic-serp-single-path.test.js'))
    .filter((path) => readFileSync(path, 'utf8').includes(needle))
    .map((path) => relative(ROOT, path).replaceAll('\\', '/'))
    .sort();
}

test('google organic requests are built in one file', () => {
  assert.deepEqual(hits('serp/google/organic/live/advanced'), ['lib/keyword-ranking/organic-serp.js']);
});

test('google AI mode requests are built in one file', () => {
  assert.deepEqual(hits('serp/google/ai_mode/live/advanced'), ['lib/keyword-ranking/organic-serp.js']);
});

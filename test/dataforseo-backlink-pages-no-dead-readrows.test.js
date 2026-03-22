import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcPath = join(__dirname, '../api/aigeo/dataforseo-backlink-pages.js');

test('dataforseo-backlink-pages: no stale readRows() calls (use readRowsForUrls)', () => {
  const src = readFileSync(srcPath, 'utf8');
  assert.match(src, /readRowsForUrls/, 'expected readRowsForUrls helper');
  assert.doesNotMatch(
    src,
    /\breadRows\s*\(/,
    'removed readRows() must not be referenced — causes ReferenceError at runtime'
  );
});

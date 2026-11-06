import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectAllPaged } from '../lib/supabase-paged.js';

const ROWS = Array.from({ length: 2500 }, (_, i) => ({ id: i + 1, day: `2026-10-${String((i % 7) + 1).padStart(2, '0')}` }));

/** Ties in the sort columns come back in a different order on every request, as Postgres may do between pages. */
function fakeSupabase() {
  let calls = 0;
  return {
    from() {
      const order = [];
      const chain = {
        select: () => chain,
        order: (col, { ascending = true } = {}) => {
          order.push([col, ascending ? 1 : -1]);
          return chain;
        },
        range: (from, to) => {
          calls += 1;
          const salt = calls;
          const tie = (r) => (r.id * 2654435761 + salt * 40503) % 1000003;
          const sorted = [...ROWS].sort((a, b) => {
            for (const [col, dir] of order) {
              if (a[col] !== b[col]) return a[col] < b[col] ? -dir : dir;
            }
            return tie(a) - tie(b);
          });
          return Promise.resolve({ data: sorted.slice(from, to + 1), error: null });
        }
      };
      return chain;
    }
  };
}

const distinct = (rows) => new Set(rows.map((r) => r.id)).size;

test('a non-unique sort alone repeats some rows and drops others across pages', async () => {
  const sb = fakeSupabase();
  const rows = await selectAllPaged(() => sb.from('t').select('*'), ['day']);
  assert.equal(rows.length, 2500);
  assert.ok(distinct(rows) < 2500, 'ties without a unique tie-breaker must lose rows in this simulation');
});

test('with a unique tie-breaker every row comes back exactly once (count(*) = distinct rows)', async () => {
  const sb = fakeSupabase();
  const rows = await selectAllPaged(() => sb.from('t').select('*'), ['-day', 'id']);
  assert.equal(rows.length, ROWS.length);
  assert.equal(distinct(rows), ROWS.length);
});

test('a paged read without an order is refused', async () => {
  await assert.rejects(() => selectAllPaged(() => fakeSupabase().from('t').select('*'), []), /unique order/);
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH = /(^|\/)(_|tmp|\.tmp)|smoke-test/;

function sourceFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.(m|c)?js$/.test(e.name) && !SCRATCH.test(rel)) out.push(rel);
  }
  return out;
}

test('every paged Supabase read has an explicit order (use lib/supabase-paged.js)', () => {
  const offenders = [];
  for (const rel of ['api', 'lib', 'scripts'].flatMap(sourceFiles)) {
    if (rel === 'lib/supabase-paged.js') continue;
    const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
    lines.forEach((line, i) => {
      const paged = /\.range\((?!\s*0\s*,)/.test(line) || /[?&]offset=/.test(line);
      if (!paged) return;
      const window = lines.slice(Math.max(0, i - 40), i + 1).join('\n');
      if (!/\.order\(|orderedQuery\(|order=/.test(window)) offenders.push(`${rel}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});

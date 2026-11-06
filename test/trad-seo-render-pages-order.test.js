import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRunPages } from '../lib/trad-seo-render/pages-store.js';

const ROWS = Array.from({ length: 436 }, (_, i) => ({ run_id: 'r1', url_key: `k${String(i).padStart(3, '0')}` }));

/** Unordered reads come back in a different order on each request, as Postgres may do between range pages. */
function fakeSupabase() {
  let calls = 0;
  return {
    from() {
      const q = { ordered: false };
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: (col) => {
          q.ordered = col === 'url_key';
          return chain;
        },
        range: (from, to) => {
          calls += 1;
          const rows = q.ordered ? ROWS : [...ROWS].sort(() => (calls % 2 ? 1 : -1)).reverse();
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
        }
      };
      return chain;
    }
  };
}

test('every page of a 436-page render run loads exactly once', async () => {
  const pages = await loadRunPages(fakeSupabase(), 'r1');
  const keys = new Set(pages.map((p) => p.url_key));
  assert.equal(pages.length, 436);
  assert.equal(keys.size, 436);
});

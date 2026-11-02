/**
 * Monday Full refresh ① steps (2 Nov 2026 stall). Regression tests for:
 *  - the ① step must START the full run (it only ever ticked, so no ① ran) and then tick that run id to completion;
 *  - a broken-links tick with nothing left must report done: true (tickBrokenLinks' `done` count overwrote it).
 * fetch is stubbed: no network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runTradSeoRenderTick, runTradSeoBrokenTick } from '../lib/ceo-weekly/dashboard-full-catalog.js';
import { brokenTickReply } from '../lib/trad-seo-render/broken-job.js';

function stubFetch(replies) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body || '{}') });
    const reply = replies.shift();
    return { ok: true, status: 200, text: async () => JSON.stringify(reply) };
  };
  return calls;
}

test('Monday ① step: first call starts the full run, later calls tick that run id until done', async () => {
  const calls = stubFetch([
    { ok: true, run_id: 'run-new', resumed: false, status: 'running' },
    { ok: true, run_id: 'run-new', done: false, summary: { pages_checked: 50 } },
    { ok: true, run_id: 'run-new', done: true, summary: { pages_checked: 443 } }
  ]);
  const first = await runTradSeoRenderTick('https://x', {}, {});
  assert.equal(calls[0].body.action, 'start');
  assert.equal(calls[0].body.source, 'trad_seo', 'a full ① source, so a running full ① is joined, never doubled');
  assert.equal(first.done, false, 'starting is not finishing');
  assert.deepEqual(first.trad_seo_render, { runId: 'run-new' });
  const mid = await runTradSeoRenderTick('https://x', {}, { trad_seo_render: first.trad_seo_render });
  assert.equal(calls[1].body.action, 'tick');
  assert.equal(calls[1].body.runId, 'run-new');
  assert.equal(mid.done, false);
  const last = await runTradSeoRenderTick('https://x', {}, { trad_seo_render: mid.trad_seo_render });
  assert.equal(last.done, true);
  assert.equal(last.body.run_id, 'run-new');
});

test('Monday ① step: a ① already running is joined (start answers resumed), not started twice', async () => {
  const calls = stubFetch([{ ok: true, run_id: 'run-running', resumed: true, status: 'running' }]);
  const r = await runTradSeoRenderTick('https://x', {}, {});
  assert.equal(calls.length, 1);
  assert.equal(r.body.resumed, true);
  assert.deepEqual(r.trad_seo_render, { runId: 'run-running' });
});

test('broken-links reply: done is the boolean remaining <= 0, the per-tick count is "checked"', () => {
  assert.deepEqual(brokenTickReply('r1', { done: 0, total: 0, remaining: 0 }), { ok: true, run_id: 'r1', checked: 0, total: 0, remaining: 0, done: true });
  assert.equal(brokenTickReply('r1', { done: 5, total: 8, remaining: 3 }).done, false);
  assert.equal(brokenTickReply('r1', { done: 3, total: 3, remaining: 0 }).done, true);
});

test('Monday broken-links step finishes when the reply says nothing is left (the 2 Nov stall)', async () => {
  stubFetch([brokenTickReply('b6d7d1b1', { done: 0, total: 0, remaining: 0 })]);
  const r = await runTradSeoBrokenTick('https://x', {}, { trad_seo_render_done_id: 'b6d7d1b1' });
  assert.equal(r.done, true);
  assert.equal(r.trad_seo_broken, null);
});

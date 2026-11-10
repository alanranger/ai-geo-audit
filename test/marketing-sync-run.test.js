/**
 * Sync customers / Collect email results (questions 2026-11-10 customer-sync-no-result-modal + marketing-sync-button-at-top):
 * the shared progress / result window. The old Sync now removed its window on success (no result shown); now every run
 * ends in a ✅ / ❌ result window with one line per step, the duration and OK, then the tab reloads.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(new URL('../lib/marketing-sync-run.js', import.meta.url), 'utf8');
const TAB = fs.readFileSync(new URL('../lib/marketing-tab.js', import.meta.url), 'utf8');

/** A tiny DOM: elements by id, every modal paint recorded. */
function fakeDom() {
  const byId = new Map();
  const paints = [];
  const listeners = [];
  const el = (tag) => {
    const e = { tag, id: '', _html: '', textContent: '', remove() { byId.delete(e.id); } };
    Object.defineProperty(e, 'innerHTML', { get: () => e._html, set: (v) => { e._html = v; if (e.id === 'mk-run-modal') paints.push(v); } });
    return e;
  };
  const document = {
    head: { appendChild: (e) => byId.set(e.id, e) },
    body: { appendChild: (e) => byId.set(e.id, e) },
    createElement: el,
    getElementById: (id) => byId.get(id) || null,
    addEventListener: (type, fn) => listeners.push([type, fn])
  };
  return { document, byId, paints, listeners, el };
}

function load({ fetchFn, render } = {}) {
  const dom = fakeDom();
  const head = dom.el('div');
  head.id = 'mk-head-actions';
  dom.byId.set(head.id, head);
  const window = { getAdminKey: () => 'k', renderMarketingTab: () => render?.(window) };
  const ctx = { window, document: dom.document, fetch: fetchFn, setTimeout, clearTimeout, setInterval, clearInterval, Date, Promise, JSON, Math, Number, String, Object, Array, Map, Set };
  vm.runInNewContext(SRC, ctx);
  window.mkSyncRun.config.pollMs = 1;
  return { window, dom, head };
}
const reply = (j) => ({ ok: true, json: async () => ({ ok: true, ...j }) });

test('progress: real % from the steps done, "step x of n", alive until 45 s without a reply, then stalled', () => {
  const { window } = load();
  const { progressView } = window.mkSyncRun.model;
  const labels = ['A', 'B', 'C', 'D'];
  const v1 = progressView({ labels, i: 0, frac: 0, t0: 0, beatAt: 0, now: 5000 });
  assert.equal(v1.pct, 0);
  assert.match(v1.text, /^0% · step 1 of 4: A · 5 s$/);
  assert.equal(v1.alive, 'alive');
  const v3 = progressView({ labels, i: 2, frac: 0.5, t0: 0, beatAt: 0, now: 50000 });
  assert.equal(v3.pct, 63);
  assert.match(v3.text, /step 3 of 4: C .* about 50 s left/);
  assert.equal(v3.stalled, true);
  assert.equal(v3.alive, 'stalled — no reply for 50 s');
  assert.equal(progressView({ labels, i: 3, frac: 1, t0: 0, beatAt: 0, now: 1000 }).pct, 99, 'never 100% before the result');
  assert.doesNotMatch(progressView({ labels, i: 1, t0: 0, beatAt: 0, now: 1000, note: 'waiting for Alan\'s PC' }).text, /left/, 'no step-average ETA while waiting on the PC (the step states its own timing)');
});

test('result: ✅ Success only when every step ran OK; ❌ names the failed step; one line per step and the duration', () => {
  const { window } = load();
  const { resultView } = window.mkSyncRun.model;
  const ok = resultView({ lines: [{ label: 'A', ok: true, text: '1' }, { label: 'B', ok: true, text: '2' }], total: 2, t0: 0, now: 65000 });
  assert.equal(ok.head, '✅ Success');
  assert.deepEqual(ok.lines, ['✓ A: 1', '✓ B: 2']);
  assert.equal(ok.took, 'Took 1 min 5 s');
  const bad = resultView({ lines: [{ label: 'A', ok: true, text: '1' }, { label: 'B', ok: false, text: 'boom' }], total: 3, t0: 0, now: 3000 });
  assert.equal(bad.ok, false);
  assert.equal(bad.head, '❌ Failed at step 2 of 3: B');
  assert.deepEqual(bad.lines, ['✓ A: 1', '✗ B: boom']);
});

test('per-step summaries, "Last run" and the collector summary', () => {
  const { syncLine, collectLine, lastRunText, runOf } = load().window.mkSyncRun.model;
  assert.equal(syncLine('profiles', { profiles: 2552, subscribed: 688 }), '2,552 contacts, 688 subscribed');
  assert.equal(syncLine('orders', { orders: 3, mode: 'incremental' }), '3 orders read (incremental)');
  assert.equal(syncLine('postcodes', { looked_up: 2, known_postcodes: 1900, remaining: 0 }), '2 looked up · 1,900 known');
  assert.equal(syncLine('customers', { persons: 3002 }), '3,002 people');
  assert.equal(collectLine({ status: 'ok', summary: { campaigns_listed: 166, summaries_refreshed: 12, event_campaigns_done: 3, event_campaigns_target: 3, events: 410 } }), '166 sent campaigns listed · 12 reports refreshed · 3 of 3 recipient lists read (410 events)');
  assert.equal(collectLine({ status: 'stale', error: 'sign in again' }), 'STALE: sign in again');
  assert.equal(lastRunText(null), 'Last run: never');
  assert.match(lastRunText({ status: 'ok', finished_at: '2026-11-10T16:12:55Z' }), /^Last run 10 Nov(,| at) 16:12$/);
  assert.match(lastRunText({ status: 'failed', finished_at: '2026-11-10T16:12:55Z' }), / · FAILED$/);
  const runs = { 'sync:profiles': { kind: 'sync:profiles' }, collector: { kind: 'collector' } };
  assert.equal(runOf(runs, 'sync').kind, 'sync:profiles');
  assert.equal(runOf(runs, 'collect').kind, 'collector');
});

test('collect queue: only this click\'s row counts; phases waiting → reading → done, failed attempt = retry', () => {
  const { queueRow, queuePhase, COLLECT_KEY } = load().window.mkSyncRun.model;
  const due = '2026-11-10T16:40:00.000Z';
  const rows = [{ campaign_key: 'status|refresh', slot: 'manual', due_at: due, status: 'queued' }, { campaign_key: COLLECT_KEY, slot: 'manual', due_at: '2026-11-09T10:00:00Z', status: 'done' }];
  assert.equal(queueRow(rows, due), null, 'an older run of the same row is not this one');
  rows[1].due_at = due;
  assert.equal(queueRow(rows, due), rows[1]);
  assert.equal(queuePhase(null), 'waiting');
  assert.equal(queuePhase({ status: 'queued', attempts: 0 }), 'waiting');
  assert.equal(queuePhase({ status: 'running' }), 'reading');
  assert.equal(queuePhase({ status: 'done' }), 'done');
  assert.equal(queuePhase({ status: 'queued', attempts: 1 }), 'retry');
});

test('Sync customers: the same 4 POST sync steps, progress shows every step, then the result window stays until OK and the tab reloads', async () => {
  const calls = [];
  const OUT = { profiles: { profiles: 2552, subscribed: 688 }, orders: { orders: 4, mode: 'incremental' }, postcodes: { looked_up: 1, known_postcodes: 1900, remaining: 0 }, customers: { persons: 3002 } };
  const fetchFn = async (url, opt) => { const b = JSON.parse(opt.body); calls.push(b); await new Promise((ok) => setTimeout(ok, 5)); return reply({ step: b.step, ...OUT[b.step] }); };
  let renders = 0;
  const { window, dom } = load({ fetchFn, render: (w) => { renders += 1; setTimeout(() => w.mkSyncRunPaint({ runs: { 'sync:profiles': { status: 'ok', finished_at: new Date().toISOString() } } }), 5); } });
  const r = await window.mkSyncRun.customers();
  assert.deepEqual(calls.map((c) => `${c.action}:${c.step}`), ['sync:profiles', 'sync:orders', 'sync:postcodes', 'sync:customers']);
  for (const s of [1, 2, 3, 4]) assert.ok(dom.paints.some((p) => p.includes(`data-mksr-step="${s}" data-mksr-total="4"`)), `progress reached step ${s} of 4`);
  assert.ok(dom.paints.some((p) => /25% · step 2 of 4/.test(p)) && dom.paints.some((p) => /75% · step 4 of 4/.test(p)), 'real % between steps');
  const last = dom.byId.get('mk-run-modal').innerHTML;
  assert.match(last, /data-mksr-result="ok"/);
  assert.match(last, /Sync customers: ✅ Success/);
  assert.match(last, /✓ Squarespace profiles \(consent\): 2,552 contacts, 688 subscribed/);
  assert.match(last, /✓ Squarespace orders: 4 orders read/);
  assert.match(last, /✓ Postcode lookup: 1 looked up/);
  assert.match(last, /✓ Rebuild customer view: 3,002 people/);
  assert.match(last, /Took \d+ s/);
  assert.match(last, /data-mksr-reload="done"/);
  assert.match(last, /data-mksr-ok>OK</);
  assert.equal(renders, 1, 'the tab (tiles) reloaded once');
  assert.equal(r.ok, true);
  assert.match(dom.byId.get('mk-head-actions').innerHTML, /data-mksr-last="sync">Last run 10 Nov|data-mksr-last="sync">Last run \d/);
});

test('Sync customers: a failing step stops the run and the result names it', async () => {
  const fetchFn = async (url, opt) => { const b = JSON.parse(opt.body); return b.step === 'orders' ? { ok: false, json: async () => ({ ok: false, error: 'Squarespace 503' }) } : reply({ profiles: 1, subscribed: 1 }); };
  const { window, dom } = load({ fetchFn, render: (w) => w.mkSyncRunPaint({ runs: {} }) });
  const r = await window.mkSyncRun.customers();
  assert.equal(r.ok, false);
  const last = dom.byId.get('mk-run-modal').innerHTML;
  assert.match(last, /❌ Failed at step 2 of 4: Squarespace orders/);
  assert.match(last, /✗ Squarespace orders: Squarespace 503/);
  assert.doesNotMatch(last, /Postcode lookup/);
});

test('Collect email results: queues the existing collect-request, follows the queue row to done, reads the collector summary after the reload', async () => {
  const seen = [];
  let polls = 0;
  let due = null;
  const KEY = 'dashboard|collect-email-results';
  const fetchFn = async (url, opt) => {
    if (opt.method === 'POST') { const b = JSON.parse(opt.body); seen.push(b); due = new Date().toISOString(); return reply({ queued: 1, due_now: due }); }
    seen.push(url);
    polls += 1;
    const status = polls < 3 ? 'queued' : (polls < 5 ? 'running' : 'done');
    return reply({ requests: [{ campaign_key: KEY, slot: 'manual', due_at: due, status, attempts: status === 'queued' ? 0 : 1 }] });
  };
  const summary = { campaigns_listed: 166, summaries_refreshed: 12, event_campaigns_done: 2, event_campaigns_target: 2, events: 300 };
  const { window, dom } = load({ fetchFn, render: (w) => w.mkSyncRunPaint({ runs: { collector: { status: 'ok', started_at: new Date().toISOString(), finished_at: new Date().toISOString(), summary } } }) });
  const r = await window.mkSyncRun.collectEmails();
  assert.deepEqual(seen[0], { action: 'collect-request', campaign_key: KEY }, 'the existing queue action, no new route');
  assert.ok(seen.slice(1).every((u) => u === '/api/aigeo/marketing?action=collect-queue'), 'only the read-only queue list is polled (never collect-next)');
  for (const s of [1, 2, 3]) assert.ok(dom.paints.some((p) => p.includes(`data-mksr-step="${s}" data-mksr-total="3"`)), `step ${s} of 3 shown`);
  const last = dom.byId.get('mk-run-modal').innerHTML;
  assert.equal(r.ok, true);
  assert.match(last, /Collect email results: ✅ Success/);
  assert.match(last, /✓ Queue the read for Alan&#39;s PC|✓ Queue the read for Alan's PC/);
  assert.match(last, /✓ Alan's PC starts the email-report collector: picked up after/);
  assert.match(last, /✓ Read Squarespace email reports: read in \d+ s · 166 sent campaigns listed · 12 reports refreshed · 2 of 2 recipient lists read \(300 events\)/);
});

test('Collect email results: a failed collector attempt is reported, not shown as success', async () => {
  let due = null;
  const fetchFn = async (url, opt) => {
    if (opt.method === 'POST') { due = new Date().toISOString(); return reply({ due_now: due }); }
    return reply({ requests: [{ campaign_key: 'dashboard|collect-email-results', slot: 'manual', due_at: due, status: 'queued', attempts: 1, error: 'collector exited with code 1' }] });
  };
  const { window, dom } = load({ fetchFn, render: (w) => w.mkSyncRunPaint({ runs: {} }) });
  const r = await window.mkSyncRun.collectEmails();
  assert.equal(r.ok, false);
  assert.match(dom.byId.get('mk-run-modal').innerHTML, /❌ Failed at step 2 of 3: Alan's PC starts the email-report collector/);
  assert.match(dom.byId.get('mk-run-modal').innerHTML, /retries in 10 minutes/);
});

test('header: two buttons side by side, same class, exact hover tips, "Last run" under each; the original Sync now has the tip and calls the same run', () => {
  const { window } = load();
  const html = window.mkSyncRunHead();
  const btns = [...html.matchAll(/<button type="button" class="([^"]+)" data-mksr="(\w+)" title="([^"]+)"/g)];
  assert.deepEqual(btns.map((b) => b[2]), ['sync', 'collect']);
  assert.ok(btns.every((b) => b[1] === 'rf-btn'), 'same style as each other and as Sync now');
  assert.match(html, />Sync customers</);
  assert.match(html, />Collect email results</);
  assert.equal(btns[0][3], 'Reads Squarespace contacts and orders, looks up postcodes and rebuilds the customer view, so consent and audience counts are up to date. Runs nightly at 05:15 by itself — use after importing contacts or when counts look stale. Never sends anything.');
  assert.equal(btns[1][3], 'Pulls the latest email campaign results (deliveries, opens, clicks, unsubscribes) from Squarespace into the dashboard. Runs automatically — use straight after a campaign send to see results sooner. Never sends anything.');
  assert.match(html, /data-mksr-last="sync">Last run: loading…/);
  assert.match(TAB, /<div id="mk-head-actions">\$\{typeof window\.mkSyncRunHead === 'function' \? window\.mkSyncRunHead\(\) : ''\}<\/div><\/div>`/, 'header slot next to the title');
  assert.match(TAB, /data-mk="sync" title="\$\{esc\(window\.mkSyncRun\?\.TIPS\.sync \|\| ''\)\}">Sync now/, 'original Sync now gets the same tip');
  assert.match(TAB, /return window\.mkSyncRun\.customers\(\);/, 'Sync now runs the same function as Sync customers');
  assert.doesNotMatch(TAB, /modal\.remove\(\);\s*await render\(root\)/, 'the success path no longer closes the window without a result');
  assert.match(TAB, /window\.mkSyncRunPaint\(d\)/, '"Last run" repainted after every overview load');
});

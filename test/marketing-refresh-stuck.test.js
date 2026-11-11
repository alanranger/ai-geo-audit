/**
 * QUESTION-2026-11-11 refresh-status-stuck-checking: (1) a status-refresh run closes as soon as Squarespace answered
 * (its queue row final, or a Squarespace read that landed after the click), else times out after 15 minutes with the
 * queued message; a stale-run sweep closes any run with no heartbeat for 15 min (never list-load / cleanup-exec);
 * Refresh status uses the shared progress / result window. (2) the by-channel tile never counts sent / published items
 * as Sched. (3) the header says "Data loaded … — Reload" once the tab's data is older than 15 minutes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { QUEUED_MSG, REFRESH_TIMEOUT_MS, recordRefreshOutcome, settleDecision, staleRuns, sweepStaleRuns } from '../lib/marketing/delivery-status-board.mjs';

const T = (hm) => `2026-11-11T${hm}Z`;
const META = { ok: true, results: [{ step: 'facebook_posts', ok: true, rows: 18 }] };
/** Run 7b3bb376 as Alan's click left it at 21:49 (heartbeat = the click; meta + YouTube read, Squarespace queued). */
const RUN = { run_id: '7b3bb376', status: 'running', heartbeat_at: T('21:49:08.809'), started_at: T('21:49:16.783'), summary: { meta: META, youtube: { ok: true, videos: 7 }, outcome: { state: 'partial', text: 'partial: Squarespace still queued' } } };
/** ea07e59a: the PC's Squarespace Scheduled / Drafts read at 21:53 (part of the full collector run the queue started). */
const READ = { run_id: 'ea07e59a', kind: 'collector:scheduled', status: 'ok', finished_at: T('21:53:09.439'), summary: { scheduled: 22, drafts: { drafts: 1 } } };

test('settle: still queued under 15 min → wait (nothing written); the queue row done → closes ok', () => {
  const wait = settleDecision({ run: RUN, request: { status: 'queued' }, read: null }, Date.parse(T('21:50:00')));
  assert.equal(wait.action, 'wait');
  assert.match(wait.outcome.text, /Squarespace still queued/);
  const done = settleDecision({ run: RUN, request: { status: 'done' }, read: null }, Date.parse(T('21:55:35')));
  assert.deepEqual([done.action, done.status, done.outcome.state], ['close', 'ok', 'complete']);
  assert.equal(settleDecision({ run: { ...RUN, status: 'ok' }, request: null, read: null }, Date.now()).action, 'none');
});

test('settle: a Squarespace read that lands after the click closes the refresh ok even while the queue row is still queued / running', () => {
  for (const status of ['queued', 'running']) {
    const d = settleDecision({ run: RUN, request: { status }, read: READ }, Date.parse(T('21:53:10')));
    assert.deepEqual([d.action, d.status, d.outcome.providers.squarespace], ['close', 'ok', 'ok'], status);
  }
  const failed = settleDecision({ run: RUN, request: { status: 'failed' }, read: READ }, Date.parse(T('21:53:10')));
  assert.equal(failed.outcome.providers.squarespace, 'failed', 'a failed queue row is not hidden by an older read');
});

test('settle: no answer after 15 minutes → closed timed_out with the clear queued message (never left running)', () => {
  const d = settleDecision({ run: RUN, request: { status: 'queued' }, read: null }, Date.parse(RUN.heartbeat_at) + REFRESH_TIMEOUT_MS + 1000);
  assert.deepEqual([d.action, d.status, d.outcome.state], ['close', 'timed_out', 'timed_out']);
  assert.equal(d.outcome.text, 'Squarespace check queued on Alan\'s PC — runs within 5 min; results will appear automatically');
  assert.equal(QUEUED_MSG, d.outcome.text);
});

/** A fake Supabase: the refresh run, its queue row, and the newest Squarespace read (only when the query asks for one). */
function fakeSb({ run, request, read, running = [] }) {
  const updates = [];
  const from = (table) => {
    const f = { table };
    const chain = {
      select: () => chain, order: () => chain, limit: () => chain,
      eq: (k, v) => { f[k] = v; return chain; }, in: (k, v) => { f[`in_${k}`] = v; return chain; }, gte: (k, v) => { f[`gte_${k}`] = v; return chain; },
      update: (row) => { const u = { table, row, where: {} }; updates.push(u); const w = { eq: (k, v) => { u.where[k] = v; return w; }, then: (ok) => ok({ error: null }) }; return w; },
      maybeSingle: async () => {
        if (table === 'marketing_collect_requests') return { data: request };
        if (f.in_kind) return { data: read && Date.parse(read.finished_at) >= Date.parse(f.gte_finished_at) ? read : null };
        return { data: run };
      },
      then: (ok) => ok({ data: running, error: null })
    };
    return chain;
  };
  return { from, updates };
}

test('run 7b3bb376 replayed: at 21:53:10 the 21:53:09 read closes it ok with the read on the row (it closed at 21:55:35 before the fix)', async () => {
  const sb = fakeSb({ run: RUN, request: { status: 'running' }, read: READ });
  const out = await recordRefreshOutcome(sb, T('21:53:10'));
  assert.equal(out.state, 'complete');
  const u = sb.updates.find((x) => x.table === 'marketing_collector_runs');
  assert.deepEqual([u.row.status, u.row.finished_at, u.row.summary.squarespace_read.scheduled, u.row.summary.squarespace_read.drafts, u.row.summary.squarespace_read.run_id], ['ok', T('21:53:10'), 22, 1, 'ea07e59a']);
  assert.equal(u.where.run_id, '7b3bb376');
  const before = fakeSb({ run: RUN, request: { status: 'queued' }, read: { ...READ, finished_at: T('21:38:57') } });
  assert.match((await recordRefreshOutcome(before, T('21:50:00'))).text, /still queued/, 'a read from before the click does not count');
  assert.equal(before.updates.length, 0);
});

test('stale-run sweep: no heartbeat for 15 min → timed_out (guarded on still running); list-load and cleanup-exec never swept', async () => {
  const now = Date.parse(T('22:30:00'));
  const rows = [
    { run_id: 'a', kind: 'sync:customers', status: 'running', started_at: T('22:00:00'), heartbeat_at: null },
    { run_id: 'b', kind: 'collector', status: 'running', started_at: T('22:00:00'), heartbeat_at: T('22:28:00') },
    { run_id: 'c', kind: 'list-load', status: 'running', started_at: T('21:00:00'), heartbeat_at: T('21:00:00') },
    { run_id: 'd', kind: 'cleanup-exec', status: 'running', started_at: T('21:00:00'), heartbeat_at: T('21:00:00') },
    { run_id: 'e', kind: 'collector:scheduled', status: 'ok', started_at: T('21:00:00'), heartbeat_at: null }
  ];
  assert.deepEqual(staleRuns(rows, now).map((r) => r.run_id), ['a']);
  const sb = fakeSb({ run: null, request: null, read: null, running: rows.filter((r) => r.status === 'running') });
  const out = await sweepStaleRuns(sb, T('22:30:00'));
  assert.deepEqual(out.timed_out, [{ run_id: 'a', kind: 'sync:customers' }]);
  const u = sb.updates[0];
  assert.deepEqual([u.row.status, u.where.run_id, u.where.status], ['timed_out', 'a', 'running']);
  assert.match(u.row.error, /no heartbeat for 15 min/);
});

test('the PC\'s collect-next (every 5 min) and the nightly cron run the sweep; status-refresh and its progress poll settle first', () => {
  const api = fs.readFileSync(new URL('../api/aigeo/marketing.js', import.meta.url), 'utf8');
  assert.match(api, /sweep: await sweepStaleRuns\(sb\)/);
  assert.match(api, /out\.sweep = await sweepStaleRuns\(sb\)/);
  const board = fs.readFileSync(new URL('../lib/marketing/delivery-status-board.mjs', import.meta.url), 'utf8');
  assert.match(board, /export async function refreshProgress\(sb, nowIso = new Date\(\)\.toISOString\(\)\) \{\r?\n\s+await sweepStaleRuns\(sb, nowIso\);/);
  assert.match(board, /export async function refreshStatus\(sb, \{ now = Date\.now\(\) \} = \{\}\) \{\r?\n\s+await sweepStaleRuns/);
});

/* ---------- Refresh status through the shared window (browser) ---------- */

function fakeDom() {
  const byId = new Map();
  const paints = [];
  const el = (tag) => {
    const e = { tag, id: '', _html: '', remove() { byId.delete(e.id); } };
    Object.defineProperty(e, 'innerHTML', { get: () => e._html, set: (v) => { e._html = v; if (e.id === 'mk-run-modal') paints.push(v); } });
    return e;
  };
  const document = { head: { appendChild: (e) => byId.set(e.id, e), insertAdjacentHTML: () => {} }, body: { appendChild: (e) => byId.set(e.id, e) }, createElement: el, getElementById: (id) => byId.get(id) || null, querySelector: () => null, addEventListener: () => {}, dispatchEvent: () => true };
  return { document, byId, paints };
}
function loadBoth(progress) {
  const dom = fakeDom();
  const calls = [];
  const reply = (j) => ({ ok: true, json: async () => ({ ok: true, ...j }) });
  const fetchFn = async (url, opt) => {
    const body = opt.body ? JSON.parse(opt.body) : null;
    calls.push(body?.action || url.split('action=')[1]);
    if (body?.action === 'status-refresh') return reply({ meta: META, youtube: { ok: true, videos: 7 } });
    if (/status-refresh-progress/.test(url)) return reply(progress);
    return reply({ last_checked: T('21:53:09'), last_checked_label: 'Last checked 21:53 (Europe/London) · complete', placements: [], content: [] });
  };
  const window = { getAdminKey: () => 'k', localStorage: { getItem: () => null, setItem: () => {} } };
  const ctx = vm.createContext({ window, document: dom.document, fetch: fetchFn, localStorage: window.localStorage, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } }, setTimeout, clearTimeout, setInterval, clearInterval, Intl, Date, Number, String, Object, Array, Map, Set, JSON, Math, Promise, console });
  vm.runInContext(fs.readFileSync(new URL('../lib/marketing-sync-run.js', import.meta.url), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(new URL('../lib/marketing-delivery.js', import.meta.url), 'utf8'), ctx);
  window.renderMarketingTab = () => setTimeout(() => window.mkSyncRunPaint({ runs: {} }), 1);
  return { window, dom, calls };
}

test('Refresh status: progress window (step x of 3, alive), then ✅ with one line per step incl. what Squarespace read; board returned', async () => {
  const { window, dom, calls } = loadBoth({ done: true, run_status: 'ok', squarespace_read: { finished_at: T('21:53:09'), scheduled: 22, drafts: 1 }, outcome: { state: 'complete', text: 'complete' } });
  const board = await window.mkScheduleRefresh();
  assert.equal(board.last_checked_label, 'Last checked 21:53 (Europe/London) · complete');
  assert.deepEqual(calls.slice(0, 3), ['status-refresh', 'status-refresh-progress', 'delivery-status']);
  for (const s of [1, 2, 3]) assert.ok(dom.paints.some((p) => p.includes(`data-mksr-step="${s}" data-mksr-total="3"`)), `step ${s} of 3`);
  assert.ok(dom.paints.some((p) => /data-mksr-bg="refresh">Run in background/.test(p)), 'can run in the background');
  const last = dom.byId.get('mk-run-modal').innerHTML;
  assert.match(last, /data-mksr-result="ok"/);
  assert.match(last, /Refresh status: ✅ Success/);
  assert.match(last, /✓ Meta and YouTube reads; queue the Squarespace check: Meta: posts read · YouTube: 7 videos read · Squarespace check queued/);
  assert.match(last, /✓ Squarespace \(Scheduled, Sent, Drafts\) on Alan&#39;s PC: read 11 Nov, 21:53 \(Europe\/London\) · 22 scheduled · 1 draft · complete|✓ Squarespace \(Scheduled, Sent, Drafts\) on Alan's PC: read .*22 scheduled · 1 draft · complete/);
  assert.match(last, /✓ Reload the delivery status board: Last checked 21:53/);
  assert.match(last, /data-mksr-reload="done"/);
  assert.equal(window.mkScheduleRefreshRunning(), false, 'the button leaves "Checking…"');
});

test('Refresh status: a timed-out run ends with ⏳ and the clear queued message, not an endless "Checking…"', async () => {
  const { window, dom } = loadBoth({ done: true, run_status: 'timed_out', outcome: { state: 'timed_out', text: QUEUED_MSG } });
  await window.mkScheduleRefresh();
  const last = dom.byId.get('mk-run-modal').innerHTML;
  assert.match(last, /data-mksr-result="pending"/);
  assert.match(last, /⏳ Done — still queued: Squarespace \(Scheduled, Sent, Drafts\) on Alan/);
  assert.ok(last.includes('runs within 5 min; results will appear automatically'));
  assert.equal(window.mkScheduleRefreshRunning(), false);
});

test('header: "Data loaded … (N min ago) — Reload" only once the data is 15+ minutes old', () => {
  const { window } = loadBoth({ done: true });
  const { ageText } = window.mkSyncRun.model;
  const at = Date.parse(T('21:10:00'));
  assert.equal(ageText(at, at + 14 * 60000), '');
  assert.equal(ageText(at, at + 42 * 60000), 'Data loaded 21:10 (42 min ago) — Reload');
  assert.equal(ageText(0, Date.now()), '');
});

/* ---------- by-channel tile: sent is never Sched ---------- */

function channels() {
  const window = {};
  vm.runInNewContext(fs.readFileSync(new URL('../lib/marketing-channels-tile.js', import.meta.url), 'utf8'), { window, Intl, Date, Number, String, Object, Array, Map, Set, JSON, Math });
  return window.mkChannels;
}
const email = (key, day, code, at) => ({ key, day, at, channel: 'Squarespace email', code });

test('by channel: the four 11 Nov emails already sent tonight are not Sched (22 scheduled, not 26); named in the row hover', () => {
  const ch = channels();
  const sent = ['a', 'b', 'c', 'd'].map((k) => email(`sent-${k}`, '2026-11-11', 'sent', T('20:00:00')));
  const sched = Array.from({ length: 22 }, (_, i) => email(`s${i}`, new Date(Date.parse('2026-11-19T12:00:00Z') + i * 3 * 86400000).toISOString().slice(0, 10), 'scheduled'));
  const s = { quarter_plan: { purpose_mix: { items: [...sent, ...sched], window: { from: '2026-11-11', to: '2027-02-03' }, deliveries: 26, covered: [], superseded: [] } } };
  const m = ch.build(s, { placements: [], content: [] }, '2026-11-11', Date.parse(T('22:10:00')));
  const row = m.rows.find((r) => r.key === 'email');
  assert.deepEqual([row.sched, row.sent], [22, 4]);
  assert.equal(row.next, '2026-11-19');
  assert.equal(ch.bucketOf({ code: 'sent' }), 'sent');
  assert.equal(ch.bucketOf({ code: 'published' }), 'sent');
  assert.equal(ch.bucketOf({ code: 'scheduled' }), 'sched');
  const html = globalThis.__html = (() => { const w = {}; vm.runInNewContext(fs.readFileSync(new URL('../lib/marketing-channels-tile.js', import.meta.url), 'utf8'), { window: w, Intl, Date, Number, String, Object, Array, Map, Set, JSON, Math }); return w.mkChannelsTileHtml(s, { placements: [], content: [] }, '2026-11-11', Date.parse(T('22:10:00'))); })();
  assert.match(html, /data-mkch-row="email"[^>]*title="Open the schedule: Squarespace email\n4 items already sent \/ published in the window \(today\): not counted as Sched\."/);
  assert.match(html, /data-mkch-row="email"[^>]*>.*?<span class="s">22<\/span>/s);
});

test('by channel: a social post published today is not Sched either; it still covers its day for the gap check', () => {
  const ch = channels();
  const items = [{ key: 'fb1', day: '2026-11-11', channel: 'Facebook + Instagram', code: 'published' }];
  const board = { placements: [{ step_key: 'fb1', placement: 'facebook_feed', planned_at: T('09:00:00'), status: { code: 'published' } }], content: [] };
  const row = ch.placementRow(items, board, { from: '2026-11-11', to: '2027-02-03' }, { place: 'facebook_feed', re: /Facebook/ });
  assert.deepEqual([row.sched, row.sent], [0, 1]);
  assert.equal(ch.gapOf(row, '2026-11-11', '2026-11-20'), null, 'today is covered by the published post; 9 days to the horizon is no gap');
});

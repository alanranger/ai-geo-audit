/**
 * Collect after every send (question 2026-11-08 collect-lightroom-send-and-auto-collect-after-sends) on synthetic
 * fixtures: a new send queues collection at ~15 min / 24 h / 72 h, the PC job runner serves it within the window, a
 * campaign is done only with fresh recipient data, and an uncollected campaign affects only conditions naming it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { INGEST_AGE_MS, MAX_ATTEMPTS, collectQueueJob, enqueueIngested, outcome, requestRows, triage, waitReason } from '../lib/marketing/collect-queue.mjs';
import { ingest } from '../lib/marketing/collector-ingest.mjs';
import { badgesOf, noResponseWithin } from '../lib/marketing/client-health.mjs';
import { evalNode, rowCtx } from '../lib/marketing/query/evaluate.mjs';
import { validateQuery } from '../lib/marketing/query/english.mjs';

const SENT = '2026-11-08T09:55:00.000Z';
const at = (iso, plusMs) => new Date(Date.parse(iso) + plusMs).toISOString();
const MIN = 60000;

test('a recorded send queues collection 15 min, 24 h and 72 h after the send time', () => {
  const rows = requestRows({ email_id: '6af0430760d4554034f08d7d', sent_at: SENT, source: 'collector-ingest' }, at(SENT, 3 * MIN));
  assert.deepEqual(rows.map((r) => [r.slot, r.due_at]), [['15m', '2026-11-08T10:10:00.000Z'], ['24h', '2026-11-09T09:55:00.000Z'], ['72h', '2026-11-11T09:55:00.000Z']]);
  assert.ok(rows.every((r) => r.email_id === '6af0430760d4554034f08d7d' && r.campaign_key === null));
  const dated = requestRows({ campaign_key: 'event|2026-11-12|/x', sent_at: '2026-11-08' }, '2026-11-08T12:00:00.000Z');
  assert.equal(dated[0].due_at, '2026-11-08T12:15:00.000Z', 'a date-only send (record moved to sent) counts from when it was recorded');
  assert.deepEqual(requestRows({ email_id: 'abc123def456', sent_at: '2026-10-22T17:38:00Z' }, '2026-11-08T12:00:00Z'), [], 'an old campaign is never re-queued');
  assert.deepEqual(requestRows({ sent_at: SENT }, SENT), [], 'nothing to collect without an email id or campaign record');
  assert.equal(requestRows({ email_id: 'abc123def456', sent_at: '2026-11-03T09:00:00Z' }, '2026-11-08T12:00:00Z', INGEST_AGE_MS).length, 0, 'the daily report read only queues the last 4 days');
});

test('report-read ingest queues new sends (existing slots untouched) and an ingest never fails on the queue', async () => {
  const calls = [];
  const sb = { from: (table) => ({ upsert: (rows, opts) => { calls.push({ table, rows, opts }); return { error: null, select: async () => ({ data: rows, error: null }), then: (ok) => ok({ error: null }) }; } }) };
  const now = new Date().toISOString();
  const out = await ingest(sb, { kind_of: 'campaigns', data: { campaigns: [{ email_id: 'new000000001', sent_on: now, message_count: 39, delivered: 38 }, { email_id: 'old000000001', sent_on: '2025-01-01T09:00:00Z', message_count: 900, delivered: 880 }] } });
  assert.deepEqual([out.campaigns, out.collect_queued], [2, 3]);
  const q = calls.find((c) => c.table === 'marketing_collect_requests');
  assert.deepEqual(q.opts, { onConflict: 'target,slot', ignoreDuplicates: true });
  assert.ok(q.rows.every((r) => r.email_id === 'new000000001'));
  const broken = { from: (table) => ({ upsert: () => {
    const error = table === 'marketing_collect_requests' ? { message: 'boom' } : null;
    return { error, select: async () => ({ data: null, error }), then: (ok) => ok({ error }) };
  } }) };
  const r2 = await ingest(broken, { kind_of: 'campaigns', data: { campaigns: [{ email_id: 'new000000002', sent_on: now, message_count: 1, delivered: 1 }] } });
  assert.deepEqual([r2.campaigns, r2.collect_queued], [1, 0]);
  assert.match(r2.queue_error, /boom/);
  const n = await enqueueIngested(sb, [], now);
  assert.equal(n.queued, 0);
});

test('the PC job runner serves a due request within the window; already-collected slots are skipped', () => {
  const [m15, h24] = requestRows({ email_id: 'lr0000000001', sent_at: SENT }, SENT).map((r, i) => ({ ...r, request_id: `r${i}`, attempts: 0 }));
  const tick = at(SENT, 16 * MIN);
  assert.equal(waitReason(tick, null), null);
  const due = [m15].filter((r) => r.due_at <= tick);
  const pending = { campaigns: new Map([['lr0000000001', { events_complete: false, events_collected_at: null }]]), lastOkRunAt: null };
  assert.deepEqual(triage(due, pending).serve.map((r) => r.slot), ['15m'], 'first 5-minute tick after the 15-minute mark runs the collector');
  const collected = { campaigns: new Map([['lr0000000001', { events_complete: true, events_collected_at: at(SENT, 20 * MIN) }]]), lastOkRunAt: null };
  assert.deepEqual(triage([m15], collected).skip.map((r) => r.slot), ['15m'], 'the daily run got there after the due time');
  assert.deepEqual(triage([h24], collected).serve.map((r) => r.slot), ['24h'], 'the 24 h follow-up still runs');
  const recordOnly = requestRows({ campaign_key: 'event|x' }, SENT)[0];
  assert.equal(triage([recordOnly], { campaigns: new Map(), lastOkRunAt: at(recordOnly.due_at, MIN) }).skip.length, 1, 'a record without an email id is satisfied by any later ok run');
});

test('the queue waits while the collector profile is in use or the 05:40 daily run is due', () => {
  const now = '2026-11-08T11:00:00Z';
  assert.match(waitReason(now, { started_at: '2026-11-08T10:58:00Z', heartbeat_at: '2026-11-08T10:59:30Z' }), /already in progress/);
  assert.equal(waitReason(now, { started_at: '2026-11-07T05:40:00Z', heartbeat_at: '2026-11-07T05:41:00Z' }), null, 'a run left "running" by a crash does not block forever');
  assert.match(waitReason('2026-11-09T05:35:00Z', null), /05:40 daily/);
  assert.match(waitReason('2026-07-09T04:35:00Z', null), /05:40 daily/, 'London time in summer (BST)');
  assert.equal(waitReason('2026-11-09T05:55:00Z', null), null);
});

test('a request is done only with real, freshly collected recipient data; otherwise retried, then failed', () => {
  const claimed = '2026-11-08T10:11:00Z';
  const r = { request_id: 'r0', email_id: 'lr0000000001', slot: '15m', attempts: 1, claimed_at: claimed };
  const fresh = { events_complete: true, events_collected_at: '2026-11-08T10:12:30Z', delivered: 39, opened: 6, clicked: 0, unsubscribed: 0 };
  const done = outcome(r, fresh, { status: 'ok' }, '2026-11-08T10:14:00Z');
  assert.equal(done.kind, 'done');
  assert.deepEqual([done.row.result.delivered, done.row.result.opened], [39, 6]);
  assert.equal(outcome(r, { ...fresh, events_complete: false }, { status: 'ok' }, '2026-11-08T10:14:00Z').kind, 'retry', 'events_complete=false is never reported as collected');
  assert.equal(outcome(r, { ...fresh, events_collected_at: '2026-11-08T05:41:00Z' }, { status: 'ok' }, '2026-11-08T10:14:00Z').kind, 'retry', 'an older collection is not this run');
  assert.equal(outcome(r, undefined, { status: 'ok' }, '2026-11-08T10:14:00Z').kind, 'retry', 'not listed in Squarespace yet');
  const failed = outcome(r, fresh, { status: 'failed', error: 'Squarespace login expired' }, '2026-11-08T10:14:00Z');
  assert.deepEqual([failed.kind, failed.row.status, failed.row.due_at], ['retry', 'queued', '2026-11-08T10:24:00.000Z']);
  assert.equal(outcome({ ...r, attempts: MAX_ATTEMPTS }, null, { status: 'failed' }, '2026-11-08T10:14:00Z').kind, 'failed');
});

test('collectQueueJob runs the normal collector once, reports back, then asks for the customer rebuild', async () => {
  const calls = [];
  const spawned = [];
  const replies = { 'collect-next': { job: { request_ids: ['r0', 'r1'], email_ids: ['lr0000000001'], slots: ['15m', 'manual'] } }, 'collect-done': { done: 2, retry: 0, failed: 0 }, sync: { ok: true } };
  const api = async (method, body, q = '') => { const action = body?.action || q.replace('?action=', ''); calls.push([action, body]); return replies[action]; };
  const spawnFn = (exe, args, opts) => { spawned.push([args, opts.cwd]); const child = new EventEmitter(); setImmediate(() => child.emit('exit', 0)); return child; };
  const r = await collectQueueJob({ api, root: 'ROOT', spawnFn, nodePath: 'node', log: () => {} });
  assert.deepEqual(r, { done: 2, retry: 0, failed: 0 });
  assert.deepEqual(spawned, [[['scripts/marketing-collector/collector.mjs'], 'ROOT']], 'one normal (read-only) collector run for everything due');
  assert.deepEqual(calls.map(([a]) => a), ['collect-next', 'collect-done', 'sync']);
  assert.deepEqual([calls[1][1].request_ids, calls[1][1].status, calls[2][1].step], [['r0', 'r1'], 'ok', 'customers']);
  calls.length = 0;
  spawned.length = 0;
  replies['collect-next'] = { job: null };
  assert.equal(await collectQueueJob({ api, root: 'ROOT', spawnFn, log: () => {} }), null);
  assert.deepEqual([spawned.length, calls.length], [0, 1], 'nothing due: no browser, no rebuild');
});

/* ---------- coverage rule: only conditions that depend on the uncollected campaign are undecided ---------- */

const TODAY = '2026-11-08';
const camps = ['c1', 'c2', 'c3', 'c4', 'c5'].map((id, i) => ({ id, sent_on: `2026-${String(10 - i * 2).padStart(2, '0')}-01` }));
const window = { list: camps, byId: new Map(camps.map((c) => [c.id, c])), start: camps[camps.length - 1].sent_on };
const sub = { email: 'a@example.com', subscribed: true, profile_state: 'active', suppressed: null, record_type: 'person' };
const eng = (e) => ({ delivered_campaigns: 5, opened_campaigns: 0, clicked_campaigns: 0, ...e });
const recentPending = { campaigns: 6, complete: 5, is_complete: false, pending: 1, pending_recent_only: true, covered: true, covered_through: '2026-10-01', recent_pending_hours: 48 };
const oldPending = { ...recentPending, pending: 2, pending_recent_only: false, covered: false };
const ctxOf = (cov) => ({ today: TODAY, asOf: TODAY, engagementComplete: cov.covered, engagement_coverage: cov, campaigns: window, windows: { warm_days: 90, cooling_days: 180 }, exposureBuilt: true });
const person = (facts) => ({ person_id: 'p1', anchor_key: 'sqs:x', facts: { record_type: 'person', ...facts } });
const R = (p, cov) => ({ ...rowCtx(p, ctxOf(cov)), windows: { warm_days: 90, cooling_days: 180 } });
const C = (field, op, value = null) => ({ type: 'cond', field, op, value });
const run = (node, p, cov) => evalNode(validateQuery({ root: { type: 'group', match: 'all', items: [node] } }).root, R(p, cov)).r;

const opener = person({ ...sub, camps: { d: ['c1', 'c2', 'c3', 'c4', 'c5'], o: ['c1'], k: ['c1'] }, clicks: [{ email_id: 'c1', url: 'https://www.alanranger.com/lightroom', at: '2026-10-01T10:00:00Z' }], engagement: eng({ opened_campaigns: 1, clicked_campaigns: 1, last_open_at: '2026-10-01T09:00:00Z', last_click_at: '2026-10-01T10:00:00Z' }) });
const silent = person({ ...sub, camps: { d: ['c1', 'c2', 'c3', 'c4', 'c5'], o: [], k: [] }, engagement: eng({ delivered_campaigns: 5 }) });

test('a campaign still collecting (last 48 h): conditions naming it stay undecided, everything else decides', () => {
  for (const [field, op] of [['campaign_opened', 'exists'], ['campaign_opened', 'none'], ['campaign_received', 'exists'], ['campaign_received', 'none'], ['click', 'exists'], ['click', 'none']]) {
    assert.equal(run(C(field, op, { email_id: 'c0' }), silent, recentPending), 'unknown', `${field} ${op} on the uncollected campaign`);
  }
  assert.equal(run(C('campaign_opened', 'none', { email_id: 'c1' }), silent, recentPending), 'yes', 'a collected campaign is still a firm answer');
  assert.equal(run(C('campaign_opened', 'exists', { email_id: 'c1' }), opener, recentPending), 'yes');
  assert.equal(run(C('click', 'none', { email_id: 'c1' }), silent, recentPending), 'yes');
  assert.equal(badgesOf(silent.facts, R(silent, recentPending)).email.key, 'no_response', 'email health negatives use the collected history');
  assert.equal(noResponseWithin(silent.facts, R(silent, recentPending), 6), 'yes');
  const mixed = { type: 'group', match: 'all', items: [C('eligible', 'is_true'), C('campaign_opened', 'none', { email_id: 'c0' })] };
  assert.equal(run(mixed, silent, recentPending), 'unknown', 'a group that needs the uncollected campaign is undecided');
  assert.equal(run({ type: 'group', match: 'all', items: [C('eligible', 'is_true'), C('campaign_opened', 'none', { email_id: 'c1' })] }, silent, recentPending), 'yes');
});

test('an older uncollected campaign: negatives turn Unknown (v2 rule kept) but conditions naming only collected campaigns still decide', () => {
  assert.equal(badgesOf(silent.facts, R(silent, oldPending)).email.key, 'e_unknown');
  assert.equal(run(C('campaign_opened', 'none', { email_id: 'c1' }), silent, oldPending), 'yes');
  assert.equal(run(C('campaign_received', 'exists', { email_id: 'c2' }), silent, oldPending), 'yes');
  assert.equal(run(C('click', 'none', { email_ids: ['c1', 'c2'] }), silent, oldPending), 'yes');
  assert.equal(run(C('click', 'exists', { email_id: 'c1' }), opener, oldPending), 'yes');
  assert.equal(run(C('campaign_opened', 'none', { email_id: 'c0' }), silent, oldPending), 'unknown', 'naming the uncollected campaign is still undecided');
  assert.equal(run(C('click', 'none', { email_id: 'c0' }), silent, oldPending), 'unknown');
  assert.equal(run(C('click', 'none', {}), silent, oldPending), 'unknown', 'a click condition not tied to a campaign still waits for coverage');
  const noExposure = person({ ...sub, engagement: eng({ delivered_campaigns: 5 }) });
  assert.equal(run(C('click', 'none', { email_id: 'c1' }), noExposure, oldPending), 'unknown', 'no per-person campaign list → undecided');
});

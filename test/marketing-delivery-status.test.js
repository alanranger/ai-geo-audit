/**
 * The ONE delivery status (question 2026-11-09 schedule-list-view-and-status-refresh, part B) on synthetic fixtures:
 * time passing never marks anything sent; only provider confirmation does; a partial failure keeps the last verified
 * state; personal LinkedIn GPT live evidence = published; late / cancelled only with evidence; needs approval only when
 * the decision state has it open; the check timing (15 min 07–22 UK + ~10 min after a release); Meta via the existing
 * collector steps; refresh never sends or publishes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { CHECK_RULES, emailStatus, placementStatus, taskStatus, watchDecision } from '../lib/marketing/delivery-status.mjs';
import { META_STEPS, metaCheck, metaDue } from '../lib/marketing/delivery-status-board.mjs';
import { deliveryView } from '../lib/marketing/delivery.mjs';

const T = (iso) => Date.parse(iso);
const NOW = T('2026-11-09T10:20:00Z');
const OK_READ = { state: 'fresh', failed_since_ok: false, last_ok_at: '2026-11-09T10:13:02Z', last_status: 'ok' };
const inspire = (over = {}) => ({ key: 'theme|return-9nov', title: 'Something to inspire', send_at: '2026-11-09T10:00:00Z', provider: { email_id: '6af07a9b21498276ab252ccb', state: 'gone', scheduled_for: '2026-11-09T10:00:00Z', gone_at: '2026-11-09T10:12:56Z', collected_at: '2026-11-09T09:58:51Z' }, record_stage: 'scheduled', ...over });

test('time passing never marks an email sent: due + left the Scheduled tab = checking until the Sent list confirms it', () => {
  const s = emailStatus(inspire(), { now: NOW, read: OK_READ });
  assert.equal(s.code, 'checking');
  assert.match(s.evidence, /waiting for Squarespace's Sent list .* left the Scheduled tab/);
  const days = emailStatus(inspire(), { now: T('2026-11-12T10:00:00Z'), read: OK_READ });
  assert.notEqual(days.code, 'sent', 'still not sent three days later without provider confirmation');
  const marked = emailStatus({ key: 'x', record_stage: 'sent', send_at: '2026-11-09T09:00:00Z', sent: { seen: false, at: '2026-11-09T09:00:00Z' } }, { now: NOW, read: OK_READ });
  assert.equal(marked.code, 'checking', 'a record marked sent is not provider confirmation');
});

test('provider confirmation = sent, with the actual time and link; a later failed check never downgrades it', () => {
  const sent = inspire({ sent: { seen: true, at: '2026-11-09T10:00:12Z', email_id: '6af07a9b21498276ab252ccb' } });
  const s = emailStatus(sent, { now: NOW, read: OK_READ });
  assert.deepEqual([s.code, s.label, s.icon, s.tone, s.at], ['sent', 'Sent', '✅', 'green', '2026-11-09T10:00:12Z']);
  assert.match(s.link, /6af07a9b21498276ab252ccb$/);
  assert.equal(emailStatus(sent, { now: NOW, read: { ...OK_READ, failed_since_ok: true, last_status: 'failed' } }).code, 'sent');
});

test('partial failure: the due email keeps its last verified state and says "verification unavailable"', () => {
  const s = emailStatus(inspire({ provider: { ...inspire().provider, state: 'scheduled', gone_at: null } }), { now: NOW, read: { ...OK_READ, failed_since_ok: true, last_status: 'failed' } });
  assert.equal(s.code, 'verification_unavailable');
  assert.deepEqual(s.last_verified.code, 'scheduled');
});

test('late only with evidence; cancelled only when Squarespace dropped it before its time; future = scheduled', () => {
  const still = inspire({ provider: { ...inspire().provider, state: 'scheduled', gone_at: null, collected_at: '2026-11-09T11:30:00Z' } });
  const late = emailStatus(still, { now: T('2026-11-09T11:35:00Z'), read: OK_READ });
  assert.equal(late.code, 'late');
  assert.match(late.evidence, /still listed it as scheduled/);
  const cancelled = emailStatus(inspire({ provider: { ...inspire().provider, gone_at: '2026-11-09T08:00:00Z' } }), { now: NOW, read: OK_READ });
  assert.equal(cancelled.code, 'cancelled');
  const pnm = emailStatus({ key: 'theme|pnm', send_at: '2026-11-10T10:00:00Z', provider: { email_id: 'p', state: 'scheduled', scheduled_for: '2026-11-10T10:00:00Z', collected_at: '2026-11-09T10:13:00Z' } }, { now: NOW, read: OK_READ });
  assert.deepEqual([pnm.code, pnm.tone, pnm.when], ['scheduled', 'blue', 'Scheduled Tue 10 Nov 10:00am']);
  const draft = emailStatus({ key: 'theme|x', record_stage: 'drafted', send_day: '2026-11-19' }, { now: NOW });
  assert.deepEqual([draft.code, draft.when, draft.blocker], ['in_preparation', 'Planned Thu 19 Nov (no time yet)', 'audience not chosen']);
});

const NORFOLK_LI = { step_key: 'gpt-event-2026-11-09-norfolk-li', placement: 'linkedin_feed', stage: 'live_check', platform_state: 'published', provider_id: '7525483905408335872', provider_url: 'https://www.linkedin.com/feed/update/urn:li:activity:7525483905408335872/', planned_at: '2026-11-09T08:30:00Z', actual_at: '2026-11-09T09:06:19.779Z', evidence: [{ at: '2026-11-09T09:06:19.779Z', by: 'GPT', action: 'live_post_verified', screenshot: 'x.png' }], set_by: 'GPT' };

test('personal LinkedIn: GPT\'s recorded live check (id, URL, time, screenshot) = Published, with its link', () => {
  const s = placementStatus(NORFOLK_LI, { now: NOW, meta: { ok: false, error: 'down' } });
  assert.deepEqual([s.code, s.label, s.at, s.link], ['published', 'Published', '2026-11-09T09:06:19.779Z', NORFOLK_LI.provider_url]);
  assert.match(s.evidence, /^verified by GPT live check Mon 9 Nov 9:06am \(screenshot recorded\)/);
  const due = placementStatus({ ...NORFOLK_LI, provider_id: null, provider_url: null, stage: 'prepare', platform_state: 'app_draft', actual_at: null, evidence: [] }, { now: NOW });
  assert.equal(due.code, 'checking', 'due personal LinkedIn without a live check = checking, never published');
  assert.match(due.blocker, /no API: needs GPT's live check/);
});

const FOCUS = { step_key: 'gpt-8w-social-2026-11-10-fbig', placement: 'facebook_feed', stage: 'prepare', platform_state: 'app_draft', planned_at: '2026-11-10T18:30:00Z', public_caption: 'x', link_url: 'https://x', assets: { editorial: {} }, evidence: [] };

test('Tue 10 Nov focus bracketing (artwork missing): In preparation, "Planned 6:30pm", never Needs approval', () => {
  const blockers = () => ['rendered asset'];
  const s = placementStatus(FOCUS, { now: NOW, blockers });
  assert.deepEqual([s.code, s.label, s.icon, s.when, s.blocker], ['in_preparation', 'In preparation', '📄', 'Planned 6:30pm', 'missing rendered asset']);
  assert.equal(placementStatus(FOCUS, { now: NOW, blockers: () => [], open: new Set([FOCUS.step_key]) }).code, 'needs_approval', 'only when the decision state has it open (all ready)');
  assert.equal(placementStatus(FOCUS, { now: NOW, blockers: () => [] }).code, 'in_preparation', 'ready but not yet asked = still in preparation');
});

test('Meta: a due post with a failed Meta check = verification unavailable; a published post stays published', () => {
  const due = placementStatus({ ...FOCUS, planned_at: '2026-11-09T09:00:00Z' }, { now: NOW, meta: { ok: false, error: 'rate limited', last_ok_at: '2026-11-09T08:05:00Z' } });
  assert.equal(due.code, 'verification_unavailable');
  const pub = placementStatus({ ...FOCUS, provider_id: '123_456', provider_url: 'https://facebook.com/123', actual_at: '2026-11-10T18:31:00Z', stage: 'published' }, { now: NOW, meta: { ok: false } });
  assert.equal(pub.code, 'published');
  assert.equal(placementStatus({ ...FOCUS, platform_state: 'scheduled', provider_id: '999' }, { now: NOW }).code, 'scheduled', 'a platform-scheduled Meta post is blue, not published');
});

test('tasks: a reminder never looks scheduled; ticked = done; open Outlook decision = needs approval', () => {
  assert.equal(taskStatus({ key: 'k', channel: 'Outlook personal notes', day: '2026-11-10', done: false }, { today: '2026-11-09', open: new Set() }).code, 'in_preparation');
  assert.equal(taskStatus({ key: 'k', channel: 'Outlook personal notes', day: '2026-11-09', done: false }, { today: '2026-11-09', open: new Set(['outlook|k']) }).code, 'needs_approval');
  assert.equal(taskStatus({ key: 'k', channel: 'Google Business', day: '2026-11-09', done: true }, { today: '2026-11-09' }).code, 'done');
});

test('check timing: every 15 minutes 07:00–22:00 UK, once ~10 minutes after a release, never in the 05:00 hour', () => {
  const at = (iso, o = {}) => watchDecision({ now: T(iso), lastAttemptAt: o.attempt || null, lastOkAt: o.ok || null, releases: o.releases || [], running: !!o.running });
  assert.equal(at('2026-11-09T10:20:00Z', { attempt: '2026-11-09T10:13:00Z' }).due, false);
  assert.equal(at('2026-11-09T10:30:00Z', { attempt: '2026-11-09T10:13:00Z' }).due, true);
  assert.equal(at('2026-11-09T23:00:00Z', { attempt: '2026-11-09T21:59:00Z' }).due, false, 'outside hours, no release');
  const rel = at('2026-11-09T23:11:00Z', { attempt: '2026-11-09T21:59:00Z', ok: '2026-11-09T21:59:00Z', releases: ['2026-11-09T23:00:00Z'] });
  assert.deepEqual([rel.due, /release check 10 min after/.test(rel.reason)], [true, true]);
  assert.equal(at('2026-11-10T05:15:00Z', { releases: ['2026-11-10T05:00:00Z'] }).due, false, '05:00 hour = nightly collector');
  assert.equal(at('2026-11-09T10:40:00Z', { running: true }).due, false);
  assert.equal(metaDue({ connected: true, last_ok_at: '2026-11-10T18:00:00Z' }, ['2026-11-10T18:30:00Z'], T('2026-11-10T18:41:00Z')).due, true);
  assert.equal(metaDue({ connected: true, last_ok_at: '2026-11-10T18:45:00Z' }, ['2026-11-10T18:30:00Z'], T('2026-11-10T18:50:00Z')).due, false);
});

/** Fake Supabase for the Meta connection read. */
const connDb = (row) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }) });

test('Meta check reuses the existing collector post steps (unchanged), skips a check made in the last 5 minutes', async () => {
  const calls = [];
  const run = async (step) => { calls.push(step); return { ok: true, step, rows: 3 }; };
  const r = await metaCheck(connDb({ status: 'connected', last_collected_at: '2026-11-09T08:05:00Z', last_error: null }), { now: NOW, run, repo: {} });
  assert.deepEqual([r.ok, calls], [true, META_STEPS]);
  const skip = await metaCheck(connDb({ status: 'connected', last_collected_at: '2026-11-09T10:18:00Z' }), { now: NOW, run, repo: {} });
  assert.match(skip.skipped, /last 5 minutes/);
  assert.equal((await metaCheck(connDb(null), { now: NOW, run, repo: {} })).skipped, 'not_connected');
});

test('the delivery builder attaches the same status to every email; the browser rules text equals the server one', () => {
  const meter = { captured_at: '2026-11-09T10:13:00Z', cycle_reset_at: '2026-11-12T12:51:47Z', quota_emails: 5000, used_emails: 2979 };
  const camp = { campaign_key: 'theme|pnm', kind: 'theme', title: 'Pick n Mix', stage: 'scheduled', scheduled_for: '2026-11-10T10:00:00Z', scheduled_recipients: 127, schedule_evidence: 'operator_verified', schedule_evidence_by: 'Alan via GPT' };
  const v = deliveryView(meter, { campaigns: [camp], exports: [], schedules: [], sent: [], runs: [] }, {}, new Date(NOW));
  assert.deepEqual([v.deliveries[0].status.code, v.deliveries[0].status.evidence], ['scheduled', 'operator-verified (Alan via GPT)']);
  const store = {};
  const win = { localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, x) => { store[k] = x; } } };
  const ctx = vm.createContext({ window: win, document: { getElementById: () => null, head: { insertAdjacentHTML: () => {} } }, localStorage: win.localStorage, Intl, Date, Number, String, Map, Set, JSON, Math, Promise, Array, Object, console });
  vm.runInContext(fs.readFileSync(new URL('../lib/marketing-delivery.js', import.meta.url), 'utf8'), ctx);
  assert.equal(win.mkCheckRules, CHECK_RULES);
  assert.equal(typeof win.mkScheduleRefresh, 'function');
});

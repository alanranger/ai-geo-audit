/**
 * QUESTION-2026-11-10 19nov-card-light-logic-label-and-gone-vs-scheduled: a record marked scheduled whose Squarespace
 * schedule isn't listed (moved back to Drafts to edit it, 10 Nov 17:23–17:53) is red "Not in Squarespace Scheduled —
 * check" on the card, the capacity tile and the billing-cycle tile and counts as a DRAFT (not reserved) until listed
 * again; a Light & Logic module recorded before the email's latest Squarespace edit is not shown as in the email;
 * drafts with no segment say "audience not chosen".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { notInScheduled } from '../lib/marketing/delivery.mjs';
import { emailStatus } from '../lib/marketing/delivery-status.mjs';
import { meterView } from '../lib/marketing/meter.mjs';
import { promotionsOf } from '../api/aigeo/marketing-schedule-extras.js';

const RESET = '2026-11-12T12:51:47.184Z';
const LATEST = { captured_at: '2026-11-10T17:23:40Z', cycle_reset_at: RESET, quota_emails: 5000, used_emails: 3217 };
const KEY = 'theme|gpt-8w-2026-11-19';
const ID = '6af0811d60d4554034f4b5bb';
const REC = { campaign_key: KEY, kind: 'theme', title: 'Small details, new possibilities', stage: 'scheduled', audience: 'segments', segment_ids: ['gpt-8w-engaged-review'], planned_send_on: '2026-11-19', scheduled_for: '2026-11-19T19:30:00Z', scheduled_recipients: 561, schedule_evidence: 'seen', schedule_evidence_at: '2026-11-10T17:07:02Z', export_id: 'x-19', sqs_draft_id: ID, estimate_sends: 544 };
const EXP = { export_id: 'x-19', campaign_key: KEY, list_name: 'ARP | 19 Nov', eligible_count: 560, status: 'loaded', load_result: { list_count: '561' }, owner: { included: true, count: 0, business_copy: 1 } };
const SCHED = { email_id: ID, subject: 'Small details', scheduled_for: '2026-11-19T19:30:00Z', mailing_list_names: ['ARP | 19 Nov'], recipients: 561, collected_at: '2026-11-10T17:07:02Z', campaign_key: KEY, link_state: 'linked' };
const GONE = { ...SCHED, state: 'gone', gone_at: '2026-11-10T17:23:48Z' };
const NOW = new Date('2026-11-10T17:35:00Z');
const RUNS = [{ kind: 'collector:scheduled', status: 'ok', started_at: '2026-11-10T17:23:50Z', finished_at: '2026-11-10T17:23:56Z' }];
const meterOf = (schedule, extra = {}) => meterView(LATEST, [REC, ...(extra.campaigns || [])], [], NOW, { exports: [EXP], schedules: [schedule], runs: RUNS, ...extra });

test('notInScheduled: gone before its time = flagged; gone after the send, still listed, sent or cancelled = not', () => {
  const base = { record_stage: 'scheduled', send_at: '2026-11-19T19:30:00Z' };
  const now = NOW.getTime();
  assert.match(notInScheduled({ ...base, provider: GONE }, now).reason, /left Squarespace Scheduled before its send time/);
  assert.equal(notInScheduled({ ...base, provider: { ...GONE, gone_at: '2026-11-19T19:31:00Z' } }, now), null, 'left after its send time = sent');
  assert.equal(notInScheduled({ ...base, provider: { ...SCHED, state: 'scheduled' } }, now), null);
  assert.equal(notInScheduled({ ...base, provider: GONE, sent: { at: 'x' } }, now), null);
  assert.equal(notInScheduled({ ...base, record_stage: 'drafted', provider: GONE }, now), null, 'only records marked scheduled');
  assert.equal(notInScheduled({ ...base, provider: GONE, scheduled_as: 'sqs:y' }, now), null);
});

test('notInScheduled, no schedule linked: flagged only when Squarespace lists the email in Drafts after the confirmation', () => {
  const op = { record_stage: 'scheduled', send_at: '2026-11-19T19:30:00Z', sqs_draft_id: ID, operator: { evidence_at: '2026-11-10T17:00:00Z' } };
  const now = NOW.getTime();
  assert.equal(notInScheduled(op, now, new Map()), null, 'no drafts evidence: never guessed');
  assert.match(notInScheduled(op, now, new Map([[ID, '2026-11-10T17:23:52Z']])).reason, /lists the email in Drafts/);
  assert.equal(notInScheduled(op, now, new Map([[ID, '2026-11-10T16:53:00Z']])), null, 'a Drafts read older than the confirmation is not evidence');
  assert.equal(notInScheduled({ ...op, operator: null }, now, new Map([[ID, '2026-11-10T17:23:52Z']])), null, 'no confirmation time: not flagged');
});

test('17:23 state: scheduled record + gone schedule → DRAFT (not reserved), red warning, red card status, listed on the capacity', () => {
  const m = meterOf(GONE);
  const d = m.deliveries.find((x) => x.key === KEY);
  assert.deepEqual([d.bucket, d.side, d.amount], ['draft', 'next', 561]);
  assert.equal(d.status.code, 'not_in_scheduled');
  assert.equal(d.status.label, 'Not in Squarespace Scheduled — check');
  assert.equal(d.status.tone, 'red');
  assert.deepEqual([m.capacity.next_cycle.committed, m.capacity.next_cycle.draft_proposals, m.capacity.next_cycle.draft_items], [0, 561, 1]);
  assert.equal(m.capacity.not_in_scheduled.length, 1);
  assert.equal(m.capacity.not_in_scheduled[0].title, REC.title);
  assert.ok(m.warnings.some((w) => w.level === 'red' && /Not in Squarespace Scheduled — check/.test(w.text) && w.key === KEY));
  assert.ok(!m.reservations.some((r) => r.key === KEY), 'not in the reservations list');
});

test('17:53 state: listed in Scheduled again → SCHED, committed, no warning', () => {
  const m = meterOf({ ...SCHED, state: 'scheduled' });
  const d = m.deliveries.find((x) => x.key === KEY);
  assert.deepEqual([d.bucket, d.status.code, d.not_in_scheduled], ['committed', 'scheduled', null]);
  assert.deepEqual([m.capacity.next_cycle.committed, m.capacity.not_in_scheduled.length], [561, 0]);
  assert.ok(!m.warnings.some((w) => /Not in Squarespace Scheduled/.test(w.text)));
});

test('a linked email id (sqs_email_id) is not a send while Squarespace lists it as scheduled or it left before its time', () => {
  const linked = { ...REC, sqs_email_id: ID };
  const listed = meterView(LATEST, [linked], [], NOW, { exports: [EXP], schedules: [{ ...SCHED, state: 'scheduled' }], runs: RUNS }).deliveries[0];
  assert.deepEqual([listed.sent, listed.bucket, listed.status.code], [null, 'committed', 'scheduled'], 'was "linked, not collected yet" → released, counted nowhere');
  const gone = meterView(LATEST, [linked], [], NOW, { exports: [EXP], schedules: [GONE], runs: RUNS }).deliveries[0];
  assert.deepEqual([gone.sent, gone.bucket, gone.status.code], [null, 'draft', 'not_in_scheduled']);
  const after = meterView({ ...LATEST, captured_at: '2026-11-19T20:30:00Z' }, [linked], [], new Date('2026-11-19T20:30:00Z'), { exports: [EXP], schedules: [{ ...GONE, gone_at: '2026-11-19T19:38:00Z' }], runs: RUNS }).deliveries[0];
  assert.equal(after.sent.note, 'linked, not collected yet', 'left Scheduled after its time: sent, pending the Sent list');
});

function browser(files) {
  const store = {};
  const win = { localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } } };
  const document = { getElementById: () => null, querySelector: () => null, addEventListener: () => {}, createElement: () => ({}), head: { appendChild: () => {}, insertAdjacentHTML: () => {} } };
  const ctx = vm.createContext({ window: win, document, localStorage: win.localStorage, Intl, Date, Number, String, Map, Set, JSON, Math, Promise, Array, Object, RegExp, console, encodeURIComponent, setTimeout, CustomEvent: class {}, MutationObserver: class { observe() {} } });
  for (const f of files) vm.runInContext(fs.readFileSync(new URL(f, import.meta.url), 'utf8'), ctx);
  return win;
}

test('billing-cycle tile + capacity tile: red "Not in Squarespace Scheduled — check", counted as DRAFT; tile 8 goes red', () => {
  const win = browser(['../lib/marketing-sqs-cycles.js', '../lib/marketing-delivery.js', '../lib/marketing-overview-tiles.js']);
  const m = meterOf(GONE);
  const d = { meter: { ...m, schedule_read: { state: 'fresh', last_ok_at: RUNS[0].finished_at } }, segments: [], runs: {} };
  const row = win.mkSqsCycles.build(d).columns[1].rows.find((r) => r.key === KEY);
  assert.deepEqual(JSON.parse(JSON.stringify([row.tag, row.reserved, row.alert.level, row.alert.text])), ['DRAFT', false, 'red', 'Not in Squarespace Scheduled — check']);
  const html = win.mkSqsCyclesTileHtml(d, NOW.getTime());
  assert.match(html, /class="mko-tile mkc r-red"/);
  assert.match(html, /<span class="mkc-al a-red"[^>]*>⚠ Not in Squarespace Scheduled — check<\/span>/);
  const rows = win.mkCapacityRows(win.mkCapacity(d, null));
  const gone = rows.find((r) => r[0] === 'Not in Squarespace Scheduled — check');
  assert.ok(gone && /1 email: Small details, new possibilities \(561\) · counted as drafts, not reserved/.test(gone[1]));
  assert.equal(win.mkOverviewTiles.tileAllowance(d, null).rag, 'red');
});

test('card: the server status renders "Not in Squarespace Scheduled — check" in red', () => {
  const win = browser(['../lib/marketing-schedule-model.js', '../lib/marketing-schedule-list.js']);
  const L = win.mkScheduleList;
  const st = meterOf(GONE).deliveries.find((x) => x.key === KEY).status;
  const s = L.statusOf({ row: 'email', record_key: KEY, raw: { delivery: { status: st } } }, {});
  assert.match(L.badge(s), /mkl-late.*Not in Squarespace Scheduled — check/);
});

const MODULE = { asset_key: 'module|light-and-logic|2026-11-15', title: 'L&L Nov module', status: 'draft', used_in: ['newsletter|light-and-logic', `send|${KEY}`, 'delivery|gpt-ll-newsletter-2026-11-15'], set_at: '2026-11-09T13:51:52Z' };
const CAMP = [{ campaign_key: KEY, stage: 'scheduled', planned_send_on: '2026-11-19', sqs_draft_id: ID }];

test('Light & Logic module: confirmed only while no Squarespace edit of the email is newer than the record', () => {
  assert.equal(promotionsOf([MODULE], CAMP, new Map())[0].confirmed, true, 'no edit read: the record stands');
  assert.equal(promotionsOf([MODULE], CAMP, new Map([[ID, '2026-11-09T11:56:00Z']]))[0].confirmed, true, 'edited before it was recorded');
  const p = promotionsOf([MODULE], CAMP, new Map([[ID, '2026-11-10T17:05:42Z']]))[0];
  assert.deepEqual([p.confirmed, p.provider_edited_at, p.recorded_at], [false, '2026-11-10T17:05:42Z', '2026-11-09T13:51:52Z']);
});

test('email card: the stale module is not shown while the edition is on hold; amber "re-check" when not held; removed never shown', () => {
  const win = browser(['../lib/marketing-schedule-model.js', '../lib/marketing-schedule-list.js']);
  const L = win.mkScheduleList;
  const item = { id: `email|${KEY}`, row: 'email', key: KEY, record_key: KEY, title: 'Small details', short: 'Small details', day: '2026-11-19', time: '19:30', people: 561, state: 'sch', draft: false, raw: { planned_at: '2026-11-19T19:30:00Z' } };
  const model = { today: '2026-11-17', items: [item], byId: new Map([[item.id, item]]), s: { campaign: {} }, freq: null };
  const html = (promotions, holds) => L.listHtml(model, { range: { from: '2026-11-16', to: '2026-11-22' }, channel: 'all' }, { status: () => ({ code: 'scheduled', label: 'Scheduled', icon: '🕒' }), promotions, board: { holds } });
  const held = [{ match: '^gpt-ll-newsletter-', at: '2026-11-09', reason: 'deferred' }];
  const fresh = promotionsOf([MODULE], CAMP, new Map([[ID, '2026-11-09T11:56:00Z']]));
  const stale = promotionsOf([MODULE], CAMP, new Map([[ID, '2026-11-10T17:05:42Z']]));
  assert.match(html(fresh, held), /📰 Light &amp; Logic Nov edition module · on hold \(Alan\)/, 'still confirmed: unchanged label');
  assert.doesNotMatch(html(stale, held), /Light &amp; Logic/, '19 Nov today: edited after the record and the edition is on hold → no label');
  assert.match(html(stale, []), /⚠ Light &amp; Logic module: re-check \(email edited since it was recorded\)/);
  assert.doesNotMatch(html(promotionsOf([{ ...MODULE, status: 'removed' }], CAMP), []), /Light &amp; Logic/);
});

test('drafts with no segment: "audience not chosen" on the card status and the billing-cycle row', () => {
  const draft = { campaign_key: 'theme|gpt-8w-academy-2026-12-01', kind: 'theme', title: 'Academy next', stage: 'drafted', audience: null, segment_ids: [], planned_send_on: '2026-12-01', estimate_sends: 11, estimate_as_of: '2026-11-08' };
  const m = meterOf({ ...SCHED, state: 'scheduled' }, { campaigns: [draft] });
  const d = m.deliveries.find((x) => x.key === draft.campaign_key);
  assert.equal(emailStatus(d, { now: NOW.getTime() }).blocker, 'audience not chosen (plan estimate only)');
  const win = browser(['../lib/marketing-sqs-cycles.js']);
  const row = win.mkSqsCycles.build({ meter: m, segments: [], runs: {} }).columns[1].rows.find((r) => r.key === draft.campaign_key);
  assert.deepEqual(JSON.parse(JSON.stringify([row.amount, row.alert.level, row.alert.text])), [11, 'amber', 'audience not chosen']);
});

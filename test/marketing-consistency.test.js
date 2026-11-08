/**
 * QUESTION 2026-11-08 strategy-marketing-consistency-fixes, Marketing side: the retired weekly-email placeholder of
 * w/c 2 Nov is superseded by the three real sends (3 emails · 581), sent records carry the provider send time apart from
 * the record-update time, and sends the collector hasn't read yet show as "awaiting", never as complete coverage.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { deliveryView } from '../lib/marketing/delivery.mjs';
import { coverageOf, knownUncollected } from '../lib/marketing/overview.mjs';
import { stepState, supersededState } from '../lib/strategy-step-status.mjs';

const NOW = new Date('2026-11-08T18:40:00Z');
const WEEK = '2026-11-02';
const METER = { captured_at: '2026-11-08T18:00:00Z', cycle_reset_at: '2026-11-12T12:51:47.184Z', quota_emails: 5000, used_emails: 2979 };
const KEY = `step|${WEEK}|Squarespace email|2026-11-05`;
const TICK = { is_ticked: true, status: 'done', set_by: 'gpt', set_at: '2026-11-08T17:41:46Z', reason: 'Completed through three targeted campaigns on 8 Nov', history: [{ status: 'done', by: 'gpt' }] };
const COVER = ['theme|creative-next-step-8nov', 'theme|norfolk-workshops-8nov', 'event|2026-11-12|/lightroom'];
const STEP = { key: KEY, week: WEEK, day: '2026-11-05', scheduled_day: '2026-11-05', channel: 'Squarespace email', step: 'Main email of the week: "Norfolk, Lightroom course"', is_email: true, covers: [], featured: [], covered_by: COVER };
const ctx = (extra = {}) => ({ today: '2026-11-08', ticks: { [KEY]: TICK }, sqs: [], recordsByKey: new Map(), sqsById: new Map(), listed: new Set(), places: new Map(), zeroLeft: new Set(), actionsById: new Map(), cancelled: new Map(), ...extra });

test('a ticked weekly-email placeholder covered by the week\'s real sends is superseded, with its tick kept as history', () => {
  const st = stepState(STEP, ctx());
  assert.deepEqual([st.status, st.resolved, st.by, st.reason], ['superseded', true, 'gpt', TICK.reason]);
  assert.deepEqual(st.covered_by, COVER);
  assert.equal(st.history.length, 1);
  assert.equal(stepState({ ...STEP, covered_by: undefined }, ctx()).status, 'done', 'not covered: the hand tick stands');
  const linked = { campaign_key: `email|${WEEK}`, stored: true, stage: 'sent', set_by: 'x', stage_history: [{ stage: 'sent', at: '2026-11-05T10:00:00Z' }] };
  assert.equal(supersededState(STEP, ctx({ recordsByKey: new Map([[linked.campaign_key, linked]]) })), null, 'its own record really sent: not superseded');
});

function browser() {
  const win = { localStorage: { getItem: () => null, setItem: () => {} } };
  const document = { getElementById: () => null, head: { insertAdjacentHTML: () => {} } };
  const c = vm.createContext({ window: win, document, localStorage: win.localStorage, Intl, Date, Number, String, Map, Set, JSON, Math, Promise, Array, Object, console });
  for (const f of ['../lib/marketing-delivery.js', '../lib/marketing-schedule-model.js']) vm.runInContext(fs.readFileSync(new URL(f, import.meta.url), 'utf8'), c);
  return win;
}
const sentTheme = (key, title, people) => ({
  campaign_key: key, kind: 'theme', title, stage: 'sent', planned_send_on: '2026-11-08', scheduled_for: '2026-11-08T17:00:00Z', scheduled_recipients: people, actual_sends: people,
  schedule_evidence: 'operator_verified', window_start: '2026-11-08', stage_history: [{ stage: 'scheduled', at: '2026-11-08T13:00:00Z' }, { stage: 'sent', at: '2026-11-08T17:31:00Z' }]
});
const CAMPAIGNS = [
  sentTheme(COVER[0], 'Creative next steps', 231),
  sentTheme(COVER[1], 'Norfolk, Macro and something to watch', 311),
  { campaign_key: COVER[2], kind: 'event', title: 'Lightroom classes', stage: 'sent', sqs_email_id: 'lr1', actual_sends: 39, sent_on: '2026-11-08' }
];
const SENT = [{ email_id: 'lr1', subject: 'Lightroom starts Thursday', sent_on: '2026-11-08T09:55:31Z', message_count: 39, mailing_list_names: ['LR30'] }];

test('w/c 2 Nov = 3 emails · 581 sends: the superseded placeholder is not an email, not "+1 not drafted", not audience demand', () => {
  const win = browser();
  const meter = deliveryView(METER, { campaigns: CAMPAIGNS, exports: [], schedules: [], sent: SENT, runs: [], members: new Map() }, {}, NOW);
  const step = { ...STEP, state: stepState(STEP, ctx()) };
  const s = { week_start: WEEK, campaign: { weeks: [{ week: WEEK, rows: [], steps: [step] }], carried: { late: [], older: [] }, ticks: { [KEY]: TICK }, campaigns: [{ campaign_key: `email|${WEEK}`, kind: 'weekly_email', stage: 'proposed', audience: null, covered_by: COVER }] } };
  const d = { meter };
  const items = win.mkDeliveryItems(d, s);
  const m = win.mkScheduleModel.build({ items, d, s, cap: { ...meter.capacity, unchosen: [] }, g: null, today: '2026-11-08' });
  const w = win.mkScheduleModel.weeks(m, 9).find((x) => x.week === WEEK).emails;
  assert.deepEqual([w.count, w.sends, w.unknown], [3, 581, 0]);
  assert.equal(items.find((x) => x.key.startsWith(KEY)).status, 'resolved');
  const creative = items.find((x) => x.record_key === COVER[0]);
  assert.deepEqual([creative.done_at, creative.recorded_at], ['2026-11-08T17:00:00.000Z', '2026-11-08T17:31:00Z'], 'Sent = provider time; recorded apart');
});

test('collector lag: sends known but not yet collected are counted as awaiting, so coverage is never "complete" early', () => {
  const collected = [{ email_id: 'a', sent_on: '2026-11-01T10:00:00Z', events_complete: true }, { email_id: 'lr1', sent_on: '2026-11-08T09:55:00Z', events_complete: true, campaign_key: COVER[2] }];
  const schedules = [
    { email_id: 'cr', scheduled_for: '2026-11-08T17:00:00+00:00', state: 'gone', gone_at: '2026-11-08T17:07:55Z' },
    { email_id: 'early', scheduled_for: '2026-11-09T10:00:00+00:00', state: 'gone', gone_at: '2026-11-08T12:00:00Z' }
  ];
  const records = [{ campaign_key: COVER[1], stage: 'sent', sqs_draft_id: 'nw', scheduled_for: '2026-11-08T17:00:00Z' }, { campaign_key: COVER[2], stage: 'sent', sqs_email_id: 'lr1' }];
  const extra = knownUncollected(collected, schedules, records);
  assert.deepEqual(extra.map((x) => x.email_id).sort(), ['cr', 'nw'], 'unscheduled-before-send is not a send; collected ones are not repeated');
  const cov = coverageOf([...collected, ...extra], NOW.toISOString());
  assert.deepEqual([cov.collected, cov.known, cov.awaiting_collector, cov.is_complete, cov.covered, cov.covered_through], [2, 4, 2, false, true, '2026-11-08']);
});

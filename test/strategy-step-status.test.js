import test from 'node:test';
import assert from 'node:assert/strict';
import { addTargetedSteps, applyStepStatus, dropRepeats, matchEmail, registerRows, stepState } from '../lib/strategy-step-status.mjs';
import { buildCampaignRecords, emailLinks, recipientsPart, sendsFromRecords, sentListPart } from '../lib/strategy-campaigns.mjs';
import { buildMoments, campaignRules, campaignWeeks } from '../lib/strategy-moments.mjs';
import { summarisePosts } from '../lib/strategy-gbp.mjs';
import { patchedRows, patchFor, statusPatch, whoOf } from '../api/aigeo/strategy-ticks.js';

const TODAY = '2026-11-08';
const WEEK = '2026-11-02';
const EMAIL = { key: `step|${WEEK}|Squarespace email|2026-11-05`, week: WEEK, day: TODAY, scheduled_day: '2026-11-05', channel: 'Squarespace email', step: 'Main email of the week', is_email: true, lead_names: ['Norfolk', 'Lightroom course'], covers: [], featured: [{ name: 'Norfolk' }, { name: 'Lightroom course' }] };
const NORFOLK = { name: 'Norfolk', when: '20–22 Nov', date: '2026-11-20', event_key: '2026-11-20|/norfolk' };
const POST = { key: `step|${WEEK}|Facebook + Instagram|2026-11-06`, week: WEEK, day: TODAY, scheduled_day: '2026-11-06', channel: 'Facebook + Instagram', step: 'Post: Last 2 places Norfolk', covers: ['m1'], featured: [NORFOLK] };
const sq = (id, subject, sent_on, lists = ['ACCEPTS_MARKETING']) => ({ email_id: id, subject, sent_on, sent_at: `${sent_on}T09:55:00Z`, mailing_list_names: lists });
const base = (extra = {}) => ({ today: TODAY, ticks: {}, sqs: [], recordsByKey: new Map(), sqsById: new Map(), listed: new Set([NORFOLK.event_key]), places: new Map(), zeroLeft: new Set(), actionsById: new Map(), cancelled: new Map(), ...extra });

const SHEETS = { courses: [], workshops: [], idxCourse: new Map(), idxWorkshop: new Map() };
const FULL = { campaign_key: `email|${WEEK}`, kind: 'weekly_email', title: 'w', stage: 'proposed', audience: 'full_list', segment_ids: [] };
const recsFor = (rows, sqs) => buildCampaignRecords({ weeks: [{ week: WEEK, steps: [EMAIL] }], moments: [], events: [], leadTimes: {}, rows, txns: [], sheets: SHEETS, ga4: [], sqs, today: TODAY });

test('weekly email done automatically only by a send to its chosen audience (full list) → linked on the record', () => {
  const sqs = [sq('e2', 'Norfolk: last 2 places', '2026-11-05'), sq('e0', 'Autumn in the Peak District', '2026-10-22')];
  const recs = recsFor([FULL], sqs);
  const rec = recs.find((r) => r.campaign_key === `email|${WEEK}`);
  assert.deepEqual([rec.sqs_email_id, rec.link_source, rec.stage, rec.stage_source], ['e2', 'auto', 'sent', 'auto']);
  assert.equal(rec.results.sent_on, '2026-11-05');
  assert.equal(sendsFromRecords(recs, TODAY, campaignRules()).emails_sent, 0, 'auto-found sends are not counted as full-list sends');
  const st = stepState(EMAIL, base({ sqs, recordsByKey: new Map([[rec.campaign_key, rec]]) }));
  assert.equal(st.status, 'auto_done');
  assert.match(st.evidence, /Norfolk: last 2 places.*matched on audience \+ subject/);
  assert.equal(st.at, '2026-11-05T09:55:00Z');
});

test('a subject naming a lead date is not enough: no audience chosen, or a send to another list, never completes the weekly email', () => {
  const lr = sq('e1', 'Lightroom starts Thursday — save 30%', '2026-11-08', ['LR30 - local beginners - opened 6 months - 8 Nov 2026']);
  assert.equal(stepState(EMAIL, base({ sqs: [lr] })).status, 'late', 'no record / no audience chosen');
  const seg = { campaign_key: `email|${WEEK}`, audience: 'segments', segment_ids: ['s1'] };
  const aud = { segments: [{ segment_id: 's1', name: 'Past Norfolk clients' }], exports: [{ export_id: 'x1', campaign_key: `email|${WEEK}`, list_name: 'ARP | Weekly | Past Norfolk clients | 2026-11-05' }] };
  assert.equal(matchEmail(EMAIL, seg, { sqs: [lr], audience: aud }).length, 0, 'sent to a different segment');
  const ok = matchEmail(EMAIL, seg, { sqs: [sq('e3', 'This week', '2026-11-05', ['ARP | Weekly | Past Norfolk clients | 2026-11-05'])], audience: aud });
  assert.deepEqual(ok.map((m) => m.why), ['audience'], 'its own export list matches');
});

test('Lightroom split: a send linked to the event campaign is its own done step; the weekly email stays Proposed / not sent', () => {
  const lr = { ...sq('6af0430760d4554034f08d7d', 'Lightroom starts Thursday — save 30% when you book today', '2026-11-08', ['LR30 - local beginners - opened 6 months - 8 Nov 2026']), sent_at: '2026-11-08T09:55:31.915+00:00', message_count: 39, delivered: 39, opened: 6, clicked: 0, unsubscribed: 0, campaign_key: 'event|2026-11-12|/lightroom' };
  const eventRow = { campaign_key: 'event|2026-11-12|/lightroom', kind: 'event', title: 'Lightroom Classic Photo Editing Classes - Week 1 of 3 -12-11', event_key: '2026-11-12|/lightroom', stage: 'sent', sqs_email_id: lr.email_id, actual_sends: 39, sent_on: '2026-11-08', stage_history: [{ stage: 'sent', by: 'Alan via GPT', at: '2026-11-08T09:58:12Z' }] };
  const weeklyFull = { ...FULL };
  const recs = recsFor([eventRow, weeklyFull], [lr]);
  const weekly = recs.find((r) => r.kind === 'weekly_email');
  assert.deepEqual([weekly.stage, weekly.sqs_email_id, weekly.auto_matches.length], ['proposed', null, 0], 'even with the full list chosen, an event-linked send is not the weekly email');
  const weeks = [{ week: WEEK, steps: [{ ...EMAIL }, { ...POST }] }];
  const ctx = base({ sqs: [lr], recordsByKey: new Map(recs.map((r) => [r.campaign_key, r])), sqsById: new Map([[lr.email_id, lr]]), ...emailLinks([eventRow, weeklyFull]) });
  addTargetedSteps(weeks, recs, [eventRow, weeklyFull], ctx.sqsById);
  const { summary } = applyStepStatus(weeks, ctx, []);
  const t = weeks[0].steps.find((s) => s.targeted);
  assert.equal(t.step, 'Lightroom targeted email: sent 8 Nov 09:55 · 39 · LR30 segment');
  assert.deepEqual([t.state.status, t.state.by, t.link.email_id, t.link.campaign_key], ['done', 'Alan via GPT', lr.email_id, 'event|2026-11-12|/lightroom']);
  assert.match(t.state.evidence, /39 sent · 39 delivered · 6 opened · 0 clicked/);
  assert.equal(weeks[0].steps.find((s) => s.is_email).state.status, 'late', 'weekly email not done');
  assert.equal(weeks[0].steps.find((s) => s.channel === 'Facebook + Instagram').state.status, 'late', 'social post not done');
  assert.equal(summary.targeted_done, 1);
  assert.equal(registerRows(WEEK, weeks[0].steps, 'p', 'now').some((r) => r.step_key.includes('targeted')), false, 'evidence steps are not registered');
});

test('sent audience snapshot: list names + count, DELIVERED recipients as person ids only', () => {
  const list = sentListPart({ email_id: 'e', mailing_list_names: ['LR30 - x'], message_count: 40, sent_on: '2026-11-08' }, { actual_sends: 39 }, 'T');
  assert.deepEqual([list.sends, list.list_names], [39, ['LR30 - x']]);
  const r = recipientsPart([{ email: 'A@x.com' }, { email: 'b@x.com' }, { email: 'a@x.com' }, { email: 'c@x.com' }], [{ person_id: 'p1', email: 'a@x.com' }, { person_id: 'p2', email: 'b@x.com' }], 'T');
  assert.deepEqual([r.count, r.person_ids, r.unmatched], [3, ['p1', 'p2'], 1]);
  assert.ok(!JSON.stringify(r).includes('@'), 'no emails stored');
});

test('ambiguous: two sends to the chosen audience → "link this email?", never guessed, record not linked', () => {
  const sqs = [sq('a', 'Norfolk: last 2 places', '2026-11-05'), sq('b', 'Another full-list email', '2026-11-07')];
  const recs = recsFor([FULL], sqs);
  const rec = recs.find((r) => r.kind === 'weekly_email');
  assert.equal(rec.sqs_email_id, null);
  assert.equal(rec.auto_matches.length, 2);
  const st = stepState(EMAIL, base({ sqs, recordsByKey: new Map([[rec.campaign_key, rec]]) }));
  assert.equal(st.status, 'ask');
  assert.deepEqual(st.candidates.map((c) => c.email_id), ['a', 'b']);
  assert.equal(st.resolved, false);
});

test('a send linked to any other record is not evidence; a send outside the week is ignored', () => {
  const rows = [{ campaign_key: 'email|2026-10-26', kind: 'weekly_email', sqs_email_id: 'a' }];
  const sqs = [sq('a', 'Norfolk: last 2 places', '2026-11-02'), sq('c', 'Norfolk next week', '2026-11-09')];
  const ctx = base({ sqs, recordsByKey: new Map([[FULL.campaign_key, FULL]]), ...emailLinks(rows) });
  assert.equal(stepState(EMAIL, ctx).status, 'late');
});

test('Google Business: weekly check from w/c 9 Nov (manual, late = amber); one optional exception per campaign, never repeated', () => {
  const rules = campaignRules();
  const ev = { title: 'Woodland Photography Walk | Solihull | Hay Woods - Winter', date: '2026-12-04', kind: 'day', event_key: 'hay', offer: { note: '20% off', code: 'HAY20', ends: '2026-11-20' } };
  const lt = { day: { announce_weeks: 4, main_push_weeks: 3, last_places_weeks: 1 } };
  const weeks = campaignWeeks(buildMoments([ev], lt, '2026-11-09'), '2026-11-09', 4, rules);
  const checks = weeks.flatMap((w) => w.steps).filter((s) => s.step === 'Google Business check (5–10 min)');
  assert.deepEqual(checks.map((s) => s.day), ['2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30']);
  const ex = weeks.flatMap((w) => w.steps).filter((s) => s.gbp === 'exception');
  assert.equal(ex.length, 1, 'one per campaign');
  assert.equal(ex[0].key, 'step|gbp|hay');
  assert.match(ex[0].step, /^Google Business update: 20% off · Hay Woods walk Fri 4 Dec/);
  assert.equal(stepState({ ...ex[0], scheduled_day: '2026-11-01' }, base({ listed: new Set(['hay']) })).status, 'pending', 'optional: never late');
  assert.equal(stepState(ex[0], base({ listed: new Set(['hay']), places: new Map([['hay', { booked: 8, cap: 8 }]]) })).status, 'not_needed', 'sold out: not needed');
  const repeat = [{ week: '2026-11-16', steps: [{ ...ex[0] }] }];
  dropRepeats(repeat, [{ step_key: 'step|gbp|hay', week_start: '2026-11-09' }]);
  assert.equal(repeat[0].steps.length, 0, 'not repeated after its first week');
  assert.equal(campaignWeeks([], TODAY, 1, rules)[0].steps.some((s) => s.gbp), false, 'nothing before w/c 9 Nov');
  const check = { ...checks[0], week: '2026-11-09' };
  assert.equal(stepState(check, base({ today: '2026-11-10' })).status, 'late');
  assert.equal(stepState(check, base({ today: '2026-11-10', ticks: { [check.key]: { is_ticked: true, set_by: 'Alan (dashboard)' } } })).status, 'done');
});

test('Google Business evidence: posts and reviews counted, no content kept', () => {
  const now = Date.parse('2026-11-08T12:00:00Z');
  const posts = [{ createTime: '2026-11-08T11:26:25Z', topicType: 'EVENT', state: 'LIVE', summary: 'x' }, { createTime: '2026-10-01T10:00:00Z', topicType: 'STANDARD', state: 'LIVE' }];
  const g = summarisePosts(posts, { totalReviewCount: 293, averageRating: 4.900000095, reviews: [{ createTime: '2026-11-04T22:55:07Z', comment: 'secret' }] }, now);
  assert.deepEqual([g.reachable, g.last_post_at, g.posts_28d, g.reviews.total, g.reviews.average], [true, '2026-11-08T11:26:25Z', 1, 293, 4.9]);
  assert.ok(!JSON.stringify(g).includes('secret'));
});

test('event step for a date that has since sold out / been withdrawn / cancelled → not needed with the reason', () => {
  const sold = stepState(POST, base({ places: new Map([[NORFOLK.event_key, { booked: 6, cap: 6 }]]) }));
  assert.equal(sold.status, 'not_needed');
  assert.match(sold.reason, /Norfolk 20–22 Nov sold out \(6 of 6 booked\)/);
  assert.equal(sold.resolved, true);
  assert.match(stepState(POST, base({ listed: new Set(['other']) })).reason, /withdrawn \(no longer listed/);
  assert.match(stepState(POST, base({ cancelled: new Map([[NORFOLK.event_key, 'weather']]) })).reason, /cancelled \(weather\)/);
  const two = { ...POST, featured: [NORFOLK, { name: 'Lightroom course', date: '2026-11-12', event_key: 'lr' }] };
  assert.equal(stepState(two, base({ listed: new Set(['lr']), places: new Map([[NORFOLK.event_key, { booked: 6, cap: 6 }]]) })).status, 'late', 'still needed while one featured date is on');
  assert.equal(stepState(POST, base({ listed: new Set() })).status, 'late', 'empty site feed never marks everything withdrawn');
});

test('manual step: done (who + when), skipped (reason), moved (not late until the new day), late / older thresholds', () => {
  const done = stepState(POST, base({ ticks: { [`${POST.key}|fb`]: { is_ticked: true, set_by: 'ChatGPT', set_at: '2026-11-07T10:00:00Z' } } }));
  assert.deepEqual([done.status, done.by, done.at], ['done', 'ChatGPT', '2026-11-07T10:00:00Z']);
  const skip = stepState(POST, base({ ticks: { [POST.key]: { is_ticked: false, status: 'skipped', reason: 'no image yet', set_by: 'Alan (dashboard)' } } }));
  assert.deepEqual([skip.status, skip.reason, skip.resolved], ['skipped', 'no image yet', true]);
  assert.equal(stepState(POST, base({ ticks: { [POST.key]: { moved_to: '2026-11-10' } } })).status, 'pending');
  const late = stepState(POST, base());
  assert.deepEqual([late.status, late.label], ['late', 'late · planned Fri 6 Nov']);
  assert.equal(stepState({ ...POST, scheduled_day: '2026-10-23' }, base()).status, 'older');
  assert.equal(stepState({ ...POST, scheduled_day: '2026-10-25' }, base()).status, 'late', '14 days past is still late');
});

test('quarter actions: Pick n Mix launch newsletter waits for the relaunch email from 10 Nov; others stay manual', () => {
  const pnm = { key: 'plan|14', week: WEEK, plan_id: 14, channel: 'Quarter action', step: 'Pick n Mix launch newsletter', scheduled_day: WEEK, day: TODAY, covers: [], featured: [] };
  assert.equal(stepState(pnm, base({ sqs: [sq('x', 'Pick n Mix is back', '2026-11-07')] })).status, 'awaiting', 'an email before 10 Nov is not the relaunch');
  assert.equal(stepState(pnm, base({ today: '2026-11-11' })).status, 'late');
  const hit = stepState(pnm, base({ today: '2026-11-11', sqs: [{ ...sq('y', "Pick 'n' Mix plans relaunch", '2026-11-10'), message_count: 127 }] }));
  assert.equal(hit.status, 'auto_done');
  assert.equal(stepState(pnm, base({ today: '2026-11-11', sqs: [sq('z', "Pick 'n' Mix plans relaunch", '2026-11-10')] })).status, 'late', 'a report with no recipients is not a send');
  assert.equal(stepState({ ...pnm, step: 'Christmas gift push for beginners course' }, base()).status, 'late');
  const manual = new Map([['14', { action_key: 'q1-pnm-newsletter', label: 'Pick n Mix launch newsletter', is_ticked: true, ticked_at: 't' }]]);
  assert.equal(stepState(pnm, base({ actionsById: manual })).status, 'awaiting', 'a hand tick never stands in for the send evidence');
  assert.equal(stepState(pnm, base({ actionsById: manual, ticks: { 'plan|14': { is_ticked: true } } })).status, 'awaiting');
  const gift = { ...pnm, plan_id: 15, step: 'Christmas gift push for beginners course' };
  assert.equal(stepState(gift, base({ actionsById: new Map([['15', { action_key: 'q1-xmas-gift', label: gift.step, is_ticked: true, ticked_at: 't' }]]) })).status, 'done', 'actions with no evidence rule stay manual');
});

test('backfill + register: dropped this-week step → not needed; earlier weeks → late or older; counts for tile 7', () => {
  const reg = (key, week, day, featured = []) => ({ step_key: key, week_start: week, scheduled_day: day, channel: 'Facebook + Instagram', step: 'Post', covers: [], featured, lead_names: [] });
  const register = [
    reg(`step|${WEEK}|Facebook + Instagram|2026-11-06|1`, WEEK, '2026-11-06', [{ name: 'Gone walk', date: '2026-11-28', event_key: 'gone' }]),
    reg('step|2026-10-26|LinkedIn|2026-10-28', '2026-10-26', '2026-10-28'),
    reg('step|2026-10-19|LinkedIn|2026-10-21', '2026-10-19', '2026-10-21')
  ];
  const weeks = [{ week: WEEK, steps: [{ ...EMAIL }, { ...POST }] }];
  const { carried, summary } = applyStepStatus(weeks, base({ sqs: [sq('e1', 'Weekly email', '2026-11-08')], recordsByKey: new Map([[FULL.campaign_key, FULL]]) }), register);
  const dropped = weeks[0].steps.find((s) => s.key.endsWith('|1'));
  assert.equal(dropped.state.status, 'not_needed');
  assert.match(dropped.state.reason, /Gone walk.*withdrawn/);
  assert.deepEqual([carried.late.length, carried.older.length], [1, 1]);
  assert.equal(summary.auto_done, 1);
  assert.equal(summary.late, 2);
  assert.equal(summary.late_campaign, 2);
  assert.equal(summary.older, 1);
  assert.equal(summary.not_needed, 1);
});

test('manual register rows (GPT drafts) are never dropped; future ones join their week or carried.future', () => {
  const reg = (key, week, day) => ({ step_key: key, week_start: week, scheduled_day: day, channel: 'Facebook + Instagram', step: 'GPT post', covers: [], featured: [], lead_names: [] });
  const register = [
    reg('gpt-8w-social-2026-11-06-fbig', WEEK, '2026-11-06'),
    reg('gpt-8w-social-2026-11-10-fbig', '2026-11-09', '2026-11-10'),
    reg('gpt-8w-social-2026-12-22-fbig', '2026-12-21', '2026-12-22'),
    reg('step|2026-11-09|LinkedIn|2026-11-11', '2026-11-09', '2026-11-11')
  ];
  const weeks = [{ week: WEEK, steps: [{ ...POST }] }, { week: '2026-11-09', steps: [] }];
  const { carried, summary } = applyStepStatus(weeks, base({ today: '2026-11-05' }), register);
  const mine = weeks[0].steps.find((s) => s.key === 'gpt-8w-social-2026-11-06-fbig');
  assert.deepEqual([mine.manual, mine.state.status, mine.state.resolved], [true, 'pending', false], 'manual: not "dropped from the plan"');
  assert.deepEqual(weeks[1].steps.map((s) => s.key), ['gpt-8w-social-2026-11-10-fbig'], 'a future generated row is not resurrected');
  assert.deepEqual(carried.future.map((s) => s.key), ['gpt-8w-social-2026-12-22-fbig'], 'beyond the generated weeks');
  assert.equal(summary.not_needed || 0, 0);
});

test('cancelled stays cancelled: the cancelled weekly email record resolves its step after every rebuild', () => {
  const cancelled = { campaign_key: `email|${WEEK}`, kind: 'weekly_email', stage: 'cancelled', stored: true, audience: null };
  for (let run = 0; run < 2; run += 1) {
    const weeks = [{ week: WEEK, steps: [{ ...EMAIL }] }];
    applyStepStatus(weeks, base({ recordsByKey: new Map([[cancelled.campaign_key, cancelled]]) }), registerRows(WEEK, [EMAIL], 'p', 't'));
    assert.deepEqual([weeks[0].steps[0].state.status, weeks[0].steps[0].state.resolved], ['not_needed', true]);
    assert.match(weeks[0].steps[0].state.reason, /cancelled/);
  }
});

test('ticks API: who (Alan / ChatGPT), skip needs a reason, untick and move are logged', () => {
  assert.equal(whoOf({}), 'Alan (dashboard)');
  assert.equal(whoOf({ via: 'chatgpt' }), 'ChatGPT');
  assert.throws(() => statusPatch('skipped', ''), /reason/);
  assert.throws(() => statusPatch('maybe', 'x'));
  const ctx = { propertyUrl: 'p', by: 'Alan (dashboard)', now: 'T2' };
  const prev = new Map([['step|a', { tick_key: 'step|a', is_ticked: true, status: 'done', history: [{ action: 'done', by: 'ChatGPT', at: 'T1' }] }]]);
  const [untick] = patchedRows(['step|a'], prev, patchFor({ is_ticked: false }, 'T2').patch, ctx);
  assert.deepEqual([untick.is_ticked, untick.status, untick.set_by, untick.history.map((h) => h.action)], [false, null, 'Alan (dashboard)', ['done', 'untick']]);
  const [skip] = patchedRows(['step|a'], new Map(), patchFor({ status: 'skipped', reason: 'no image' }, 'T2').patch, ctx);
  assert.deepEqual([skip.status, skip.reason, skip.history[0].action], ['skipped', 'no image', 'skipped']);
  const [move] = patchedRows(['step|a'], new Map(), patchFor({ moved_to: '2026-11-10' }, 'T2').patch, ctx);
  assert.deepEqual([move.moved_to, move.history[0].action, move.is_ticked], ['2026-11-10', 'move', false]);
});

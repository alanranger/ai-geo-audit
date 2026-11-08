/**
 * Strategy vs Marketing consistency (question 2026-11-08 items 2, 3, 6, 7, 8): the next campaign is the next stored
 * unsent campaign (never a generated placeholder); initiative next actions come from linked deliveries (stored text only
 * as "manual"); Pick n Mix opportunities are running beginners courses with bookings, every other course state apart.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { nextActionOf, nextCampaignOf, unknownTargetOf } from '../lib/strategy-initiatives.mjs';
import { beginnersCourses, courseState, isConfirmedCourse } from '../lib/strategy-insights/mix.mjs';
import { applyMovedTicks } from '../lib/strategy-action-evidence.mjs';

const NOW = '2026-11-08T18:40:00Z';
const ROWS = [
  { campaign_key: 'email|2026-11-02', kind: 'weekly_email', stage: 'proposed', planned_send_on: '2026-11-08' },
  { campaign_key: 'theme|norfolk-workshops-8nov', kind: 'theme', stage: 'sent', sent_on: '2026-11-08', actual_sends: 311, scheduled_for: '2026-11-08T17:00:00Z' },
  { campaign_key: 'theme|pick-n-mix-kick-starter-2026-11', title: 'Pick n Mix Kick-Starter relaunch', kind: 'theme', stage: 'scheduled', planned_send_on: '2026-11-10', scheduled_for: '2026-11-10T10:00:00Z', schedule_evidence: 'operator_verified' },
  { campaign_key: 'theme|return-to-photography-9nov', title: 'Something to inspire your next photograph', kind: 'theme', stage: 'scheduled', scheduled_for: '2026-11-09T10:00:00Z', schedule_evidence: 'operator_verified' },
  { campaign_key: 'theme|old', kind: 'theme', stage: 'superseded', planned_send_on: '2026-11-09' },
  { campaign_key: 'theme|gpt-8w-2026-11-19', kind: 'theme', stage: 'drafted', planned_send_on: '2026-11-19' }
];

test('next campaign = Mon 9 Nov "Something to inspire", then Tue 10 Nov Pick n Mix; never the proposed placeholder, a sent or a superseded record', () => {
  const n = nextCampaignOf(ROWS, NOW);
  assert.deepEqual([n.campaign_key, n.day, n.provider_scheduled, n.then.campaign_key, n.then.day], ['theme|return-to-photography-9nov', '2026-11-09', true, 'theme|pick-n-mix-kick-starter-2026-11', '2026-11-10']);
  assert.equal(nextCampaignOf(ROWS, '2026-11-10T11:00:00Z').campaign_key, 'theme|gpt-8w-2026-11-19');
});

test('Pick n Mix date: the tick moved_to (plan|14 → 10 Nov) replaces the stored due date in every view; evidence untouched', () => {
  const [a] = applyMovedTicks([{ id: 14, due_week_start: '2026-11-02', is_ticked: false, evidence: { state: 'waiting' } }], new Map([['plan|14', '2026-11-10']]));
  assert.deepEqual([a.due_week_start, a.planned_due, a.evidence.state, a.due_week_start < '2026-11-09'], ['2026-11-10', '2026-11-02', 'waiting', false]);
});

test('initiative next action from linked deliveries (actual before recommendations); stored text only as "manual"', () => {
  const gifts = { next_action: 'Gift email', next_action_date: '2026-11-16' };
  const d = [
    { key: 'step|2026-11-09|Facebook + Instagram|2026-11-10', day: '2026-11-10', channel: 'Facebook + Instagram', title: 'Post: rule', status: 'pending' },
    { key: 'gpt-8w-social-2026-11-17-fbig', day: '2026-11-17', channel: 'Facebook + Instagram', title: 'A photography gift without guessing the equipment', status: 'pending', draft: true },
    { key: 'send|theme|gpt-8w-2026-11-26', day: '2026-11-26', channel: 'Squarespace email (targeted)', title: 'A photography gift they can choose for themselves', status: 'drafted', draft: true },
    { key: 'send|theme|sent', day: '2026-11-08', channel: 'Squarespace email (targeted)', title: 'old', status: 'sent', sent: true }
  ];
  const n = nextActionOf(gifts, d, '2026-11-08');
  assert.deepEqual([n.source, n.day, n.text, n.then.day, n.then.text], ['plan', '2026-11-17', 'FB/IG draft: A photography gift without guessing the equipment', '2026-11-26', 'Email draft: A photography gift they can choose for themselves']);
  assert.equal(nextActionOf(gifts, [d[0]], '2026-11-08').source, 'recommended');
  assert.deepEqual(nextActionOf(gifts, [], '2026-11-08'), { source: 'manual', day: '2026-11-16', text: 'Gift email', then: null, linked: 0 });
});

test('unknown target: owner, next step and due date; never an invented target', () => {
  const ini = { owner: 'GPT', owner_detail: 'GPT (targeting) · Claude (capacity)', review_date: '2026-11-16' };
  assert.deepEqual(unknownTargetOf(ini, { label: 'Target not set' }, null), { owner: 'GPT (targeting) · Claude (capacity)', next_step: 'propose a dated target from actuals for Alan to approve', due: '2026-11-16' });
  assert.equal(unknownTargetOf(ini, { label: 'In progress' }, null), null);
});

test('Pick n Mix opportunities: not-promoted (override keyed date|url) and 0-booked courses are never confirmed; 13 Jan with a booking is', () => {
  const dont = new Set(['2026-11-09|/beginners/oct1', '2026-12-01|/beginners/wc34j']);
  const diary = [
    { type: 'course', title: 'Camera Courses For Beginners - 3-week beginners', date: '2026-11-09', url: '/beginners/oct1', eventKey: '2026-11-09|course|camera', booked: 0 },
    { type: 'course', title: 'Camera Courses For Beginners - 3-week beginners', date: '2026-12-01', url: '/beginners/wc34j', eventKey: '2026-12-01|course|camera', booked: 0 },
    { type: 'course', title: 'Camera Courses For Beginners - 3-week beginners', date: '2027-01-13', url: '/beginners/bds4t', eventKey: '2027-01-13|course|camera', booked: 1 },
    { type: 'course', title: 'Camera Courses For Beginners - 3-week beginners', date: '2027-02-10', url: '/beginners/x', eventKey: 'x', booked: 0 }
  ];
  const list = beginnersCourses(diary, '2026-11-08', dont);
  assert.deepEqual(list.map((c) => [c.start, c.state, isConfirmedCourse(c)]), [['2026-11-09', 'not_promoted', false], ['2026-12-01', 'not_promoted', false], ['2027-01-13', 'running', true], ['2027-02-10', 'running', false]]);
  assert.deepEqual([courseState({ full: true }, dont), courseState({ cancelled: true }, dont), courseState({ withdrawn: true }, dont)], ['sold_out', 'cancelled', 'withdrawn']);
});

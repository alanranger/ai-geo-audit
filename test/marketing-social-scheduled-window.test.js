/**
 * Social status (question 2026-11-09 social-status-operator-verified-and-meta-window), synthetic fixtures:
 * operator-verified provider scheduling (queue read-back, no ID) = Scheduled on platform; a queue URL is never
 * publication; Published only with provider evidence (Meta collector post at the planned time, GPT live check);
 * Meta's 29-day window; Stories as their own task; the Kick-Starter hold; approved art never re-asked.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { STORY_OWNER, holdOf, isPublishedPlacement, operatorScheduled, placementStatus } from '../lib/marketing/delivery-status.mjs';
import { isPublished, releaseSplit } from '../lib/marketing/decision-state.mjs';
import { storyTasks, windowTasks } from '../lib/marketing/delivery-status-board.mjs';

const NOW = Date.parse('2026-11-09T16:00:00Z');
const APPROVED = { approval: 'Main artwork approved by Alan, 9 November 2026' };
const queued = (over = {}) => ({
  step_key: 'gpt-8w-social-2026-11-11-li', placement: 'linkedin_feed', stage: 'scheduled', platform_state: 'scheduled', provider_id: null,
  provider_url: 'https://www.linkedin.com/feed/foryou/', planned_at: '2026-11-11T08:30:00Z', actual_at: null, public_caption: 'x', link_url: 'https://www.alanranger.com/photography-payment-plan',
  assets: { editorial: APPROVED, main: { storage_path: 'a.png' } },
  evidence: [{ at: '2026-11-09T15:47:40Z', by: 'GPT', kind: 'manual', text: 'Provider scheduled queue read back', source: 'LinkedIn native Scheduled (8) queue' }], ...over
});
const META_FB = queued({ step_key: 'gpt-8w-social-2026-11-10-fbig', placement: 'facebook_feed', provider_url: 'https://business.facebook.com/latest/content_calendar', planned_at: '2026-11-10T18:30:00Z', evidence: [{ by: 'GPT', text: 'verified', source: 'Meta Scheduled content queue' }] });
const NORFOLK_LI = { step_key: 'gpt-event-2026-11-09-norfolk-li', placement: 'linkedin_feed', stage: 'live_check', platform_state: 'published', provider_id: '7525483905408335872', provider_url: 'https://www.linkedin.com/feed/update/urn:li:activity:7525483905408335872/', planned_at: '2026-11-09T08:30:00Z', actual_at: '2026-11-09T09:06:19Z', evidence: [{ by: 'GPT', action: 'live_post_verified', at: '2026-11-09T09:06:19Z', screenshot: 'x.png' }] };
const windowed = (over = {}) => ({ step_key: 'gpt-8w-social-2026-12-22-fbig', placement: 'instagram_feed', stage: 'preview_review', platform_state: 'app_draft', provider_id: null, provider_url: null, planned_at: '2026-12-22T18:30:00Z', public_caption: 'x', link_url: 'https://x', assets: { editorial: { ...APPROVED, provider_schedule_eligible_at: '2026-11-23T18:30:00.000Z' }, main: { storage_path: 'b.png' } }, evidence: [], ...over });
const story = (over = {}) => ({ step_key: 'gpt-8w-social-2026-11-10-fbig', placement: 'instagram_story', stage: 'preview_review', platform_state: 'app_draft', provider_id: null, provider_url: null, planned_at: '2026-11-10T18:30:00Z', public_caption: 'x', link_url: 'https://www.alanranger.com/photo-workshops-uk/abstract-and-macro-photography-workshops', assets: { editorial: { main_artwork_approval: 'approved' }, story: { storage_path: 'stories/story-2026-11-10.png' } }, evidence: [], ...over });
const HOLD = 'Hold: confirm Kick-Starter appointment availability before scheduling';
const kick = (over = {}) => windowed({ step_key: 'gpt-8w-social-2026-12-14-fbig', placement: 'facebook_feed', planned_at: '2026-12-14T12:30:00Z', assets: { editorial: { ...APPROVED, provider_schedule_eligible_at: '2026-11-15T12:30:00.000Z', scheduling_status: HOLD }, main: { storage_path: 'c.png' } }, ...over });

test('operator-verified provider scheduling (queue read-back, no ID) = Scheduled on platform, never an invented ID', () => {
  const s = placementStatus(queued(), { now: NOW });
  assert.equal(s.code, 'scheduled');
  assert.equal(s.label, 'Scheduled on platform');
  assert.equal(s.when, 'LinkedIn Wed 11 Nov 8:30am');
  assert.equal(s.evidence, 'verified by GPT in the native queue (no ID available)');
  assert.doesNotMatch(JSON.stringify(s), /urn:li|scheduled post \d/);
  assert.equal(placementStatus(META_FB, { now: NOW }).when, 'Facebook Tue 10 Nov 6:30pm');
});

test('plain planned / approved rows never show Scheduled: no queue evidence, no queue URL, or not on the platform', () => {
  assert.equal(operatorScheduled(queued({ evidence: [] })), false);
  assert.equal(operatorScheduled(queued({ provider_url: null })), false);
  assert.notEqual(placementStatus(queued({ platform_state: 'app_draft', stage: 'preview_review' }), { now: NOW }).code, 'scheduled');
  assert.notEqual(placementStatus(queued({ evidence: [{ by: 'GPT', text: 'artwork approved' }] }), { now: NOW }).code, 'scheduled');
});

test('a queue URL is not publication: scheduled ≠ published in the status AND the decision state; Norfolk stays Published', () => {
  for (const p of [queued(), META_FB]) {
    assert.equal(isPublishedPlacement(p), false);
    assert.equal(isPublished(p), false, 'decision state uses the same rule');
  }
  assert.equal(isPublished(NORFOLK_LI), true);
  const s = placementStatus(NORFOLK_LI, { now: NOW });
  assert.equal(s.code, 'published');
  assert.match(s.evidence, /verified by GPT live check/);
});

test('after its time: checking until provider evidence; the Meta collector post at the planned time = Published', () => {
  const after = Date.parse('2026-11-10T18:45:00Z');
  const meta = { ok: true, last_ok_at: '2026-11-10T18:40:00Z' };
  assert.equal(placementStatus(META_FB, { now: after, meta }).code, 'checking');
  const recent = [{ channel: 'facebook', post_id: '123_456', posted_at: '2026-11-10T18:30:04Z', permalink: 'https://www.facebook.com/123/posts/456', collected_at: '2026-11-10T18:40:00Z' }];
  const s = placementStatus(META_FB, { now: after, meta, recent });
  assert.equal(s.code, 'published');
  assert.equal(s.link, 'https://www.facebook.com/123/posts/456');
  assert.match(s.evidence, /seen by the Meta collector/);
  assert.equal(placementStatus({ ...META_FB, placement: 'instagram_feed' }, { now: after, meta, recent }).code, 'checking', 'another channel\'s post is not this one');
  assert.equal(placementStatus(queued(), { now: Date.parse('2026-11-11T09:00:00Z') }).code, 'checking', 'LinkedIn waits for GPT\'s live check');
});

test('Meta\'s window: "Ready, waiting for Meta\'s window · schedule from {date}"; not an approval, not Alan\'s', () => {
  const s = placementStatus(windowed(), { now: NOW, open: new Set(['gpt-8w-social-2026-12-22-fbig']) });
  assert.equal(s.code, 'waiting_window');
  assert.equal(s.label, 'Ready, waiting for Meta\'s window');
  assert.equal(s.when, 'schedule from Mon 23 Nov 6:30pm');
  assert.match(placementStatus(windowed(), { now: Date.parse('2026-11-24T09:00:00Z') }).when, /GPT schedules it now/);
});

test('GPT task on each eligible date: "Schedule {n} Meta posts now in window"; done once scheduled; held posts excluded', () => {
  const pls = [windowed(), windowed({ placement: 'facebook_feed' }), kick(), story()];
  const held = new Map([['gpt-8w-social-2026-12-14-fbig', HOLD]]);
  const ts = windowTasks(pls, held);
  assert.equal(ts.length, 1);
  assert.deepEqual([ts[0].day, ts[0].title, ts[0].owner, ts[0].status.code], ['2026-11-23', 'Schedule 2 Meta posts now in window', 'GPT', 'due']);
  const done = windowTasks([windowed({ platform_state: 'scheduled' }), windowed({ placement: 'facebook_feed', platform_state: 'scheduled' })]);
  assert.equal(done[0].status.code, 'done');
});

test('Story: its own status and task on its day (PNG + link one click away), separate from artwork approval and scheduling', () => {
  const s = placementStatus(story(), { now: NOW });
  assert.equal(s.code, 'story_ready');
  assert.match(s.blocker, /^link sticker https:\/\/www\.alanranger\.com\//);
  const [t] = storyTasks([story(), queued()], new Map([['gpt-8w-social-2026-11-10-fbig', 'What focus bracketing actually helps with']]), new Map([['stories/story-2026-11-10.png', 'https://signed/png']]), { now: NOW });
  assert.equal(t.day, '2026-11-10');
  assert.equal(t.title, 'Post Instagram Story: What focus bracketing actually helps with, link sticker https://www.alanranger.com/photo-workshops-uk/abstract-and-macro-photography-workshops');
  assert.deepEqual([t.owner, t.png, t.type], [STORY_OWNER, 'https://signed/png', 'story_publish']);
  assert.equal(STORY_OWNER, 'GPT', 'Alan, 9 Nov: uploading and posting Stories are GPT\'s job');
});

test('Kick-Starter hold: 🔒 "Conditional: 14 Dec Kick-Starter · needs a session available before 15 Dec" (its Story too)', () => {
  const s = placementStatus(kick(), { now: NOW });
  assert.deepEqual([s.code, s.icon, s.label, s.blocker], ['conditional', '🔒', 'Conditional: 14 Dec Kick-Starter', 'needs a session available before 15 Dec']);
  const held = new Map([['gpt-8w-social-2026-12-14-fbig', HOLD]]);
  assert.equal(placementStatus(story({ step_key: 'gpt-8w-social-2026-12-14-fbig', planned_at: '2026-12-14T12:30:00Z' }), { now: NOW, held }).code, 'conditional');
  assert.equal(holdOf(windowed()), null);
});

test('approved content never becomes a new approval for Alan: scheduled, Story and approved-art rows are not release decisions', () => {
  const steps = new Map([['gpt-8w-social-2026-11-10-fbig', { title: 'Focus' }], ['plain', { title: 'Plain' }]]);
  const plain = { step_key: 'plain', placement: 'facebook_feed', stage: 'prepare', platform_state: 'app_draft', planned_at: '2026-11-10T18:30:00Z', public_caption: 'x', link_url: 'https://x', assets: { editorial: {}, main: { storage_path: 'p.png' } } };
  const approvedUnscheduled = { ...plain, step_key: 'gpt-8w-social-2026-11-10-fbig', assets: { editorial: APPROVED, main: { storage_path: 'p.png' } } };
  const { ready } = releaseSplit([META_FB, story(), approvedUnscheduled, plain], steps, '2026-11-09');
  assert.deepEqual(ready.map((r) => r.step_key), ['plain'], 'only an unapproved, ready post asks Alan');
  assert.equal(placementStatus(approvedUnscheduled, { now: NOW }).blocker, 'artwork approved by Alan · GPT schedules it');
});

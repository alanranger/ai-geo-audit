/**
 * QUESTION-2026-11-12 121-campaign-placements-not-shown-and-blocked-state, synthetic fixtures: verified provider
 * placements with no campaign step are counted (schedule, by-channel tile, service-mix tiles) as "added"; platform_state
 * blocked is its own amber state (never a draft / waiting / approval) with a GPT task when the allowance resets; the PC
 * collector-silent warning only when a check is expected.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { blockedInfo, placementStatus, resetDayOf } from '../lib/marketing/delivery-status.mjs';
import { releaseSplit } from '../lib/marketing/decision-state.mjs';
import { COLLECTOR_SILENT_MIN, allowanceTasks, collectorHealth } from '../lib/marketing/delivery-status-board.mjs';
import { itemsToTag, tagOf } from '../lib/marketing/service-mix.mjs';

const NOW = Date.parse('2026-11-12T00:50:00Z');
const ED = { topic: 'Zoom one-to-one tuition', blocked: true, service_tier: '1-2-1 & Services', blocked_reason: 'Meta link-post allowance used; resets 1 Dec 2026' };
const fbBlocked = (key, day, over = {}) => ({ step_key: key, placement: 'facebook_feed', stage: 'platform_draft', platform_state: 'blocked', planned_at: `${day}T18:30:00Z`, set_by: 'Claude (Alan verified)', link_url: null, assets: { editorial: ED }, evidence: [], ...over });
const igScheduled = (key, day) => ({ step_key: key, placement: 'instagram_feed', stage: 'scheduled', platform_state: 'scheduled', planned_at: `${day}T18:30:00Z`, set_by: 'Claude (Alan verified)', assets: { editorial: { ...ED, blocked: false } }, evidence: [{ by: 'Alan (via Claude)', kind: 'manual', text: 'Alan verified in the native queue', source: 'Meta native Scheduled posts' }] });
const KEYS = [['alan-121-2026-12-02-zoom-ig', '2026-12-02'], ['alan-121-2026-12-09-coventry-ig', '2026-12-09'], ['alan-121-2026-12-10-rps-ig', '2026-12-10']];

test('blocked: amber "Blocked — Meta link allowance · resets Tue 1 Dec", never a draft, waiting or Scheduled', () => {
  const s = placementStatus(fbBlocked(...KEYS[0], { assets: { editorial: { ...ED, provider_schedule_eligible_at: '2026-11-03T18:30:00Z' } } }), { now: NOW });
  assert.deepEqual([s.code, s.tone, s.label, s.when], ['blocked', 'amber', 'Blocked — Meta link allowance', 'resets Tue 1 Dec']);
  assert.equal(s.blocker, 'Meta link-post allowance used; resets 1 Dec 2026');
  assert.equal(resetDayOf('2 more from 1 Dec 2026'), '2026-12-01');
  assert.equal(resetDayOf('no date'), null);
  assert.equal(blockedInfo(fbBlocked(...KEYS[0])).short, 'Meta link allowance');
});

test('a blocked post is never an approval request for Alan', () => {
  const ready = { ...fbBlocked('b', '2026-11-12'), public_caption: 'x', link_url: 'https://x', assets: { editorial: { blocked_reason: 'Meta link-post allowance used; resets 1 Dec 2026' }, main: { storage_path: 'a.png' } } };
  assert.deepEqual(releaseSplit([ready], new Map([['b', { title: 'B' }]]), '2026-11-12').ready, []);
});

test('GPT task on the reset day: "Facebook link allowance available again — 3 blocked posts can now be scheduled"', () => {
  const pls = KEYS.map(([k, d]) => fbBlocked(k, d));
  const [before] = allowanceTasks(pls, '2026-11-12');
  assert.deepEqual([before.day, before.owner, before.type, before.title], ['2026-12-01', 'GPT', 'allowance', 'Facebook link allowance available again — 3 blocked posts can now be scheduled']);
  assert.deepEqual([before.status.code, before.status.label], ['deferred', 'From Tue 1 Dec']);
  assert.equal(allowanceTasks(pls, '2026-12-01')[0].status.code, 'due');
  assert.deepEqual(allowanceTasks([fbBlocked('x', '2026-12-02', { assets: { editorial: { blocked_reason: 'refused' } } })], '2026-11-12'), [], 'no task without a stated reset day');
});

test('PC collector: silent only when a check is expected (07:00–22:00 UK, or a request waiting 10+ min)', () => {
  const run = (at) => [{ kind: 'collector', host: 'PC', started_at: at, finished_at: at, heartbeat_at: at }];
  const day = Date.parse('2026-11-12T14:00:00Z');
  assert.equal(collectorHealth(run('2026-11-12T13:40:00Z'), null, day).silent, false, '20 min in hours: fine');
  const s = collectorHealth(run('2026-11-12T13:00:00Z'), null, day);
  assert.equal(s.silent, true, `${COLLECTOR_SILENT_MIN}+ min in check hours`);
  assert.match(s.message, /^PC collector silent \(last run Thu 12 Nov 1:00pm, 60 min ago\) — expected every 15 minutes 07:00–22:00 UK/);
  assert.equal(collectorHealth(run('2026-11-11T22:38:00Z'), null, NOW).silent, false, 'quiet hours, nothing waiting: no warning');
  assert.match(collectorHealth(run('2026-11-11T22:38:00Z'), null, NOW).message, /automatic checks pause 22:00–07:00 UK/);
  const waiting = collectorHealth(run('2026-11-11T22:38:00Z'), { campaign_key: 'dashboard|collect-email-results', due_at: '2026-11-12T00:35:00Z' }, NOW);
  assert.equal(waiting.silent, true, 'a request waiting 15 min overnight');
  assert.match(waiting.message, /"dashboard\|collect-email-results" queued Thu 12 Nov 12:35am is still waiting/);
  assert.equal(collectorHealth([...run('2026-11-12T00:37:47Z'), { started_at: '2026-11-12T00:38:01Z', finished_at: '2026-11-12T00:40:40Z' }], null, NOW).last_at, '2026-11-12T00:40:40Z', 'latest time across runs');
});

test('service mix: an added post with no link counts under 1-2-1 & Services from its stored tier; a link still wins', () => {
  const board = { placements: [{ step_key: 'alan-121-2026-11-18-zoom-li', placement: 'linkedin_feed', unplanned: true, title: 'Zoom one-to-one tuition', service_tier: '1-2-1 & Services', link_url: null }] };
  const items = itemsToTag({ mix: { items: [] }, board, campaign: null });
  assert.deepEqual(items.map((i) => [i.key, i.service_tier]), [['alan-121-2026-11-18-zoom-li', '1-2-1 & Services']]);
  const refs = { product: new Map(), hub: new Map(), event: new Map(), campaigns: new Map(), initiatives: new Map() };
  const t = tagOf(items[0], refs);
  assert.deepEqual([t.row, t.via], ['services', 'stored service tier "1-2-1 & Services" (assets.editorial.service_tier)']);
  assert.equal(tagOf({ key: 'x', service_tier: 'Not a tier' }, refs).row, 'none');
});

function browser(files) {
  const win = {};
  const ctx = vm.createContext({ window: win, document: { getElementById: () => null, querySelector: () => null, head: { insertAdjacentHTML: () => {}, appendChild: () => {} }, createElement: () => ({}) }, Intl, Date, Number, String, Map, Set, JSON, Math, Promise, Array, Object, RegExp, console, setTimeout });
  for (const f of files) vm.runInContext(fs.readFileSync(new URL(f, import.meta.url), 'utf8'), ctx);
  return win;
}
const st = (code, extra = {}) => ({ code, label: code, icon: '', tone: 'grey', ...extra });
const BLOCKED = st('blocked', { label: 'Blocked — Meta link allowance', when: 'resets Tue 1 Dec' });
const added = (key, placement, day, status) => ({ step_key: key, placement, planned_at: `${day}T18:30:00Z`, unplanned: true, title: 'RPS mentoring', service_tier: '1-2-1 & Services', status });
const BOARD = { placements: [
  ...KEYS.map(([k, d]) => added(k, 'facebook_feed', d, BLOCKED)), ...KEYS.map(([k, d]) => added(k, 'instagram_feed', d, st('scheduled'))),
  added('alan-121-2026-11-18-zoom-li', 'linkedin_feed', '2026-11-18', st('scheduled')),
  { step_key: 'superseded-step', placement: 'facebook_feed', planned_at: '2026-11-21T18:30:00Z', status: st('scheduled') }
] };
const WIN = { from: '2026-11-12', to: '2027-02-03' };

test('by-channel tile: added posts count as Sched; Facebook shows "3 Facebook posts blocked — Meta link allowance, resets Tue 1 Dec"', () => {
  const C = browser(['../lib/marketing-channels-tile.js']).mkChannels;
  const ig = C.placementRow([], BOARD, WIN, { place: 'instagram_feed', re: /Instagram/ });
  assert.deepEqual([ig.sched, ig.added, ig.items.every((i) => i.added && i.ref.startsWith('alan-121-'))], [3, 3, true]);
  const li = C.placementRow([], BOARD, WIN, { place: 'linkedin_feed', re: /LinkedIn/ });
  assert.equal(li.sched, 1);
  const fb = C.placementRow([], BOARD, WIN, { place: 'facebook_feed', re: /Facebook/ });
  assert.deepEqual([fb.sched, fb.waiting, fb.drafts, fb.blocked], [0, 0, 0, 3], 'blocked is its own count; the superseded step (no unplanned flag) stays out');
  const win = browser(['../lib/marketing-channels-tile.js']);
  const html = win.mkChannelsTileHtml({ quarter_plan: { purpose_mix: { window: WIN, items: [], deliveries: 0 } }, campaign: { weeks: [] } }, BOARD, '2026-11-12', NOW);
  assert.match(html, /3 Facebook posts blocked — Meta link allowance, resets Tue 1 Dec/);
});

test('schedule: one "added (no campaign step)" row per step key; the List row reads Partly scheduled with the blocked reason', () => {
  const win = browser(['../lib/marketing-schedule-model.js', '../lib/marketing-schedule-list.js']);
  const m = win.mkScheduleModel.build({ items: [], placements: BOARD.placements, today: '2026-11-12' });
  const rows = JSON.parse(JSON.stringify(m.items.filter((x) => x.added).map((x) => [x.row, x.step_key, x.day, x.state])));
  assert.deepEqual(rows, [['fbig', 'alan-121-2026-12-02-zoom-ig', '2026-12-02', 'sch'], ['fbig', 'alan-121-2026-12-09-coventry-ig', '2026-12-09', 'sch'], ['fbig', 'alan-121-2026-12-10-rps-ig', '2026-12-10', 'sch'], ['linkedin', 'alan-121-2026-11-18-zoom-li', '2026-11-18', 'sch']]);
  const x = m.items.find((y) => y.step_key === 'alan-121-2026-12-02-zoom-ig');
  const s = win.mkScheduleList.statusOf(x, { board: BOARD });
  assert.equal(s.label, 'Partly scheduled');
  assert.match(s.blocker, /FB feed blocked — Meta link allowance, resets Tue 1 Dec · IG feed scheduled/);
  const html = win.mkScheduleList.listHtml(m, { range: { from: '2026-11-12', to: '2026-12-31' }, channel: 'all' }, { status: (y) => win.mkScheduleList.statusOf(y, { board: BOARD }), board: BOARD });
  assert.match(html, /added \(no campaign step\)/);
});

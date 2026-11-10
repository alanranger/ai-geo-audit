/**
 * QUESTION-2026-11-10 part 3: a campaign step follows its own social placement at read time. Every feed placement
 * published (provider / GPT live-check evidence, or the Meta collector's post at the planned time) = done
 * automatically; a hand tick / skip always wins; Stories are not the step's; old generated steps GPT's plan replaced
 * are superseded on the server too (so "late" counts and carried lists agree with the Campaign steps table).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { placementIndex, placementState, supersedeReplaced } from '../lib/strategy-step-placements.mjs';
import { applyStepStatus, stepState } from '../lib/strategy-step-status.mjs';

const LI = { step_key: 'gpt-event-2026-11-09-norfolk-li', placement: 'linkedin_feed', stage: 'live_check', platform_state: 'published', provider_id: 'urn:li:activity:1', provider_url: 'https://www.linkedin.com/feed/update/urn:li:activity:1/', planned_at: '2026-11-09T08:30:00Z', actual_at: '2026-11-09T09:06:19Z', evidence: [{ action: 'live_post_verified', by: 'GPT', at: '2026-11-09T09:06:19Z', screenshot: 'x.png' }] };
const meta = (placement) => ({ step_key: 'gpt-8w-social-2026-11-10-fbig', placement, stage: 'scheduled', platform_state: 'scheduled', provider_url: 'https://business.facebook.com/latest/posts/scheduled_posts', planned_at: '2026-11-10T18:30:00Z', actual_at: null, evidence: [{ by: 'GPT', source: 'Meta native Scheduled posts queue' }] });
const POSTS = [
  { post_id: 'fb1', channel: 'facebook', posted_at: '2026-11-10T18:30:04Z', permalink: 'https://www.facebook.com/p/1', collected_at: '2026-11-10T18:51:34Z' },
  { post_id: 'ig1', channel: 'instagram', posted_at: '2026-11-10T18:30:09Z', permalink: 'https://www.instagram.com/p/1/', collected_at: '2026-11-10T18:51:38Z' }
];
const ROWS = [LI, meta('facebook_feed'), meta('instagram_feed'), meta('instagram_story')];
const step = (key, channel, day, extra = {}) => ({ key, channel, day, scheduled_day: day, step: key, featured: [], covers: [], ...extra });
const ctxOf = (extra = {}) => ({ today: '2026-11-11', ticks: {}, placementsByStep: placementIndex(ROWS, POSTS), ...extra });

test('every feed placement published = done automatically, with the board\'s evidence and time (LinkedIn live check; Meta collector)', () => {
  const ctx = ctxOf();
  const li = placementState(step('gpt-event-2026-11-09-norfolk-li', 'LinkedIn', '2026-11-09'), ctx);
  assert.deepEqual([li.status, li.auto, li.at], ['auto_done', true, '2026-11-09T09:06:19Z']);
  assert.match(li.evidence, /^LinkedIn: verified by GPT live check/);
  const fbig = placementState(step('gpt-8w-social-2026-11-10-fbig', 'Facebook + Instagram', '2026-11-10'), ctx);
  assert.equal(fbig.status, 'auto_done');
  assert.match(fbig.evidence, /Facebook: seen by the Meta collector .* · Instagram: seen by the Meta collector/);
  assert.equal(placementIndex(ROWS, POSTS).get('gpt-8w-social-2026-11-10-fbig').length, 2, 'the Story is its own task, never the step\'s');
});

test('partly published (Instagram not seen yet) or nothing published: no automatic done; time decides as before', () => {
  const ctx = ctxOf({ placementsByStep: placementIndex(ROWS, POSTS.slice(0, 1)) });
  assert.equal(placementState(step('gpt-8w-social-2026-11-10-fbig', 'Facebook + Instagram', '2026-11-10'), ctx), null);
  assert.equal(stepState(step('gpt-8w-social-2026-11-10-fbig', 'Facebook + Instagram', '2026-11-10'), ctx).status, 'late');
  assert.equal(stepState(step('gpt-x-no-placements', 'LinkedIn', '2026-11-10'), ctxOf()).status, 'late');
});

test('a hand tick or skip always wins (never un-ticked); done automatically otherwise', () => {
  const s = step('gpt-event-2026-11-09-norfolk-li', 'LinkedIn', '2026-11-09');
  const ticked = stepState(s, ctxOf({ ticks: { [s.key]: { is_ticked: true, status: 'done', set_by: 'claude', set_at: '2026-11-10T18:58:18Z' } } }));
  assert.deepEqual([ticked.status, ticked.by, ticked.resolved], ['done', 'claude', true]);
  const skipped = stepState(s, ctxOf({ ticks: { [s.key]: { is_ticked: false, status: 'skipped', reason: 'Alan', set_by: 'alan' } } }));
  assert.equal(skipped.status, 'skipped');
  const auto = stepState(s, ctxOf());
  assert.deepEqual([auto.status, auto.resolved], ['auto_done', true]);
});

const F = (name, title, url) => ({ name, title, url });
const NORFOLK = F('Norfolk', 'Norfolk Photography Workshop | Cromer to Hunstanton', '/photographic-workshops-near-me/norfolk-photography-workshop');
const MACRO = F('Abstract & Macro', 'Abstract and Macro Photography Workshop', '/photographic-workshops-near-me/abstract-and-macro-photography-workshop-coventry');
const GPT_MACRO = step('gpt-8w-social-2026-11-10-fbig', 'Facebook + Instagram', '2026-11-10', { step: 'What focus bracketing actually helps with', featured: [F('What focus bracketing actually helps with', '', 'https://www.alanranger.com/photo-workshops-uk/abstract-and-macro-photography-workshops')] });
const OLD_MACRO = step('step|2026-11-09|Facebook + Instagram|2026-11-13|1', 'Facebook + Instagram', '2026-11-13', { featured: [MACRO] });
const OLD_NORFOLK_LI = step('step|2026-11-09|LinkedIn|2026-11-11', 'LinkedIn', '2026-11-11', { featured: [NORFOLK] });

test('server supersede: an old generated step GPT\'s plan replaced (same week + channel + event) is superseded, linked; others kept', () => {
  const ctx = ctxOf({ today: '2026-11-16' });
  const list = [GPT_MACRO, OLD_MACRO, OLD_NORFOLK_LI].map((s) => ({ ...s, state: stepState(s, ctx) }));
  supersedeReplaced(list, ctx);
  const by = Object.fromEntries(list.map((s) => [s.key, s.state]));
  assert.deepEqual([by[OLD_MACRO.key].status, by[OLD_MACRO.key].covered_by, by[OLD_MACRO.key].resolved], ['superseded', ['gpt-8w-social-2026-11-10-fbig'], true]);
  assert.match(by[OLD_MACRO.key].reason, /replaced by GPT's post "What focus bracketing actually helps with" \(Tue 10 Nov\)/);
  assert.equal(by[OLD_NORFOLK_LI.key].status, 'late', 'no GPT LinkedIn post for Norfolk that week: kept, still late');
  const ticked = { ...OLD_MACRO, state: { status: 'done', resolved: true, by: 'alan' } };
  supersedeReplaced([GPT_MACRO, ticked], ctx);
  assert.equal(ticked.state.status, 'done', 'a hand-resolved step is never touched');
});

test('next week: last week\'s published GPT post and the old step it replaced are not carried as "late"', () => {
  const reg = (s) => ({ step_key: s.key, week_start: '2026-11-09', scheduled_day: s.day, channel: s.channel, step: s.step, featured: s.featured, covers: [] });
  const register = [reg(GPT_MACRO), reg(OLD_MACRO), reg(OLD_NORFOLK_LI)];
  const weeks = [{ week: '2026-11-16', steps: [] }];
  const { carried, summary } = applyStepStatus(weeks, ctxOf({ today: '2026-11-17' }), register);
  assert.deepEqual(carried.late.map((s) => s.key), [OLD_NORFOLK_LI.key], 'only the genuinely open step remains');
  assert.equal(summary.late, 1);
});

/* ---------- browser: Campaign steps + the schedule's social items ---------- */

function board() {
  const win = {};
  const document = { getElementById: () => null, addEventListener: () => {}, createElement: () => ({}), head: { appendChild: () => {} }, dispatchEvent: () => {}, querySelector: () => null };
  vm.runInContext(fs.readFileSync(new URL('../lib/strategy-board.js', import.meta.url), 'utf8'), vm.createContext({ window: win, document, CustomEvent: class {}, Intl, Date, Number, String, Map, Set, JSON, Math, Promise, Array, Object, RegExp, console }));
  return win;
}
test('Campaign steps: an automatically done post still reads "Published" (List word); a server-superseded step links its replacement', () => {
  const win = board();
  const pub = { ...GPT_MACRO, state: { status: 'auto_done', auto: true, resolved: true, evidence: 'Facebook: seen by the Meta collector', at: '2026-11-10T18:30:09Z' } };
  const old = { ...OLD_MACRO, state: { status: 'superseded', auto: true, resolved: true, covered_by: [GPT_MACRO.key], reason: 'replaced by GPT\'s post' } };
  const data = { campaign: { weeks: [{ week: '2026-11-09', steps: [pub, old] }], carried: { late: [], older: [] }, ticks: {}, campaigns: [], sends: {}, step_status: {}, rules: { email: { day: 'Thu' }, facebook_instagram: { days: ['Tue'] }, linkedin: { days: ['Wed'] } } },
    delivery_status: { by_key: { [GPT_MACRO.key]: { code: 'published', label: 'Published', icon: '✅', line: '✅ Published Tue 10 Nov 6:30pm' } }, holds: [] }, actions: [] };
  win.mountMarketingCampaign({ dataset: {}, innerHTML: '' }, data);
  const v = Object.fromEntries(win.stStepViews().steps.map((x) => [x.key, x]));
  assert.deepEqual([v[GPT_MACRO.key].kind, v[GPT_MACRO.key].code], ['delivery', 'published']);
  assert.deepEqual([v[OLD_MACRO.key].kind, v[OLD_MACRO.key].by], ['superseded', GPT_MACRO.key]);
  assert.equal(win.stStepViews().counts.published, 1);
});

test('Campaign steps: done automatically while the Story is still checking → "Published (feed posts)", no ticks, no stale DRAFT brief', () => {
  const win = board();
  const pub = { ...GPT_MACRO, brief: 'DRAFT — Alan review required. Proposed 2026-11-10 18:30 GMT.', featured: [{ ...GPT_MACRO.featured[0], stage: 'drafted' }], state: { status: 'auto_done', auto: true, resolved: true, evidence: 'Facebook: seen by the Meta collector · Instagram: seen by the Meta collector', at: '2026-11-10T18:30:09Z' } };
  const data = { campaign: { weeks: [{ week: '2026-11-09', steps: [pub] }], carried: { late: [], older: [] }, ticks: {}, campaigns: [], sends: {}, step_status: {}, rules: { email: { day: 'Thu' }, facebook_instagram: { days: ['Tue'] }, linkedin: { days: ['Wed'] } } },
    delivery_status: { by_key: { [GPT_MACRO.key]: { code: 'checking', label: 'Checking delivery', icon: '…', line: '… Checking delivery · Due Tue 10 Nov 6:30pm' } }, holds: [] }, actions: [] };
  const h = { dataset: {}, innerHTML: '' };
  win.mountMarketingCampaign(h, data);
  const v = win.stStepViews().steps[0];
  assert.deepEqual([v.kind, v.code, v.owner, v.stale_draft_hidden], ['delivery', 'published', 'GPT', true]);
  assert.match(h.innerHTML, /✅ Published \(feed posts\) · Facebook: seen by the Meta collector/);
  assert.ok(!/st-mo-tick|DRAFT — Alan review required|>drafted</.test(h.innerHTML), 'no ticks, no stale draft, no drafted tag');
});

test('Marketing schedule: a social step done automatically is a done item (not late), without any tick', () => {
  const win = { localStorage: { getItem: () => null, setItem: () => {} } };
  vm.runInContext(fs.readFileSync(new URL('../lib/marketing-delivery.js', import.meta.url), 'utf8'), vm.createContext({ window: win, document: { getElementById: () => null, head: { insertAdjacentHTML: () => {} } }, localStorage: win.localStorage, Intl, Date, Number, String, Map, Set, JSON, Math, Promise, console }));
  const st = { key: 'gpt-8w-social-2026-11-10-fbig', channel: 'Facebook + Instagram', step: 'What focus bracketing actually helps with', day: '2026-11-10', scheduled_day: '2026-11-10', state: { status: 'auto_done', auto: true, at: '2026-11-10T18:30:09Z', evidence: 'seen by the Meta collector' } };
  const items = win.mkDeliveryItems({ meter: { deliveries: [], step_tags: {} } }, { campaign: { weeks: [{ week: '2026-11-09', steps: [st] }], ticks: {}, campaigns: [] } });
  const social = items.filter((x) => x.channel === 'facebook' || x.channel === 'instagram');
  assert.equal(social.length, 2);
  assert.ok(social.every((x) => x.status === 'done' && x.done_at === '2026-11-10T18:30:09Z'));
});

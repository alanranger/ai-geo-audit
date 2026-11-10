/**
 * Marketing "Next 12 weeks: by channel" tile + tile order (QUESTION-2026-11-10 channel-tile-and-tile-order, parts 1–2):
 * the channel rows are the content mix's own deliveries (sched + waiting + planned-with-no-post = content-mix
 * deliveries, drafts = its drafts); platform placements, Google Business exception posts and Shorts are shown apart;
 * amber gap flags for planned steps with no post and 14+ days with nothing booked; row 1 = content mix · by channel ·
 * Email capacity · Eligible audience, then Needs Alan and Data & alignment health.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { assemblePlan } from '../lib/strategy-initiatives.mjs';

const TODAY = '2026-11-10';
const step = (key, day, channel, title, extra = {}) => ({ key, day, scheduled_day: day, channel, step: title, featured: [], covers: [], brief: '', state: { status: 'pending' }, ...extra });
const send = (key, stage, day) => ({ campaign_key: key, kind: 'theme', title: key, stage, planned_send_on: day, window_start: day, reserved_sends: null, actual_sends: null, sent_on: null, stage_history: [] });
const st = (code, extra = {}) => ({ code, label: code, icon: '', tone: 'grey', ...extra });
function plan() {
  const campaign = {
    weeks: [
      { week: '2026-11-09', steps: [
        step('gpt-fbig-11-12', '2026-11-12', 'Facebook + Instagram', 'Post: Thursday', { manual: true }),
        step('step|li-11-11', '2026-11-11', 'LinkedIn', 'LinkedIn post (generated)'),
        step('gpt-li-11-11', '2026-11-11', 'LinkedIn', 'LinkedIn post', { manual: true }),
        step('step|gbp|2026-11-20|/x', '2026-11-13', 'Google Business', 'GBP exception post', { gbp: 'exception', optional: true, state: { status: 'done' } }),
        step('step|gbp|check', '2026-11-10', 'Google Business', 'GBP check', { gbp: 'check' })
      ] },
      { week: '2026-11-16', steps: [step('gpt-fbig-11-20', '2026-11-20', 'Facebook + Instagram', 'Post: Friday', { manual: true }), step('step|li-11-18', '2026-11-18', 'LinkedIn', 'LinkedIn post (generated)')] },
      { week: '2026-11-23', steps: [step('gpt-fbig-11-27', '2026-11-27', 'Facebook + Instagram', 'Post: draft', { manual: true })] },
      { week: '2026-11-30', steps: [] }
    ],
    carried: { future: [step('gpt-fbig-12-18', '2026-12-18', 'Facebook + Instagram', 'Post: December', { manual: true, week: '2026-12-14' })], late: [], older: [] },
    campaigns: []
  };
  const campaignRows = [send('theme|sched-11', 'scheduled', '2026-11-11'), send('theme|sched-19', 'scheduled', '2026-11-19'), send('theme|draft-26', 'drafted', '2026-11-26'), send('theme|draft-dec', 'drafted', '2026-12-10')];
  const statusIndex = {
    'gpt-fbig-11-12': st('scheduled', { at: '2026-11-12T18:30:00Z' }), 'gpt-li-11-11': st('scheduled', { at: '2026-11-11T08:30:00Z' }),
    'gpt-fbig-11-20': st('waiting_window', { approved: true }), 'gpt-fbig-12-18': st('waiting_window', { approved: true }),
    'send|theme|sched-11': st('scheduled', { at: '2026-11-11T19:30:00Z' }), 'send|theme|sched-19': st('scheduled', { at: '2026-11-19T19:30:00Z' })
  };
  return assemblePlan({ today: TODAY, campaign, campaignRows, statusIndex, links: [], initiatives: [], quarters: [], actions: [], assets: [], txns: [], diary: [] });
}
const board = {
  placements: [
    { step_key: 'gpt-fbig-11-12', placement: 'facebook_feed', planned_at: '2026-11-12T18:30:00Z', status: st('scheduled') },
    { step_key: 'gpt-fbig-11-12', placement: 'instagram_feed', planned_at: '2026-11-12T18:30:00Z', status: st('scheduled') },
    { step_key: 'gpt-fbig-11-12', placement: 'instagram_story', planned_at: '2026-11-12T18:30:00Z', status: st('story_ready') },
    { step_key: 'gpt-fbig-11-20', placement: 'facebook_feed', planned_at: '2026-11-20T18:30:00Z', status: st('waiting_window'), approved: true },
    { step_key: 'gpt-fbig-11-20', placement: 'instagram_feed', planned_at: '2026-11-20T18:30:00Z', status: st('waiting_window'), approved: true },
    { step_key: 'other-not-in-mix', placement: 'facebook_feed', planned_at: '2026-11-21T18:30:00Z', status: st('scheduled') }
  ],
  content: [
    { asset_key: 'video|a', format: 'short_video', release_at: '2026-11-17T18:00:00Z', status: st('scheduled') },
    { asset_key: 'video|b', format: 'short_video', release_at: '2026-12-01T18:00:00Z', status: st('scheduled') },
    { asset_key: 'video|old', format: 'short_video', release_at: '2026-11-01T18:00:00Z', status: st('published') }
  ]
};

function load() {
  const win = {};
  const ctx = vm.createContext({ window: win, document: { getElementById: () => null, querySelector: () => null, head: { insertAdjacentHTML: () => {} } }, Intl, Date, Number, String, Map, Set, JSON, Math, Promise, Array, Object, RegExp, console, setTimeout });
  for (const f of ['../lib/marketing-channels-tile.js', '../lib/marketing-overview-tiles.js']) vm.runInContext(fs.readFileSync(new URL(f, import.meta.url), 'utf8'), ctx);
  return win;
}
const plain = (x) => JSON.parse(JSON.stringify(x));

test('reconciliation: the channel rows are the content mix\'s own deliveries (sched + waiting + planned = deliveries; drafts = drafts)', () => {
  const s = { quarter_plan: plan() };
  const mix = s.quarter_plan.purpose_mix;
  assert.equal(mix.items.length, mix.deliveries + mix.draft.deliveries, 'purpose_mix.items = every counted delivery');
  const m = plain(load().mkChannels.build(s, board, TODAY));
  const t = m.totals;
  assert.equal(t.sched + t.waiting + t.planned, mix.deliveries);
  assert.equal(t.waiting, mix.waiting.deliveries);
  assert.equal(t.drafts, mix.draft.deliveries);
  const row = (k) => m.rows.find((r) => r.key === k);
  assert.deepEqual([row('email').sched, row('email').drafts], [2, 2]);
  assert.deepEqual([row('fbig').sched, row('fbig').waiting, row('fbig').drafts], [1, 2, 1]);
  assert.deepEqual([row('linkedin').sched, row('linkedin').planned], [1, 2]);
});

test('platform lines under Facebook + Instagram come from the board placements of those posts only (not added again)', () => {
  const m = plain(load().mkChannels.build({ quarter_plan: plan() }, board, TODAY));
  const sub = Object.fromEntries(m.subs.map((r) => [r.key, [r.sched, r.waiting, r.drafts]]));
  assert.deepEqual(sub, { facebook_feed: [1, 1, 0], instagram_feed: [1, 1, 0], instagram_story: [0, 0, 1] }, 'a placement of a post outside the content mix is not counted');
  assert.equal(m.shorts.sched, 2, 'Shorts in the window from the content records; an earlier release is outside');
  assert.equal(m.shorts.next, '2026-11-17');
});

test('Next = the next booked item still to come: an email sent earlier today is not "next"', () => {
  const C = load().mkChannels;
  const s = { quarter_plan: plan() };
  assert.equal(C.build(s, board, TODAY, Date.parse('2026-11-10T12:00:00Z')).rows.find((r) => r.key === 'email').next, '2026-11-11');
  assert.equal(C.build(s, board, '2026-11-11', Date.parse('2026-11-11T20:00:00Z')).rows.find((r) => r.key === 'email').next, '2026-11-19', 'the 11 Nov 19:30 send has gone out');
});

test('gap flags: LinkedIn planned steps with no post; Google Business nothing after 13 Nov; an inner 14+ day stretch', () => {
  const m = plain(load().mkChannels.build({ quarter_plan: plan() }, board, TODAY));
  const li = m.rows.find((r) => r.key === 'linkedin');
  assert.equal(li.flags[0].text, '2 planned steps with no post yet');
  assert.match(li.flags[0].tip, /nothing created on the platform yet/);
  const gb = load().mkChannels.build({ quarter_plan: plan(), campaign: { weeks: [{ steps: [step('step|gbp|2026-11-20|/x', '2026-11-13', 'Google Business', 'GBP', { gbp: 'exception', optional: true, state: { status: 'done' } })] }] } }, board, TODAY).gbp;
  assert.deepEqual(plain([gb.sched, gb.next, gb.flags.map((f) => f.text)]), [1, '2026-11-13', ['nothing after Fri 13 Nov']]);
  assert.match(gb.flags[0].tip, /No booked or approved-waiting item for 35 days \(Fri 13 Nov → Fri 18 Dec\)/);
  const fb = m.rows.find((r) => r.key === 'fbig');
  assert.deepEqual(fb.flags.map((f) => f.text), ['nothing Fri 20 Nov → Fri 18 Dec'], 'the 27 Nov draft does not cover the stretch');
  assert.equal(m.rows.find((r) => r.key === 'email').flags.length, 1, 'email: nothing booked after 19 Nov (drafts only) → flagged');
});

test('gapOf: an inner 14-day stretch, a tail, nothing booked at all', () => {
  const C = load().mkChannels;
  const row = (days) => ({ items: days.map((d) => ({ day: d, bucket: 'sched' })) });
  assert.equal(C.gapOf(row(['2026-11-12', '2026-11-20']), '2026-11-10', '2026-11-30'), null);
  assert.deepEqual(plain(C.gapOf(row(['2026-11-12', '2026-11-30']), '2026-11-10', '2026-12-05')), { from: '2026-11-12', to: '2026-11-30', tail: false, none: false });
  assert.deepEqual(plain(C.gapOf(row([]), '2026-11-10', '2026-12-05')), { from: '2026-11-10', to: '2026-12-05', tail: true, none: true });
});

test('tile HTML: title + tip, columns, reconciliation line ✓, row clicks, Shorts "—" with a hover when the board is unavailable', () => {
  const win = load();
  const s = { quarter_plan: plan() };
  const html = win.mkChannelsTileHtml(s, board, TODAY);
  assert.match(html, /<div class="mko-title" title="Sched = booked in the platform[^"]*Waiting = approved, waiting for the platform&#39;s scheduling window|<div class="mko-title" title="Sched = booked in the platform[^"]*Waiting = approved, waiting for the platform's scheduling window/);
  assert.match(html, />Next 12 weeks: by channel</);
  assert.match(html, /<th><span class="s">Sched<\/span><\/th><th><span class="w">Waiting<\/span><\/th><th><span class="d">Drafts<\/span><\/th><th>Next<\/th>/);
  assert.match(html, /data-mkch-rec="ok"/);
  for (const [row, go] of [['email', 'email'], ['fbig', 'facebook'], ['linkedin', 'linkedin'], ['gbp', 'google'], ['youtube', 'youtube'], ['instagram_story', 'instagram']]) assert.match(html, new RegExp(`data-mkch-go="${go}" data-mkch-row="${row}"`));
  const none = win.mkChannelsTileHtml(s, { error: 'HTTP 500' }, TODAY);
  assert.match(none, /data-mkch-row="youtube" title="The Shorts schedule \(content records with YouTube status\) could not be read: HTTP 500"><td class="left">YouTube Shorts<\/td><td>—<\/td><td>—<\/td><td>—<\/td>/);
});

test('tile order: content mix · by channel · Email capacity · Eligible audience, then Needs Alan · Data & alignment health; decision alert only when one waits', () => {
  const win = load();
  const s = { quarter_plan: plan(), campaign: { campaigns: [], step_status: {} }, actions: [] };
  const d = { meter: { state: 'never_read' }, identity: {}, runs: {}, tiles: { cleanup: { frozen: [] } }, engagement: {} };
  const html = win.mkOverviewTiles.gridHtml({ d, s, health: { state: 'loading' }, board: undefined });
  const titles = [...html.matchAll(/<div class="mko-title"[^>]*>([^<]+)</g)].map((x) => x[1].trim());
  assert.deepEqual(titles, ['Next 12 weeks: content mix', 'Next 12 weeks: by channel', 'Email capacity', 'Eligible audience', 'Needs Alan', 'Data &amp; alignment health']);
  assert.doesNotMatch(html, /<p class="mko-alert"/, 'no decision waiting: no alert');
  const waiting = win.mkOverviewTiles.gridHtml({ d, s: { ...s, campaign: { campaigns: [{ campaign_key: 'x', title: 'Gift email', stage: 'verified' }], step_status: {} } }, health: { state: 'loading' } });
  assert.match(waiting, /<p class="mko-alert"><a href="#" data-mko-go="campaign">⚠ 1 decision waiting for Alan → Needs Alan \(tile 7\)<\/a><\/p>/);
  assert.ok(waiting.indexOf('<p class="mko-alert"') < waiting.indexOf('<div class="mko-grid'), 'above the tiles');
  for (const k of [6, 7, 8, 9, 10]) assert.match(html, new RegExp(`<div class="mko-num">${k}</div>`), `tile ${k} keeps its number`);
});

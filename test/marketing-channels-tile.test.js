/**
 * Marketing "Next 12 weeks: by channel" tile + tile order (QUESTION-2026-11-10 channel-tile-and-tile-order, parts 1–2;
 * channel-tile-separate-rows-fix, Alan 20:14): seven top-level rows in Alan's order, each counting its own posts / sends
 * in today + 84 days (social rows = that platform's placements of content-mix steps; superseded and GPT-covered steps
 * never counted); amber gap flags per channel; reconciliation with the content mix in the title hover only; row 1 =
 * content mix · by channel · Email capacity · Eligible audience, then the row-2 tiles.
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
      { week: '2026-11-23', steps: [step('gpt-fbig-11-27', '2026-11-27', 'Facebook + Instagram', 'Post: draft', { manual: true }), step('gpt-fbig-11-25-old', '2026-11-25', 'Facebook + Instagram', 'Post: replaced', { manual: true, state: { status: 'superseded' } })] },
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
    { step_key: 'gpt-fbig-12-18', placement: 'facebook_feed', planned_at: '2026-12-18T18:30:00Z', status: st('waiting_window'), approved: true },
    { step_key: 'gpt-fbig-12-18', placement: 'instagram_feed', planned_at: '2026-12-18T18:30:00Z', status: st('waiting_window'), approved: true },
    { step_key: 'gpt-fbig-12-18', placement: 'instagram_story', planned_at: '2027-03-01T18:30:00Z', status: st('story_ready') },
    { step_key: 'gpt-li-11-11', placement: 'linkedin_feed', planned_at: '2026-11-11T08:30:00Z', status: st('scheduled'), approved: true },
    { step_key: 'step|li-11-11', placement: 'linkedin_feed', planned_at: '2026-11-11T08:30:00Z', status: st('scheduled') },
    { step_key: 'gpt-fbig-11-25-old', placement: 'facebook_feed', planned_at: '2026-11-25T18:30:00Z', status: st('scheduled') },
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

const ORDER = [['email', 'Squarespace email'], ['facebook', 'Facebook'], ['instagram', 'Instagram'], ['instagram_story', 'Instagram Stories'], ['linkedin', 'LinkedIn'], ['gbp', 'Google Business'], ['youtube', 'YouTube Shorts']];
const gbpStep = step('step|gbp|2026-11-20|/x', '2026-11-13', 'Google Business', 'GBP', { gbp: 'exception', optional: true, state: { status: 'done' } });
const withGbp = () => ({ quarter_plan: plan(), campaign: { weeks: [{ steps: [gbpStep] }] } });
const counts = (r) => [r.sched, r.waiting, r.drafts];

/** Independent of the tile: that platform's placements of content-mix steps in today + 84 days, plus the channel's unplaced steps. */
function expectedPlacements(mix, place, re) {
  const steps = new Map(mix.items.map((x) => [x.key, x]));
  const inWin = (d) => d >= mix.window.from && d <= mix.window.to;
  const pls = board.placements.filter((p) => p.placement === place && steps.has(p.step_key) && inWin(p.planned_at.slice(0, 10)));
  const code = (p) => p.status.code;
  const unplaced = re ? mix.items.filter((x) => re.test(x.channel) && !pls.some((p) => p.step_key === x.key)) : [];
  return {
    c: [pls.filter((p) => code(p) === 'scheduled').length, pls.filter((p) => code(p) === 'waiting_window').length, pls.filter((p) => !['scheduled', 'waiting_window'].includes(code(p))).length + unplaced.filter((x) => x.draft).length],
    planned: unplaced.filter((x) => !x.draft).length
  };
}

test('seven top-level rows in Alan\'s order, first "Squarespace email"; headline 7 channels; no combined / indented rows', () => {
  const m = plain(load().mkChannels.build(withGbp(), board, TODAY));
  assert.deepEqual(m.rows.map((r) => [r.key, r.label]), ORDER);
  assert.ok(m.rows.every((r) => !r.sub && !r.missing));
  const html = load().mkChannelsTileHtml(withGbp(), board, TODAY);
  const rows = [...html.matchAll(/<tr class="([^"]*)" data-mkch-go="([^"]+)" data-mkch-row="([^"]+)"[^>]*><td class="left"><span class="mkch-name">([^<]+)</g)];
  assert.deepEqual(rows.map((x) => [x[3], x[4]]), ORDER, 'rendered in the same order');
  assert.ok(rows.every((x) => x[1] === 'mkch-r'), 'all rows at the same level');
  assert.match(html, /<div class="mko-head">7 <span class="mko-unit">channels · next post and gaps<\/span><\/div>/);
  assert.doesNotMatch(html, /└|mkch-sub|Facebook \+ Instagram<|data-mkch-row="fbig"/, 'no combined parent row, no indented sub-rows');
});

test('each row counts its own channel\'s posts in today + 84 days (placements, not campaign steps); dedupe per channel', () => {
  const s = withGbp();
  const mix = s.quarter_plan.purpose_mix;
  const m = plain(load().mkChannels.build(s, board, TODAY));
  const row = (k) => m.rows.find((r) => r.key === k);
  for (const [k, place, re] of [['facebook', 'facebook_feed', /Facebook/], ['instagram', 'instagram_feed', /Instagram/], ['instagram_story', 'instagram_story', null], ['linkedin', 'linkedin_feed', /LinkedIn/]]) {
    const e = expectedPlacements(mix, place, re);
    assert.deepEqual([counts(row(k)), row(k).planned], [e.c, e.planned], `${k} = its own placements`);
  }
  assert.deepEqual(counts(row('facebook')), [1, 2, 1], 'FB: 12 Nov booked, 20 Nov + 18 Dec waiting, 27 Nov draft step (no placement yet); superseded 25 Nov and a post outside the content mix not counted');
  assert.deepEqual(counts(row('instagram')), [1, 2, 1]);
  assert.deepEqual(counts(row('instagram_story')), [0, 0, 1], 'the 1 Mar Story is outside today + 84 days');
  assert.deepEqual([...counts(row('linkedin')), row('linkedin').planned], [1, 0, 0, 1], 'generated 11 Nov step covered by GPT\'s 11 Nov post: its placement is not counted again; 18 Nov planned, no post yet');
  assert.deepEqual(row('linkedin').covered.map((c) => c.key), ['step|li-11-11']);
  assert.deepEqual(counts(row('email')), [2, 0, 2], 'Squarespace email = the content mix\'s sends');
  assert.deepEqual(counts(row('gbp')), [1, 0, 0]);
  assert.deepEqual([counts(row('youtube')), row('youtube').next], [[2, 0, 0], '2026-11-17'], 'Shorts in the window from the content records; an earlier release is outside');
  assert.ok(mix.superseded.some((x) => x.key === 'gpt-fbig-11-25-old'), 'fixture: the replaced step is superseded');
});

test('Next = the next booked item still to come: an email sent earlier today is not "next"', () => {
  const C = load().mkChannels;
  const s = { quarter_plan: plan() };
  assert.equal(C.build(s, board, TODAY, Date.parse('2026-11-10T12:00:00Z')).rows.find((r) => r.key === 'email').next, '2026-11-11');
  assert.equal(C.build(s, board, '2026-11-11', Date.parse('2026-11-11T20:00:00Z')).rows.find((r) => r.key === 'email').next, '2026-11-19', 'the 11 Nov 19:30 send has gone out');
});

test('gap flags per channel: LinkedIn planned steps with no post; Google Business nothing after 13 Nov; an inner 14+ day stretch', () => {
  const m = plain(load().mkChannels.build(withGbp(), board, TODAY));
  const flags = (k) => m.rows.find((r) => r.key === k).flags.map((f) => f.text);
  assert.deepEqual(flags('linkedin'), ['1 planned step with no post yet', 'nothing after Wed 11 Nov']);
  assert.match(m.rows.find((r) => r.key === 'linkedin').flags[0].tip, /nothing created on this platform yet/);
  const gb = m.rows.find((r) => r.key === 'gbp');
  assert.deepEqual([gb.sched, gb.next, flags('gbp')], [1, '2026-11-13', ['nothing after Fri 13 Nov']]);
  assert.match(gb.flags[0].tip, /No booked or approved-waiting item for 35 days \(Fri 13 Nov → Fri 18 Dec\)/);
  assert.deepEqual(flags('facebook'), ['nothing Fri 20 Nov → Fri 18 Dec'], 'the 27 Nov draft does not cover the stretch');
  assert.deepEqual(flags('instagram'), ['nothing Fri 20 Nov → Fri 18 Dec']);
  assert.deepEqual(flags('instagram_story'), ['nothing scheduled yet']);
  assert.deepEqual(flags('email'), ['nothing after Thu 19 Nov'], 'drafts only after 19 Nov');
});

test('gapOf: an inner 14-day stretch, a tail, nothing booked at all', () => {
  const C = load().mkChannels;
  const row = (days) => ({ items: days.map((d) => ({ day: d, bucket: 'sched' })) });
  assert.equal(C.gapOf(row(['2026-11-12', '2026-11-20']), '2026-11-10', '2026-11-30'), null);
  assert.deepEqual(plain(C.gapOf(row(['2026-11-12', '2026-11-30']), '2026-11-10', '2026-12-05')), { from: '2026-11-12', to: '2026-11-30', tail: false, none: false });
  assert.deepEqual(plain(C.gapOf(row([]), '2026-11-10', '2026-12-05')), { from: '2026-11-10', to: '2026-12-05', tail: true, none: true });
});

test('tile HTML: columns, reconciliation in the title hover only (no on-face line), covered steps in the row hover only, row clicks, "—" when the board is unavailable', () => {
  const win = load();
  const s = withGbp();
  const html = win.mkChannelsTileHtml(s, board, TODAY);
  const title = html.match(/<div class="mko-title" title="([^"]*)">Next 12 weeks: by channel</)?.[1] || '';
  assert.match(title, /Sched = booked in the platform.*Waiting = approved, waiting for the platform's scheduling window.*Drafts = still being prepared/);
  assert.match(title, /the content mix counts campaign deliveries \(\d+ \+ \d+ drafts\); this tile counts posts per channel/);
  assert.match(title, /leave out 1 superseded step and 1 generated step already covered by a GPT post/);
  assert.match(html, /<th><span class="s">Sched<\/span><\/th><th><span class="w">Waiting<\/span><\/th><th><span class="d">Drafts<\/span><\/th><th>Next<\/th>/);
  const face = html.replace(/ title="[^"]*"/g, '');
  assert.doesNotMatch(face, /= content mix|data-mkch-rec|covered by GPT post|mkch-cov/, 'no reconciliation line or grey covered note on the face');
  assert.match(html, /data-mkch-row="linkedin" title="Open the schedule: LinkedIn\n1 generated step not counted again \(GPT&#39;s own LinkedIn post that day covers them\)|data-mkch-row="linkedin" title="Open the schedule: LinkedIn\n1 generated step not counted again \(GPT's own LinkedIn post that day covers them\)/);
  assert.match(html, /data-mkch-row="email" title="Open the schedule: Squarespace email"/);
  for (const [row, go] of [['email', 'email'], ['facebook', 'facebook'], ['instagram', 'instagram'], ['instagram_story', 'instagram'], ['linkedin', 'linkedin'], ['gbp', 'google'], ['youtube', 'youtube']]) assert.match(html, new RegExp(`data-mkch-go="${go}" data-mkch-row="${row}"`));
  const none = win.mkChannelsTileHtml(s, { error: 'HTTP 500' }, TODAY);
  for (const [k, label] of ORDER.filter(([k]) => !['email', 'gbp'].includes(k))) assert.match(none, new RegExp(`data-mkch-row="${k}" title="The delivery-status board \\(placements and Shorts\\) could not be read: HTTP 500"><td class="left"><span class="mkch-name">${label}</span></td><td>—</td><td>—</td><td>—</td>`));
  assert.equal([...none.matchAll(/data-mkch-row=/g)].length, 7, 'still seven rows');
});

test('tile order (tidy 10 Nov 20:11): content mix · by channel · Email capacity · Eligible audience, then Data & alignment health · Needs Alan; fixed columns; decision alert only when one waits', () => {
  const win = load();
  const s = { quarter_plan: plan(), campaign: { campaigns: [], step_status: {} }, actions: [] };
  const d = { meter: { state: 'never_read' }, identity: {}, runs: {}, tiles: { cleanup: { frozen: [] } }, engagement: {} };
  const html = win.mkOverviewTiles.gridHtml({ d, s, health: { state: 'loading' }, board: undefined });
  const titles = [...html.matchAll(/<div class="mko-title"[^>]*>([^<]+)</g)].map((x) => x[1].trim());
  assert.deepEqual(titles, ['Next 12 weeks: content mix', 'Next 12 weeks: by channel', 'Email capacity', 'Eligible audience', 'Data &amp; alignment health', 'Needs Alan']);
  assert.match(html, /@container mko \(min-width: 65rem\) \{\s*\.mko \.mko-grid\.c5 \{ grid-template-columns: repeat\(5, minmax\(0, 1fr\)\); \}/, 'wide: 5 fixed columns (no 6th column pulling Needs Alan up)');
  assert.match(html, /@container mko \(min-width: 47rem\) \{\s*\.mko \.mko-grid\.c5 \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \}/, 'medium: 3 columns, same order');
  assert.doesNotMatch(html, /<p class="mko-alert"/, 'no decision waiting: no alert');
  const waiting = win.mkOverviewTiles.gridHtml({ d, s: { ...s, campaign: { campaigns: [{ campaign_key: 'x', title: 'Gift email', stage: 'verified' }], step_status: {} } }, health: { state: 'loading' } });
  assert.match(waiting, /<p class="mko-alert"><a href="#" data-mko-go="campaign">⚠ 1 decision waiting for Alan → Needs Alan \(tile 7\)<\/a><\/p>/);
  assert.ok(waiting.indexOf('<p class="mko-alert"') < waiting.indexOf('<div class="mko-grid'), 'above the tiles');
  for (const k of [6, 7, 8, 9, 10]) assert.match(html, new RegExp(`<div class="mko-num">${k}</div>`), `tile ${k} keeps its number`);
});

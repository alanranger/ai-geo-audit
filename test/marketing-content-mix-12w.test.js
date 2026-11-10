/**
 * Marketing tile 6 "Next 12 weeks: content mix" (QUESTION-2026-11-10 content-mix-tile-12-weeks): a rolling window of
 * today + 84 days. Counts = scheduled / approved deliveries and drafts dated inside it (the campaign view's steps from
 * today, theme / event sends and manual steps after the view), bars sum to the headline, title + hover tip.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { assemblePlan, mixWindow, MIX_DAYS } from '../lib/strategy-initiatives.mjs';

const TODAY = '2026-11-10';
const step = (key, day, channel, title, extra = {}) => ({ key, day, scheduled_day: day, channel, step: title, featured: [], covers: [], brief: '', state: { status: 'pending' }, ...extra });
const send = (key, stage, day) => ({ campaign_key: key, kind: 'theme', title: key, stage, planned_send_on: day, window_start: day, reserved_sends: null, actual_sends: null, sent_on: null, stage_history: [] });
function fixture() {
  const campaign = {
    weeks: [
      { week: '2026-11-09', steps: [step('step|mon', '2026-11-09', 'Facebook + Instagram', 'Post: Monday (before today)'), step('step|thu', '2026-11-12', 'Facebook + Instagram', 'Post: Thursday'), step('step|li', '2026-11-13', 'LinkedIn', 'LinkedIn post'), step('plan|qa', '2026-11-13', 'Quarter action', 'Quarter action')] },
      { week: '2026-11-16', steps: [step('step|note', '2026-11-18', 'Outlook personal notes', 'Personal note')] },
      { week: '2026-11-23', steps: [] }, { week: '2026-11-30', steps: [step('step|gpt-dec', '2026-12-02', 'Facebook + Instagram', 'Post: GPT draft', { manual: true })] }
    ],
    carried: {
      future: [
        step('step|gpt-xmas', '2026-12-20', 'Facebook + Instagram', 'Post: Christmas (GPT manual)', { manual: true, week: '2026-12-14' }),
        step('step|gpt-jan', '2027-01-20', 'LinkedIn', 'LinkedIn: January (GPT manual)', { manual: true, week: '2027-01-18' }),
        step('plan|late-qa', '2026-12-21', 'Quarter action', 'Quarter action later', { week: '2026-12-21' }),
        step('step|gpt-out', '2027-02-02', 'Facebook + Instagram', 'Post: day 85 (outside)', { manual: true, week: '2027-02-01' })
      ],
      late: [], older: []
    },
    campaigns: []
  };
  const campaignRows = [
    send('theme|sched-12nov', 'scheduled', '2026-11-12'), send('theme|draft-19nov', 'drafted', '2026-11-19'),
    send('theme|draft-14dec', 'drafted', '2026-12-14'), send('theme|approved-jan', 'approved', '2027-01-05'),
    send('theme|draft-last-day', 'drafted', '2027-02-01'), send('theme|draft-day-85', 'drafted', '2027-02-02'),
    send('theme|cancelled', 'cancelled', '2026-12-01')
  ];
  return { today: TODAY, campaign, campaignRows, links: [], initiatives: [], quarters: [], actions: [], assets: [], txns: [], diary: [] };
}

test('window: rolling, today and the next 83 days = 84 days (12 weeks)', () => {
  assert.equal(MIX_DAYS, 84);
  assert.deepEqual(mixWindow(TODAY), { from: '2026-11-10', to: '2027-02-01', days: 84 });
  assert.deepEqual(assemblePlan(fixture()).purpose_mix.window, { from: '2026-11-10', to: '2027-02-01', days: 84 });
});

test('counts = scheduled / approved deliveries and drafts dated within today + 84 days (nothing before today, nothing after day 84)', () => {
  const m = assemblePlan(fixture()).purpose_mix;
  /* scheduled / approved: Thu post, LinkedIn, Outlook note, 12 Nov send, January approved send; Monday is before today. */
  assert.equal(m.deliveries, 5);
  /* drafts: 2 Dec GPT post (in the view), 19 Nov + 14 Dec + 1 Feb drafted sends, 20 Dec + 20 Jan GPT manual steps. */
  assert.equal(m.draft.deliveries, 6);
  assert.equal(Object.values(m.by_primary).reduce((a, b) => a + b, 0), m.deliveries);
  assert.equal(Object.values(m.draft.by_primary).reduce((a, b) => a + b, 0), m.draft.deliveries);
  assert.match(m.basis, /dated 2026-11-10 → 2027-02-01 \(today \+ 84 days, rolling\)/);
});

test('sends and manual steps after the 4-week campaign view (to 6 Dec) are counted; without them the counts drop', () => {
  const f = fixture();
  const fourWeeks = assemblePlan({ ...f, campaign: { ...f.campaign, carried: { future: [], late: [], older: [] } }, campaignRows: f.campaignRows.filter((r) => r.planned_send_on <= '2026-12-06') }).purpose_mix;
  const twelve = assemblePlan(f).purpose_mix;
  assert.ok(twelve.deliveries > fourWeeks.deliveries && twelve.draft.deliveries > fourWeeks.draft.deliveries);
});

function tile(pm) {
  const win = {};
  const c = vm.createContext({ window: win, document: { getElementById: () => null, querySelector: () => null, head: { insertAdjacentHTML: () => {} } }, Intl, Date, Number, String, Map, Set, JSON, Math, Promise, Array, Object, console, setTimeout });
  vm.runInContext(fs.readFileSync(new URL('../lib/marketing-overview-tiles.js', import.meta.url), 'utf8'), c);
  const T = win.mkOverviewTiles;
  return T.tileHtml(T.tileMix({ quarter_plan: { purpose_mix: pm } }));
}

test('tile: "Next 12 weeks: content mix", the exact hover tip, headline and chip from the 12-week counts, bars sum to the headline', () => {
  const m = assemblePlan(fixture()).purpose_mix;
  const html = tile(m);
  assert.match(html, /<div class="mko-title" title="All scheduled deliveries and drafts across every channel in the next 12 weeks, by purpose\. Drafts are shown apart and are not yet committed\.">Next 12 weeks: content mix</);
  assert.match(html, new RegExp(`>${m.deliveries} <span class="mko-unit">deliveries · next 12 weeks</span>`));
  assert.match(html, new RegExp(`\\+${m.draft.deliveries} drafts</span>`));
  const rows = [...html.matchAll(/<span class="mko-mixl">(\w+)<\/span>.*?<span class="mko-mixn">(\d+)<\/span>/g)].map((r) => [r[1], Number(r[2])]);
  const total = (label) => rows.filter(([l]) => l === label).reduce((a, [, k]) => a + k, 0);
  assert.equal(total('Scheduled') + total('Waiting'), m.deliveries, 'Scheduled (+ Waiting) bars = headline');
  assert.equal(total('Drafts'), m.draft.deliveries, 'Drafts bar = the "+n drafts" chip');
  assert.match(html, /Tue 10 Nov → Mon 1 Feb \(today \+ 84 days, rolling\)/);
  assert.doesNotMatch(html, /4 weeks/);
});

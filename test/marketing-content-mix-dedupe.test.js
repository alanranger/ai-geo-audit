/**
 * Content-mix double counting (Alan, 10 Nov 19:31): a superseded step is left out like a skipped one, and a generated
 * weekly social step is "covered by GPT post" (not counted) when GPT's own post on the same channel row (Facebook +
 * Instagram shared, LinkedIn apart) is on the board that day. Email is never covered this way. The by-channel tile
 * applies the same rule per channel (covered steps in the row hover only); its amber flag counts only steps with no post.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { assemblePlan, coveredByGpt, socialGroup } from '../lib/strategy-initiatives.mjs';

const TODAY = '2026-11-10';
const step = (key, day, channel, title, extra = {}) => ({ key, day, scheduled_day: day, channel, step: title, featured: [], covers: [], brief: '', state: { status: 'pending' }, ...extra });
const st = (code) => ({ code, label: code, icon: '', tone: 'grey' });
function plan() {
  const campaign = {
    weeks: [
      { week: '2026-11-09', steps: [
        step('step|2026-11-09|Facebook + Instagram|2026-11-10', '2026-11-10', 'Facebook + Instagram', 'Post: Norfolk (generated)', { state: { status: 'superseded', covered_by: ['gpt-fbig-11-13'] } }),
        step('gpt-fbig-11-13', '2026-11-13', 'Facebook + Instagram', 'Norfolk: offer ends Saturday', { manual: true }),
        step('step|2026-11-09|Facebook + Instagram|2026-11-13', '2026-11-13', 'Facebook + Instagram', 'Post: tip (generated)'),
        step('step|2026-11-09|LinkedIn|2026-11-13', '2026-11-13', 'LinkedIn', 'LinkedIn post (generated)'),
        step('step|2026-11-09|Squarespace email|2026-11-12', '2026-11-12', 'Squarespace email', 'Main email of the week', { is_email: true })
      ] },
      { week: '2026-11-16', steps: [
        step('gpt-li-11-18', '2026-11-18', 'LinkedIn', 'LinkedIn: gift ideas', { manual: true }),
        step('step|2026-11-16|LinkedIn|2026-11-18', '2026-11-18', 'LinkedIn', 'LinkedIn post (generated)'),
        step('step|2026-11-16|Facebook + Instagram|2026-11-20', '2026-11-20', 'Facebook + Instagram', 'Post: own placement (generated)'),
        step('step|2026-11-16|Facebook + Instagram|2026-11-21', '2026-11-21', 'Facebook + Instagram', 'Post: nothing that day (generated)')
      ] }
    ],
    carried: { future: [], late: [], older: [] },
    campaigns: []
  };
  const statusIndex = { 'gpt-fbig-11-13': st('scheduled'), 'gpt-li-11-18': st('scheduled'), 'step|2026-11-16|Facebook + Instagram|2026-11-20': st('scheduled') };
  return assemblePlan({ today: TODAY, campaign, campaignRows: [], statusIndex, links: [], initiatives: [], quarters: [], actions: [], assets: [], txns: [], diary: [] });
}

test('socialGroup: Facebook + Instagram is one row, LinkedIn apart, email none', () => {
  assert.deepEqual(['Facebook + Instagram', 'Instagram', 'LinkedIn', 'Squarespace email', 'Outlook personal notes'].map(socialGroup), ['fbig', 'fbig', 'linkedin', null, null]);
});

test('superseded steps are left out of the content mix (like skipped) and listed apart', () => {
  const m = plan().purpose_mix;
  assert.ok(!m.items.some((x) => x.key === 'step|2026-11-09|Facebook + Instagram|2026-11-10'));
  assert.deepEqual(m.superseded.map((x) => x.key), ['step|2026-11-09|Facebook + Instagram|2026-11-10']);
});

test('covered by GPT post: same channel row and day only; not a step with its own placement; never email; never across rows', () => {
  const m = plan().purpose_mix;
  assert.deepEqual(m.covered.map((c) => [c.key, c.covered_by]), [
    ['step|2026-11-09|Facebook + Instagram|2026-11-13', 'gpt-fbig-11-13'],
    ['step|2026-11-16|LinkedIn|2026-11-18', 'gpt-li-11-18']
  ]);
  const counted = m.items.map((x) => x.key);
  assert.ok(counted.includes('step|2026-11-09|LinkedIn|2026-11-13'), 'LinkedIn on 13 Nov: the FB + IG post does not cover another channel');
  assert.ok(counted.includes('step|2026-11-16|Facebook + Instagram|2026-11-20'), 'a generated step with its own placement is counted');
  assert.ok(counted.includes('step|2026-11-16|Facebook + Instagram|2026-11-21'), 'no GPT post that day: counted (planned, no post yet)');
  assert.ok(counted.includes('step|2026-11-09|Squarespace email|2026-11-12'), 'email is never covered this way');
  assert.equal(m.items.length, m.deliveries + m.draft.deliveries);
  assert.deepEqual(coveredByGpt([{ key: 'step|x', day: '2026-11-13', channel: 'LinkedIn' }, { key: 'gpt-y', day: '2026-11-13', channel: 'LinkedIn' }]), [], 'a GPT step with no placement on the board is not a post');
});

test('by-channel tile, per channel: covered steps not counted (hover only), amber flag counts only steps with no post on that platform', () => {
  const win = {};
  vm.runInContext(fs.readFileSync(new URL('../lib/marketing-channels-tile.js', import.meta.url), 'utf8'), vm.createContext({ window: win, Intl, Date, Number, String, Map, Set, JSON, Math, Array, Object, RegExp }));
  const s = { quarter_plan: plan() };
  const pl = (key, placement, day) => ({ step_key: key, placement, planned_at: `${day}T18:30:00Z`, status: st('scheduled'), approved: true });
  const board = { placements: [pl('gpt-fbig-11-13', 'facebook_feed', '2026-11-13'), pl('gpt-fbig-11-13', 'instagram_feed', '2026-11-13'), pl('step|2026-11-16|Facebook + Instagram|2026-11-20', 'facebook_feed', '2026-11-20'), pl('step|2026-11-16|Facebook + Instagram|2026-11-20', 'instagram_feed', '2026-11-20'), pl('gpt-li-11-18', 'linkedin_feed', '2026-11-18')], content: [] };
  const m = JSON.parse(JSON.stringify(win.mkChannels.build(s, board, TODAY, Date.parse('2026-11-10T12:00:00Z'))));
  const row = (k) => m.rows.find((r) => r.key === k);
  for (const k of ['facebook', 'instagram']) assert.deepEqual([row(k).sched, row(k).planned, row(k).covered.length], [2, 1, 1], `${k}: 13 + 20 Nov posts; 21 Nov planned, no post; the generated 13 Nov step is covered, not counted`);
  assert.deepEqual([row('linkedin').sched, row('linkedin').planned, row('linkedin').covered.length], [1, 1, 1]);
  assert.equal(row('facebook').flags.find((f) => f.kind === 'planned').text, '1 planned step with no post yet');
  assert.deepEqual([row('email').covered.length, row('email').planned], [0, 1], 'email is never covered');
  const html = win.mkChannelsTileHtml(s, board, TODAY, Date.parse('2026-11-10T12:00:00Z'));
  assert.match(html, /data-mkch-row="facebook" title="Open the schedule: Facebook\n1 generated step not counted again \(GPT(&#39;|')s own Facebook post that day covers them\):\nFri 13 Nov: &quot;Post: tip \(generated\)&quot; → GPT post &quot;Norfolk: offer ends Saturday&quot;"/);
  assert.doesNotMatch(html.replace(/ title="[^"]*"/g, ''), /covered by GPT post|data-mkch-rec/, 'face: no grey covered note, no reconciliation line');
  assert.match(html, /Both tiles leave out 1 superseded step and 2 generated steps already covered by a GPT post on that channel and day/);
});

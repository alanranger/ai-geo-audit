/**
 * Marketing tab three sections (QUESTION-2026-11-08 waiting / planned / results):
 *  - Results: one row per post (FB / IG / Story of the same step grouped), emails only with provider evidence, and
 *    unknown figures stay unknown ("tomorrow" / "collecting" / "Mon entry" / "—"), never 0;
 *  - Waiting on you: Alan-only (GPT / Claude-owned actions, superseded / cancelled items never listed).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { emailRows, postRows, shortWhat } from '../lib/marketing/results.mjs';

const NOW = Date.parse('2026-11-08T21:00:00Z');

function browser(files, extra = {}) {
  const win = { ...extra };
  const el = () => ({ appendChild() {}, set textContent(v) {}, style: {} });
  const document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: el, head: { appendChild() {}, insertAdjacentHTML() {} }, addEventListener() {} };
  const c = vm.createContext({ window: win, document, Intl, Date, Number, String, Map, Set, JSON, Math, Promise, Array, Object, console, setTimeout, clearTimeout, MutationObserver: class { observe() {} }, localStorage: { getItem: () => null } });
  for (const f of files) vm.runInContext(fs.readFileSync(new URL(`../lib/${f}`, import.meta.url), 'utf8'), c);
  return win;
}
const strip = (h) => String(h).replace(/<[^>]+>/g, '');

/* ---------- results: grouping and evidence ---------- */

test('results: FB + IG + Story of one step are ONE row; LinkedIn of another step is its own row', () => {
  const posts = [{ channel: 'facebook', post_id: 'f1', posted_at: '2026-11-08T16:34:33Z', title: 'A few days with your camera', reach: 22, likes: 1, comments: 1, source: 'api' }];
  const evidenced = {
    replaced: new Set(['instagram|i1']),
    rows: [
      { channel: 'instagram', post_id: 'i1', posted_at: '2026-11-08T16:33:11Z', title: 'A few days with your camera', reach: 41, likes: 6, comments: 0, step_key: 'step|2026-11-02|Facebook + Instagram|2026-11-06', step_title: 'Post: "Last 2 places" for Norfolk 20–22 Nov', placement: 'feed', source: 'api', evidence: 'published' },
      { channel: 'instagram', post_id: 'evidence:x:story', posted_at: '2026-11-08T16:53:04Z', title: 'step', reach: null, likes: null, comments: null, step_key: 'step|2026-11-02|Facebook + Instagram|2026-11-06', step_title: 'Post: "Last 2 places" for Norfolk 20–22 Nov', placement: 'story', source: 'evidence', evidence: 'Story posted' },
      { channel: 'linkedin', post_id: 'evidence:y:feed', posted_at: '2026-11-08T16:22:20Z', title: 'step', reach: null, likes: null, comments: null, step_key: 'step|2026-11-02|LinkedIn|2026-11-04', step_title: 'Post: Lightroom course starts Thu 12 Nov', placement: 'feed', source: 'evidence', evidence: 'Published and verified on LinkedIn' }
    ]
  };
  const rows = postRows(posts, evidenced);
  assert.equal(rows.length, 2);
  const norfolk = rows.find((r) => r.step_keys.includes('step|2026-11-02|Facebook + Instagram|2026-11-06'));
  assert.deepEqual(norfolk.channels.map((c) => c.ch), ['facebook', 'instagram', 'story'], 'FB matched by same day + first line joins the IG step row');
  assert.equal(norfolk.what, 'Last 2 places for Norfolk 20–22…');
  const li = rows.find((r) => r.channels[0].ch === 'linkedin');
  assert.equal(li.channels[0].reach, null, 'LinkedIn before GPT\'s entry: unknown, not 0');
});

test('results: emails only with provider evidence; uncollected opens are null + "tomorrow", collected 0 stays 0', () => {
  const recs = [
    { campaign_key: 'theme|norfolk-workshops-8nov', title: 'Norfolk, Macro and something to watch', stage: 'sent', sent_on: '2026-11-08', scheduled_for: '2026-11-08T17:00:00Z', actual_sends: 311, schedule_evidence: 'operator_verified' },
    { campaign_key: 'event|lr30', title: 'Lightroom', stage: 'measured', sent_on: '2026-11-08', sqs_email_id: 'e1', actual_sends: 39 },
    { campaign_key: 'email|2026-11-02', title: 'Weekly email', stage: 'sent', sent_on: '2026-11-08' }
  ];
  const sqs = [
    { email_id: 'e1', subject: 'Lightroom starts Thursday — save 30% when you book today', sent_at: '2026-11-08T09:55:31Z', delivered: 39, opened: 7, clicked: 0, mailing_list_names: ['LR30 list'] },
    { email_id: 'e2', subject: 'Autumn in the Peak District', sent_at: '2026-10-22T17:38:46Z', delivered: 1098, opened: 288, clicked: 12 }
  ];
  const rows = emailRows(recs, sqs, NOW);
  assert.equal(rows.length, 3, 'record without evidence (marked sent only) is not a result; unlinked collected report is');
  const norfolk = rows.find((r) => r.campaign_key === 'theme|norfolk-workshops-8nov');
  assert.equal(norfolk.sent_to, 311);
  assert.equal(norfolk.opened, null);
  assert.equal(norfolk.opens_state, 'tomorrow');
  assert.equal(norfolk.sent_at, '2026-11-08T17:00:00Z', 'provider send time 17:00');
  const lr = rows.find((r) => r.campaign_key === 'event|lr30');
  assert.deepEqual([lr.sent_to, lr.opened, lr.clicked, lr.opens_state], [39, 7, 0, 'collected']);
  assert.deepEqual(lr.audience.lists, ['LR30 list']);
  assert.ok(!JSON.stringify(rows).includes('@'), 'no addresses in rows');
});

test('results: shortWhat keeps at most six words', () => {
  assert.equal(shortWhat('Post: "Last 3 places" for Lightroom course starts Thu'), 'Last 3 places for Lightroom course…');
  assert.equal(shortWhat('Lightroom course starts Thu'), 'Lightroom course starts Thu');
});

test('results cells: unknown is never 0 (tomorrow / collecting / Mon entry / —)', () => {
  const C = browser(['marketing-results.js']).mkResultsCells;
  const email = { kind: 'email', sent_to: 311, opened: null, clicked: null, opens_state: 'tomorrow', channels: [{ ch: 'email' }] };
  assert.equal(strip(C.openedCell(email)), 'tomorrow');
  assert.equal(strip(C.clickedCell(email)), 'tomorrow');
  assert.equal(strip(C.reactCell(email)), '—');
  const lr = { kind: 'email', sent_to: 39, opened: 7, clicked: 0, opens_state: 'collected', channels: [{ ch: 'email' }] };
  assert.equal(strip(C.openedCell(lr)), '7 (18%)');
  assert.equal(strip(C.clickedCell(lr)), '0', 'a collected 0 is a real 0');
  const post = { kind: 'social', channels: [{ ch: 'facebook', reach: 22, likes: 1, comments: 1 }, { ch: 'instagram', reach: null, likes: null, comments: null }, { ch: 'story', reach: null }] };
  assert.equal(strip(C.reachCell(post)), '22 · collecting');
  assert.equal(strip(C.reactCell(post)), '1·1 · collecting');
  assert.equal(strip(C.openedCell(post)), '—');
  const li = { kind: 'social', channels: [{ ch: 'linkedin', reach: null, likes: null, comments: null }] };
  assert.equal(strip(C.reachCell(li)), 'Mon entry');
  assert.equal(strip(C.reactCell(li)), 'Mon entry');
});

/* ---------- waiting on you: Alan-only ---------- */

function waitingWith(items, needs, queue) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const win = browser(['marketing-waiting.js'], {
    mkScheduleModel: { build: () => ({ items: items(today), needs }) },
    mkDeliveryItems: () => [],
    mkNeedsAlanQueue: () => queue,
    SocialStandard: { captionOf: () => { throw new Error('the production brief must not be read'); } },
    mkSocialReviewState: (k) => ({ 'li-ready': { public_caption: true, ready: true, blockers: [] }, gpt: { public_caption: true, ready: false, blockers: ['rendered image'] } }[k] || null)
  });
  return { rows: win.mkWaitingRows({}, { campaign: { weeks: [{ steps: [{ key: 'li-ready', brief: 'DRAFT\n\ncaption' }, { key: 'li-nocap', brief: '' }] }] } }).rows, today };
}
const plus = (iso, k) => new Date(Date.parse(`${iso}T12:00:00Z`) + k * 864e5).toISOString().slice(0, 10);

test('waiting on you: only Alan\'s own actions; GPT drafts as one approve row; superseded / cancelled never listed', () => {
  const items = (t) => [
    { id: 'linkedin|li-ready', row: 'linkedin', step_key: 'li-ready', state: 'pl', day: plus(t, 1), short: 'Norfolk: offer ends Saturday', draft: true },
    { id: 'linkedin|li-nocap', row: 'linkedin', step_key: 'li-nocap', state: 'pl', day: t, short: 'No caption yet (GPT writes it)', draft: true },
    { id: 'fbig|gpt', row: 'fbig', step_key: 'gpt', state: 'pl', day: plus(t, 1), short: 'Focus bracketing', draft: true },
    { id: 'email|gpt', row: 'email', record_key: 'theme|gpt-8w', state: 'pl', day: plus(t, 5), short: 'Gift email', draft: true },
    { id: 'email|old', row: 'email', record_key: 'email|2026-11-02', state: 'resolved', day: t, short: 'Superseded weekly', draft: false },
    { id: 'outlook|future', row: 'outlook', state: 'pl', day: plus(t, 4), short: 'Later note', draft: false },
    { id: 'fbig|late', row: 'fbig', state: 'late', day: plus(t, -2), short: 'GPT post late', draft: false }
  ];
  const queue = {
    decisions: [{ text: 'Review 2 blocked contacts showing as subscribed again', go: 'review' }, { text: 'Choose the audience for the weekly email, Sun 1 Nov', go: 'campaign' }],
    actions: [{ action_key: 'a-alan', label: 'Approve the gift copy', due_week_start: '2026-10-26' }]
  };
  const needs = [{ text: '3 late (FB/IG 3): do it or skip it.', ids: ['fbig|late'] }, { text: '1 marked scheduled with no platform evidence: confirm in Squarespace.', ids: ['email|x'] }];
  const { rows } = waitingWith(items, needs, queue);
  const text = rows.map((r) => `${r.what} | ${r.why} | ${strip(r.btn)}`).join('\n');
  assert.match(text, /Approve caption & artwork: Norfolk: offer ends Saturday \| Caption & artwork ready · GPT posts after you approve \| Review/);
  assert.match(text, /Approve caption & artwork: Focus bracketing \| Caption ready · missing: rendered image \| Review/, 'blockers from the stored-caption state');
  assert.ok(!/post it|Copy caption/.test(text), 'never a "post it" task: GPT publishes');
  const li = rows.find((r) => /Norfolk: offer ends/.test(r.what));
  assert.match(li.btn, /data-mkw-review="li-ready"/, 'Review calls the review-first hook');
  assert.match(text, /Approve GPT's \d-week plan \(1 email · 1 post\) \| Drafts ready · nothing goes out until you approve \| Review/, 'GPT drafts: one approve row (uncaptioned LinkedIn draft); posts listed for approval are not counted in it');
  assert.ok(!/No caption yet/.test(text), 'a post without GPT\'s stored caption is GPT\'s job, not listed');
  assert.ok(!/Gift email|GPT post late/.test(text), 'GPT-owned items never listed one by one');
  assert.ok(!/Superseded|late \(FB\/IG/.test(text), 'superseded items and the generic late line never listed');
  assert.ok(!/Later note/.test(text), 'future items stay in Planned');
  assert.ok(!/Choose the audience for the weekly email, Sun 1 Nov/.test(text), 'audience decision for a week with no live weekly email (superseded) is dropped');
  assert.match(text, /Review 2 blocked contacts/);
  assert.match(text, /Approve the gift copy \| Late · quarter action/);
  assert.match(text, /no platform evidence/);
  assert.ok(rows.every((r) => !/\b(email|event|theme|step)\|/.test(r.what)), 'no raw keys');
});

test('waiting on you: tile 7 hook keeps GPT / Claude-owned quarter actions out', () => {
  const win = browser(['marketing-overview-tiles.js']);
  const s = {
    actions: [
      { id: 'a1', action_key: 'a-alan', label: 'Alan task', due_week_start: '2026-11-09', is_ticked: false },
      { id: 'a2', action_key: 'a-gpt', label: 'GPT task', due_week_start: '2026-11-09', is_ticked: false },
      { id: 'a3', action_key: 'a-claude', label: 'Claude task', due_week_start: '2026-11-09', is_ticked: false },
      { id: 'a4', action_key: 'a-wait', label: 'Waiting task', due_week_start: '2026-11-09', is_ticked: false, status: 'waiting' }
    ],
    quarter_plan: { action_owner: { 'a-alan': 'Alan', 'a-gpt': 'GPT', 'a-claude': 'Claude' } },
    campaign: { campaigns: [], step_status: {} }
  };
  const q = win.mkNeedsAlanQueue({ tiles: {}, identity: {} }, s);
  assert.deepEqual(q.actions.map((a) => a.label), ['Alan task']);
});

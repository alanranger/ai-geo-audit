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
import { emailRows, placementRows, postRows, shortWhat, titleOf, youtubeId } from '../lib/marketing/results.mjs';
import { alanActions, decisionIndex, isPublished, openDecisions, outlookDue, releaseBlockers, releaseSplit } from '../lib/marketing/decision-state.mjs';
import { bookingsFor, eventFromKey, eventsBySubject, linkedEvents, onePerPage } from '../lib/marketing/results-bookings.mjs';
import { campaignSheets } from '../lib/strategy-campaigns.mjs';

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

test('results: one row per actual send, keyed by provider id (draft id, or same time + size); plan title kept as detail', () => {
  const recs = [
    { campaign_key: 'theme|norfolk-workshops-8nov', title: 'Norfolk, Macro and something to watch', stage: 'sent', scheduled_for: '2026-11-08T17:00:00Z', actual_sends: 311, schedule_evidence: 'operator_verified', sqs_draft_id: 'p1' },
    { campaign_key: 'theme|creative-next-step-8nov', title: 'Your next photography step', stage: 'sent', scheduled_for: '2026-11-08T17:00:00Z', actual_sends: 231, schedule_evidence: 'operator_verified' }
  ];
  const sqs = [
    { email_id: 'p1', subject: 'Norfolk, 20–22 November — last 2 places, £150 off', sent_at: '2026-11-08T17:00:13Z', delivered: 311, opened: 113, clicked: 9, events_collected_at: '2026-11-09T06:00:00Z' },
    { email_id: 'p2', subject: 'A fresh photography idea — Macro', sent_at: '2026-11-08T17:00:13Z', delivered: 231, opened: 72, clicked: 3 }
  ];
  const rows = emailRows(recs, sqs, NOW);
  assert.equal(rows.length, 2, 'two sends, two rows (no stale plan rows)');
  const n = rows.find((r) => r.sent_to === 311);
  assert.deepEqual([n.provider_id, n.what, n.plan, n.opens_state, n.opens_at], ['p1', 'Norfolk, 20–22 November — last 2…', 'Norfolk, Macro and something to watch', 'collected', '2026-11-09T06:00:00Z']);
  assert.equal(rows.find((r) => r.sent_to === 231).provider_id, 'p2', 'matched by the same send time and recipient count');
});

test('results: emails only with provider evidence; uncollected opens are null + "collecting", collected 0 stays 0', () => {
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
  assert.equal(norfolk.opens_state, 'collecting');
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

test('results cells: unknown is never 0 (collecting / Mon entry / —); sent rows never say "tomorrow"', () => {
  const C = browser(['marketing-results.js']).mkResultsCells;
  const email = { kind: 'email', sent_to: 311, opened: null, clicked: null, opens_state: 'collecting', channels: [{ ch: 'email' }] };
  assert.equal(strip(C.openedCell(email)), 'collecting');
  assert.equal(strip(C.clickedCell(email)), 'collecting');
  assert.match(strip(C.openedCell({ kind: 'email', sent_to: 311, opened: 113, opens_state: 'collected', opens_at: '2026-11-09T06:00:00Z' })), /^113 \(36%\)collected 9 Nov$/);
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

/* ---------- correction 1: bookings after, titles ---------- */

const NORFOLK = eventFromKey('2026-11-20|/photographic-workshops-near-me/norfolk-photography-workshop', 'Norfolk Photography Workshop | Cromer to Hunstanton', 'Norfolk');
const LR = eventFromKey('2026-11-12|/beginners-photography-lessons/lightroom-photo-editing-classes-wk1-kdh5k', 'Lightroom Classic Photo Editing Classes - Week 1 of 3 -12-11', 'Lightroom course');
const MACRO = eventFromKey('2026-11-28|/photographic-workshops-near-me/abstract-macro', 'Abstract and Macro Photography', 'Abstract & Macro');
const LAKES = eventFromKey('2027-01-22|/photo-workshops-uk/lake-district', 'Lake District Photography Workshop', 'Lake District');

test('bookings after: linked event with nothing booked = 0 / £0 (not "—"); no linked event = null; booked after the send counted', () => {
  const sheets = campaignSheets(
    [{ txn_date: '2026-10-01', category_order: 2, amount: 345, client_name: 'A' }, { txn_date: '2026-11-09', category_order: 2, amount: 345, client_name: 'B' }],
    [], [{ event_start: '2026-11-20', theme_location: 'Norfolk', client_name: 'A' }, { event_start: '2026-11-20', theme_location: 'Norfolk', client_name: 'B' }]
  );
  const row = { kind: 'email', sent_at: '2026-11-08T17:00:00Z' };
  assert.deepEqual(bookingsFor(row, [{ ev: NORFOLK, basis: 'campaign record' }], sheets).after, { bookings: 1, revenue: 345 }, 'only the booking on/after the send day');
  assert.deepEqual(bookingsFor(row, [{ ev: LR, basis: 'campaign record' }], campaignSheets([], [], [])).after, { bookings: 0, revenue: 0 });
  assert.equal(bookingsFor(row, [], sheets), null);
  const C = browser(['marketing-results.js']).mkResultsCells;
  assert.equal(strip(C.bookCells({ bookings: { after: { bookings: 0, revenue: 0 }, events: [] } })), '0£0');
  assert.equal(strip(C.bookCells({ bookings: null })), '——');
});

test('promoted events: record key, the post\'s featured event, or subject words for a theme email (never "District" alone)', () => {
  const catalog = onePerPage([NORFOLK, LR, MACRO, LAKES, eventFromKey('2026-11-13|https://www.alanranger.com/photographic-workshops-near-me/norfolk-photography-workshop', 'https://www.alanranger.com/x', 'Norfolk: offer ends Saturday'), eventFromKey('2026-11-20|/photo-workshops-uk/landscape-photography-workshop-norfolk', 'Norfolk: offer ends Saturday', 'Norfolk: offer ends Saturday')]);
  assert.equal(catalog.filter((e) => /norfolk/.test(e.url)).length, 1, 'one Norfolk event: same page / same date + name merged');
  const ctx = { catalog, featured: new Map([['step|fb', [{ event_key: NORFOLK.event_key, title: NORFOLK.title, name: 'Norfolk' }]]]) };
  const titles = (r) => linkedEvents(r, ctx).map((x) => x.ev.title);
  assert.deepEqual(titles({ kind: 'email', sent_at: '2026-11-08T17:00:00Z', step_keys: [], event_keys: [], copy: 'Norfolk, Macro and something to watch' }), ['Norfolk Photography Workshop | Cromer to Hunstanton', 'Abstract and Macro Photography']);
  assert.deepEqual(titles({ kind: 'email', sent_at: '2026-11-08T09:55:00Z', step_keys: [], event_keys: [LR.event_key], event_title: LR.title, copy: 'x' }), [LR.title]);
  assert.deepEqual(titles({ kind: 'social', sent_at: '2026-11-08T16:53:00Z', step_keys: ['step|fb'] }), [NORFOLK.title]);
  assert.deepEqual(eventsBySubject('Autumn in the Peak District', catalog, '2026-10-22'), [], '"District" alone never links the Lake District');
});

test('Results titles: never a URL (linked video title, else first text line)', () => {
  const yt = new Map([['sWIDyUVp260', 'How to Find Your Photography Style']]);
  assert.equal(youtubeId('https://youtu.be/sWIDyUVp260'), 'sWIDyUVp260');
  assert.equal(titleOf({ title: 'https://youtu.be/sWIDyUVp260' }, yt), 'How to Find Your Photography Style');
  assert.equal(titleOf({ title: 'https://youtu.be/sWIDyUVp260' }), 'YouTube video');
  assert.equal(titleOf({ title: 'https://example.com/a\nA walk in the woods https://x.y' }), 'A walk in the woods');
  assert.equal(titleOf({ title: '' }), 'Post (no caption)');
  const rows = postRows([{ channel: 'facebook', post_id: 'f9', posted_at: '2026-11-02T13:31:45Z', title: 'https://youtu.be/sWIDyUVp260', reach: 37, source: 'api' }], { replaced: new Set(), rows: [] }, yt);
  assert.ok(!/https?:/.test(rows[0].what) && !/https?:/.test(rows[0].title));
});

/* ---------- shared decision state (decisions close everywhere) ---------- */

const TODAY = '2026-11-09';
const placement = (step, extra = {}) => ({ step_key: step, placement: 'linkedin_feed', stage: 'prepare', planned_at: '2026-11-10T08:30:00Z', public_caption: 'Three days on the coast.', link_url: 'https://www.alanranger.com/x', assets: { linkedin: { storage_path: 'a.png' } }, ...extra });

test('decision state: release approval only when caption + rendered asset + link are ready; else GPT production queue; published never asked', () => {
  const steps = new Map([['ready', { title: 'Norfolk: offer ends Saturday' }], ['macro', { title: 'What focus bracketing actually helps with' }], ['pub', { title: 'Norfolk coastal workshop' }]]);
  const pls = [
    placement('ready'),
    placement('macro', { placement: 'facebook_feed', assets: {} }),
    placement('pub', { planned_at: '2026-11-09T08:30:00Z', stage: 'live_check', provider_id: 'urn:li:activity:1', provider_url: 'https://www.linkedin.com/feed/update/urn:li:activity:1/' }),
    placement('later', { planned_at: '2026-11-20T08:30:00Z' })
  ];
  const r = releaseSplit(pls, steps, TODAY);
  assert.deepEqual(r.ready.map((x) => x.step_key), ['ready']);
  assert.deepEqual(r.production.map((x) => [x.step_key, x.blockers.join()]), [['macro', 'rendered asset']], 'Macro without its rendered asset goes to GPT, not to Alan');
  assert.ok(isPublished(pls[2]));
  assert.deepEqual(releaseBlockers(placement('x', { public_caption: 'Use the AR-social-v1 LinkedIn feed master. App plan only.' })), ['internal text in the caption']);
});

test('decision state: recorded decisions close (plan approved, kept blocked, deferred note); owners other than Alan never listed', () => {
  const idx = decisionIndex([
    { kind: 'plan_approved', ref_key: 'gpt-8w-2026-11', decided_at: '2026-11-09T09:02:39Z', decided_by: 'Alan (GPT chat)' },
    { kind: 'keep_blocked', ref_key: 'h1' }, { kind: 'keep_blocked', ref_key: 'h2' },
    { kind: 'deferred', ref_key: 'step|2026-11-09|Outlook personal notes|2026-11-09' }
  ]);
  const steps = new Map([['step|2026-11-09|Outlook personal notes|2026-11-09', { key: 'step|2026-11-09|Outlook personal notes|2026-11-09', channel: 'Outlook personal notes', day: TODAY, title: 'Hay Woods', done: false }],
    ['step|2026-11-10|Outlook personal notes|2026-11-10', { key: 'step|2026-11-10|Outlook personal notes|2026-11-10', channel: 'Outlook personal notes', day: '2026-11-10', title: 'Lake District note', done: false }]]);
  const actions = alanActions([
    { action_key: 'a-alan', label: 'Alan task', due_week_start: '2026-11-09', is_ticked: false },
    { action_key: 'a-gpt', label: 'GPT task', due_week_start: '2026-11-09', is_ticked: false },
    { action_key: 'a-wait', label: 'Waiting task', due_week_start: '2026-11-09', is_ticked: false, status: 'waiting' }
  ], [{ ref_type: 'action', ref_key: 'a-alan', initiative_key: 'i1' }, { ref_type: 'action', ref_key: 'a-gpt', initiative_key: 'i2' }], new Map([['i1', { owner: 'Alan' }], ['i2', { owner: 'GPT' }]]), TODAY);
  const open = openDecisions({ today: TODAY, planApproved: idx.planApproved, drafts: 36, release: [], outlook: outlookDue(steps, TODAY, idx.deferred), blockedOpen: 0, actions, verified: [] });
  const text = open.map((o) => `${o.type}: ${o.what}`).join('\n');
  assert.ok(!/plan/.test(open.map((o) => o.type).join()), 'overall plan approved: never asked again');
  assert.ok(!/Hay Woods/.test(text), 'deferred note is gone');
  assert.match(text, /outlook_note: Lake District note/);
  assert.match(text, /quarter_action: Alan task/);
  assert.ok(!/GPT task|Waiting task/.test(text));
  assert.ok(!/blocked/.test(text), 'kept-blocked contacts: no review row');
  assert.equal(openDecisions({ today: TODAY, planApproved: null, drafts: 3, release: [], outlook: [], blockedOpen: 2, actions: [], verified: [] }).length, 2, 'without the records: plan + blocked are open');
});

test('Waiting on you renders exactly the shared open list (same count as Strategy); buttons reuse existing paths', () => {
  const win = browser(['marketing-waiting.js'], { mkScheduleModel: { build: () => ({ items: [{ id: 'linkedin|r', step_key: 'r', state: 'pl', day: '2026-11-10', short: 'Norfolk: offer ends' }], needs: [] }) }, mkDeliveryItems: () => [] });
  const dec = { open: [
    { type: 'release_approval', step_key: 'r', due: '2026-11-10', what: 'Approve caption & artwork: Norfolk: offer ends Saturday', channel: 'linkedin', why: 'Caption, artwork and link ready · GPT posts after you approve' },
    { type: 'quarter_action', due: '2026-11-02', late: true, what: 'Alan task', channel: 'none', why: 'Late · quarter action' }
  ], count: 2 };
  const { rows, moved } = win.mkWaitingRows(dec, { items: [{ id: 'linkedin|r', step_key: 'r', state: 'pl', short: 'Norfolk: offer ends' }] });
  assert.equal(rows.length, dec.count);
  assert.match(rows[0].btn, /data-mkw-review="r"/);
  assert.match(rows[0].btn, />Review</);
  assert.match(rows[1].due, /late/);
  assert.deepEqual([...moved], ['linkedin|r'], 'listed item hidden from the schedule cards');
});

test('Results: a placement GPT recorded as published is a post row (joined to its collected post by permalink)', () => {
  const evidenced = { rows: [], replaced: new Set() };
  const pl = [{ step_key: 'gpt-event-2026-11-09-norfolk-li', placement: 'linkedin_feed', provider_id: 'urn:li:activity:7525483905408335872', provider_url: 'https://www.linkedin.com/feed/update/urn:li:activity:7525483905408335872/', actual_at: '2026-11-09T09:06:19Z', public_caption: 'Three days on the North Norfolk coast…' }];
  const out = placementRows(pl, [], evidenced, [{ step_key: 'gpt-event-2026-11-09-norfolk-li', step: 'Norfolk coastal workshop · 20–22 November' }]);
  assert.equal(out.length, 1);
  assert.deepEqual([out[0].channel, out[0].placement, out[0].step_title, out[0].posted_at], ['linkedin', 'feed', 'Norfolk coastal workshop · 20–22 November', '2026-11-09T09:06:19Z']);
  const collected = [{ channel: 'linkedin', post_id: 'li1', permalink: 'https://www.linkedin.com/feed/update/urn:li:activity:7525483905408335872', posted_at: '2026-11-09T09:06:00Z', title: 'x', reach: 120 }];
  const joined = placementRows(pl, collected, { rows: [], replaced: new Set() }, []);
  assert.equal(joined[0].reach, 120, 'collected figures used when the permalink matches');
});


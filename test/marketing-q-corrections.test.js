/**
 * QUESTION-2026-11-09 (q) marketing / strategy corrections from GPT's post-reboot audit: drawer and cards read the
 * same authoritative status as the List (1), per-placement statuses + "Partly scheduled" (2), Light & Logic on hold (3),
 * the real Squarespace subject (4), "Approved · waiting for platform window" apart from drafts (5), Google optional
 * posts owned by GPT (6), the credits label (7), the completed backfill (8 is DOM-only, checked live), a skipped
 * refresh closes its run (9), the board-only early List (10) and the Quarter plan "Next" title (13).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { HOLDS, onHoldStatus } from '../lib/marketing/delivery-status.mjs';
import { closeIdleRefresh, REFRESH_RUN } from '../lib/marketing/delivery-status-board.mjs';
import { attachStatus, statusIndex } from '../lib/strategy-delivery-status.mjs';
import { approvedWaiting, nextActionOf, purposeMix } from '../lib/strategy-initiatives.mjs';
import { GBP_OPTIONAL_OWNER, googleBusinessExceptions } from '../lib/strategy-board-rows.mjs';

function loadSchedule(extra = {}) {
  const listeners = [];
  const win = { localStorage: { getItem: () => null, setItem: () => {} }, ...extra };
  const document = { getElementById: () => null, addEventListener: (t, fn) => listeners.push([t, fn]), createElement: () => ({}), head: { appendChild: () => {}, insertAdjacentHTML: () => {} } };
  const ctx = vm.createContext({ window: win, document, localStorage: win.localStorage, Intl, Date, Number, String, Map, Set, JSON, Math, Promise, Array, Object, RegExp, console, encodeURIComponent, setTimeout, MutationObserver: class { observe() {} } });
  for (const f of ['../lib/marketing-schedule-model.js', '../lib/marketing-schedule-list.js', '../lib/marketing-schedule.js']) vm.runInContext(fs.readFileSync(new URL(f, import.meta.url), 'utf8'), ctx);
  const setBoard = (board) => listeners.filter(([t]) => t === 'mk-status-refreshed').forEach(([, fn]) => fn({ detail: board }));
  return { win, setBoard };
}
const st = (code, label, icon, extra = {}) => ({ code, label, icon, tone: 'blue', ...extra });
const SCHED = (when) => st('scheduled', 'Scheduled on platform', '🕒', { when, evidence: 'verified by GPT in the native queue (no ID available)' });
const STORY = st('story_ready', 'Story ready to publish', '📱', { tone: 'grey' });
const pl = (placement, status, extra = {}) => ({ step_key: 'gpt-8w-social-2026-11-10-fbig', placement, planned_at: '2026-11-10T18:30:00Z', approved: placement !== 'instagram_story', status, ...extra });
const HOLD = { match: HOLDS[0].match.source, by: 'Alan', at: '2026-11-09', reason: HOLDS[0].reason, dependency: HOLDS[0].dependency };

test('item 2: a combined FB / IG / Story row names every placement; mixed → "Partly scheduled", never all done', () => {
  const { win } = loadSchedule();
  const L = win.mkScheduleList;
  const mixed = L.combinePlacements([pl('facebook_feed', SCHED('Facebook Tue 10 Nov 6:30pm')), pl('instagram_feed', SCHED('Instagram Tue 10 Nov 6:30pm')), pl('instagram_story', STORY)]);
  assert.deepEqual([mixed.code, mixed.label, mixed.blocker], ['partly_scheduled', 'Partly scheduled', 'FB feed scheduled · IG feed scheduled · IG Story pending (GPT)']);
  const all = L.combinePlacements([pl('facebook_feed', SCHED('x')), pl('instagram_feed', SCHED('x')), pl('instagram_story', SCHED('x'))]);
  assert.deepEqual([all.code, all.label, all.blocker], ['scheduled', 'Scheduled on platform', 'FB feed scheduled · IG feed scheduled · IG Story scheduled']);
  const one = L.combinePlacements([pl('linkedin_feed', SCHED('LinkedIn Wed 11 Nov 8:30am'))]);
  assert.ok(!one.blocker, 'a single placement adds no per-placement line');
});

test('item 1: grid cards follow the board (scheduled fill, no "draft" badge or "draft ·" time) once the platform has the post', () => {
  const { win, setBoard } = loadSchedule();
  const M = win.mkScheduleModel;
  const item = { channel: 'facebook', key: 'gpt-8w-social-2026-11-10-fbig|facebook', title: 'Post: What focus bracketing can do', planned: '2026-11-10', planned_at: '2026-11-10T18:30:00Z', status: 'prep', step: 'Post: What focus bracketing can do' };
  const m = M.build({ items: [item], today: '2026-11-09' });
  const x = m.items.find((y) => y.row === 'fbig');
  assert.equal(x.draft, true, 'the model still sees a manual step');
  const before = win.mkScheduleLayout(m, 'weeks', 'dates');
  assert.match(before, /draft/);
  setBoard({ placements: [pl('facebook_feed', SCHED('Facebook Tue 10 Nov 6:30pm')), pl('instagram_feed', SCHED('Instagram Tue 10 Nov 6:30pm')), pl('instagram_story', SCHED('Instagram Tue 10 Nov 6:30pm'))], emails: [], tasks: [], holds: [] });
  const after = win.mkScheduleLayout(m, 'weeks', 'dates');
  assert.match(after, /mks-card mini s-sch/);
  assert.ok(!/mks-dbadge|draft ·/.test(after), 'no draft badge once scheduled on the platform');
  assert.match(after, /Scheduled on platform/);
});

test('item 3: Light & Logic is "On hold (Alan)": dependency kept visible, no GPT production date, no implied promotion', () => {
  const s = onHoldStatus('gpt-ll-newsletter-2026-11-15');
  assert.deepEqual([s.code, s.label, s.blocker], ['on_hold', 'On hold (Alan)', 'deferred until the backlog is cleared']);
  assert.match(s.evidence, /planned dependency kept/);
  assert.equal(onHoldStatus('gpt-8w-social-2026-11-10-fbig'), null);
  const { win } = loadSchedule();
  const L = win.mkScheduleList;
  const ll = { id: 'linkedin|gpt-ll-newsletter-2026-11-15|linkedin', row: 'linkedin', key: 'gpt-ll-newsletter-2026-11-15|linkedin', step_key: 'gpt-ll-newsletter-2026-11-15', title: 'Light & Logic newsletter (LinkedIn) · November edition', short: 'L&L', day: '2026-11-15', state: 'pl', draft: true, raw: {} };
  const promotions = [{ edition_step_key: 'gpt-ll-newsletter-2026-11-15', edition_day: '2026-11-15', campaign_key: 'theme|gpt-8w-2026-11-19', planned_send_on: '2026-11-19', stage: 'drafted' }];
  const env = { board: { placements: [], emails: [], tasks: [], holds: [HOLD] }, promotions };
  env.status = (y) => L.statusOf(y, env);
  assert.equal(env.status(ll).label, 'On hold (Alan)');
  const html = L.listHtml({ today: '2026-11-09', items: [ll], byId: new Map([[ll.id, ll]]), s: null }, { range: { from: '2026-11-09', to: '2026-11-15' }, channel: 'all' }, env);
  assert.match(html, /⏸<\/i>On hold \(Alan\)/);
  assert.match(html, /on hold \(Alan\): nothing is being produced until he resumes it/);
  assert.match(html, /planned dependency \(paused while on hold\): module in the 19 Nov email \(draft\)/);
  assert.ok(!/being prepared by GPT|promoted in:|Planned/.test(html), 'no implied production or promotion');
  const published = { ...env, board: { ...env.board, placements: [{ step_key: ll.step_key, placement: 'linkedin_feed', status: st('published', 'Published', '✅') }] } };
  published.status = (y) => L.statusOf(y, published);
  assert.equal(published.status(ll).code, 'published', 'a confirmed publication is never hidden by a hold');
});

test('item 3 / 13 (server): a held delivery carries "On hold" and is never the next action', () => {
  const list = attachStatus([{ key: 'gpt-ll-newsletter-2026-11-15', day: '2026-11-15', channel: 'LinkedIn', title: 'Light & Logic', status: 'pending', draft: true }], {});
  assert.equal(list[0].delivery_status.code, 'on_hold');
  assert.equal(nextActionOf({}, list, '2026-11-09'), null);
});

test('item 4: the List shows the real Squarespace subject under the friendly campaign name (only when it differs)', () => {
  const { win } = loadSchedule();
  const L = win.mkScheduleList;
  const mk = (key, title) => ({ id: `email|${key}`, row: 'email', key, record_key: key, title, short: title, day: '2026-11-12', state: 'sch', people: 10, raw: { planned_at: '2026-11-12T09:30:00Z', delivery: { aud: { people: 10, business_copy: 1, sends: 11 } } } });
  const a = mk('theme|academy', 'Academy next step');
  const b = mk('theme|pnm', 'Pick n Mix');
  const env = { board: { emails: [{ key: a.key, subject: 'Your next step in the Academy', status: SCHED('Scheduled Thu 12 Nov 9:30am') }, { key: b.key, subject: 'pick n mix', status: SCHED('x') }], placements: [], tasks: [] } };
  env.status = (y) => L.statusOf(y, env);
  const html = L.listHtml({ today: '2026-11-09', items: [a], byId: new Map([[a.id, a]]), s: null }, { range: { from: '2026-11-09', to: '2026-11-15' }, channel: 'all' }, env);
  assert.match(html, /Squarespace subject: “Your next step in the Academy”/);
  const same = L.listHtml({ today: '2026-11-09', items: [b], byId: new Map([[b.id, b]]), s: null }, { range: { from: '2026-11-09', to: '2026-11-15' }, channel: 'all' }, env);
  assert.ok(!same.includes('Squarespace subject'), 'same text (ignoring case) is not repeated');
});

test('item 5: approved content waiting for the platform window is "approved · waiting", not a draft; scheduled is never a draft', () => {
  const d = (key, purpose = 'inspire') => ({ key, day: '2026-12-08', channel: 'Facebook + Instagram', title: key, status: 'pending', draft: true, modules: [{ purpose }], purpose: { primary: purpose }, purpose_source: 'rule' });
  const board = { placements: [
    { step_key: 'wait', placement: 'facebook_feed', approved: true, status: st('waiting_window', 'Ready, waiting for Meta\'s window', '⏳') },
    { step_key: 'wait', placement: 'instagram_story', approved: false, status: STORY },
    { step_key: 'sch', placement: 'facebook_feed', approved: true, status: SCHED('x') },
    { step_key: 'draft', placement: 'facebook_feed', approved: false, status: st('in_preparation', 'In preparation', '📄') }
  ], emails: [], tasks: [] };
  const idx = statusIndex(board);
  assert.equal(idx.wait.approved, true, 'approval is per step: any placement Alan approved');
  const list = attachStatus([d('wait'), d('sch'), d('draft')], idx);
  assert.deepEqual(list.map((x) => x.draft), [false, false, true]);
  assert.deepEqual(list.map(approvedWaiting), [true, false, false]);
  const mix = purposeMix(list, { from: 'a', to: 'b' });
  assert.deepEqual([mix.deliveries, mix.waiting.deliveries, mix.draft.deliveries, mix.waiting.label], [2, 1, 1, 'Approved · waiting for platform window']);
});

test('item 5 (tile): the content-mix tile splits "Approved · waiting for platform window" from drafts', () => {
  const win = {};
  const c = vm.createContext({ window: win, document: { getElementById: () => null, querySelector: () => null, head: { insertAdjacentHTML: () => {} } }, Intl, Date, Number, String, Map, Set, JSON, Math, Promise, Array, Object, console, setTimeout });
  vm.runInContext(fs.readFileSync(new URL('../lib/marketing-overview-tiles.js', import.meta.url), 'utf8'), c);
  const T = win.mkOverviewTiles;
  const pm = { window: { from: '2026-11-09', to: '2026-12-06' }, deliveries: 12, by_primary: { sell: 6, educate: 2, inspire: 4, nurture: 0 }, waiting: { deliveries: 3, by_primary: { inspire: 3 } }, draft: { deliveries: 2, by_primary: { sell: 2 } }, set_by_hand: 0, by_rule: 12, modules: { total: 0, by_purpose: {} } };
  const html = T.tileHtml(T.tileMix({ quarter_plan: { purpose_mix: pm } }));
  assert.match(html, /Approved · waiting for platform window: 3/);
  assert.match(html, /Scheduled \/ approved: Sell 6 · Educate 2 · Inspire 1 · Nurture 0/, 'waiting split out of the scheduled bar');
  assert.match(html, /Drafts \(not approved\): Sell 2/);
});

test('item 6: Google optional-post briefs are owned by GPT; Alan only for a genuine commercial approval', () => {
  assert.equal(GBP_OPTIONAL_OWNER, 'GPT');
  const row = { type: 'moment', moment: 'offer', event_key: 'norfolk|2026-12-01', name: 'Norfolk', date: '2026-12-01', when: '1 Dec', offer: { code: 'NORFOLK150', ends: '2026-11-14', note: '£150 off' }, keys: [] };
  const out = googleBusinessExceptions([{ week: '2026-11-09', board: { all: [row], days: { 'FB+IG offer': '2026-11-13' } } }], { google_business: { from: '2026-11-09' } }, '2026-11-09');
  const s = out.get('2026-11-09')[0];
  assert.equal(s.owner, 'GPT');
  assert.match(s.brief, /owner GPT: drafts and posts it/);
  assert.ok(!/Alan approves and posts/.test(s.brief));
});

test('item 7: "648 client recipients + 5 business copies = 653 credits", computed from the committed sends', () => {
  const win = { localStorage: { getItem: () => null, setItem: () => {} } };
  const ctx = vm.createContext({ window: win, document: { getElementById: () => null, head: { insertAdjacentHTML: () => {} } }, localStorage: win.localStorage, Intl, Date, Number, String, Map, Set, JSON, Math, Promise, console });
  vm.runInContext(fs.readFileSync(new URL('../lib/marketing-delivery.js', import.meta.url), 'utf8'), ctx);
  const people = [127, 370, 110, 38, 3];
  const deliveries = people.map((p, i) => ({ key: `k${i}`, bucket: 'committed', side: 'current', aud: { people: p, business_copy: 1, sends: p + 1 } }));
  deliveries.push({ key: 'next', bucket: 'committed', side: 'next', aud: { people: 500, business_copy: 1, sends: 501 } }, { key: 'gone', bucket: 'committed', side: 'current', cancelled: true, aud: { people: 9, business_copy: 1, sends: 10 } });
  const cap = { quota: 5000, used: 3090, committed: 653, missing_audiences: 0, next_cycle: { starts_at: '2026-11-12T12:51:47Z', unbudgeted: 0, allowance: 5000, committed: 0 }, unallocated: { items: 0 } };
  const c = win.mkCapacity({ meter: { capacity: cap, deliveries } }, null);
  assert.equal(win.mkCreditsLabel(c.credit_split), '648 client recipients + 5 business copies = 653 credits');
  const rows = win.mkCapacityRows(c);
  assert.match(rows.find((r) => r[0].startsWith('Committed'))[1], /648 client recipients \+ 5 business copies = 653 credits/);
});

function fakeSb(run, request) {
  const updates = [];
  const q = (table) => {
    const chain = { select: () => chain, eq: () => chain, order: () => chain, limit: () => chain, update: (row) => { updates.push({ table, row }); return { eq: async () => ({ error: null }) }; } };
    chain.maybeSingle = async () => ({ data: table === 'marketing_collector_runs' ? run : request });
    return chain;
  };
  return { from: q, updates };
}

test('item 9: a refresh whose Squarespace check was skipped as already collected closes its run (ok + finished_at)', async () => {
  const run = { run_id: 'r1', status: 'running', started_at: new Date().toISOString(), summary: { meta: { ok: true, results: [] }, youtube: { ok: true, videos: 7 }, outcome: { state: 'partial', text: 'partial: Squarespace still queued' } } };
  const sb = fakeSb(run, { status: 'skipped', finished_at: '2026-11-09T17:07:41Z', result: { reason: 'already collected after the due time' } });
  const out = await closeIdleRefresh(sb, { job: null, skipped: 1 }, '2026-11-09T17:07:41Z');
  assert.equal(out.state, 'complete');
  assert.equal(sb.updates.length, 1);
  assert.deepEqual([sb.updates[0].table, sb.updates[0].row.status, sb.updates[0].row.finished_at], ['marketing_collector_runs', 'ok', '2026-11-09T17:07:41Z']);
  assert.equal(sb.updates[0].row.summary.squarespace.result.reason, 'already collected after the due time');
  assert.equal(REFRESH_RUN, 'status-refresh');
});

test('item 9: nothing is written while the check is still queued, or while the queue is busy with a job', async () => {
  const run = { run_id: 'r1', status: 'running', started_at: new Date().toISOString(), summary: { meta: { ok: true }, youtube: { ok: true } } };
  const queued = fakeSb(run, { status: 'queued' });
  assert.match((await closeIdleRefresh(queued, { job: null })).text, /still queued/);
  assert.equal(queued.updates.length, 0);
  const busy = fakeSb(run, { status: 'skipped' });
  assert.equal(await closeIdleRefresh(busy, { job: { request_ids: ['a'] } }), null);
  assert.equal(await closeIdleRefresh(busy, { job: null, waiting: 'a collector run is already in progress' }), null);
  assert.equal(busy.updates.length, 0);
});

test('item 10: before the overview the List renders from the status board alone (one status source, no plan-derived drafts)', async () => {
  const board = {
    placements: [pl('facebook_feed', SCHED('Facebook Tue 10 Nov 6:30pm'), { title: 'Post: What focus bracketing can do' }), pl('instagram_feed', SCHED('Instagram Tue 10 Nov 6:30pm'), { title: 'Post: What focus bracketing can do' }), pl('instagram_story', STORY, { title: 'Post: What focus bracketing can do' })],
    emails: [{ key: 'theme|academy', title: 'Academy next step', subject: 'Your next step in the Academy', send_at: '2026-11-12T09:30:00Z', status: SCHED('Scheduled Thu 12 Nov 9:30am'), aud: { people: 10, business_copy: 1, sends: 11 } }],
    tasks: [], holds: [HOLD], content: []
  };
  const { win } = loadSchedule({ mkLoadDeliveryStatus: () => Promise.resolve(board) });
  const host = { isConnected: true, innerHTML: '', appendChild: () => {} };
  win.mkMountScheduleEarly(host);
  assert.match(host.innerHTML, /Loading the platform status…/);
  for (let i = 0; i < 5; i += 1) await new Promise((ok) => setTimeout(ok, 0));
  assert.match(host.innerHTML, /What focus bracketing can do/);
  assert.match(host.innerHTML, /Partly scheduled/);
  assert.match(host.innerHTML, /FB feed scheduled · IG feed scheduled · IG Story pending \(GPT\)/);
  assert.match(host.innerHTML, /Squarespace subject: “Your next step in the Academy”/);
  assert.match(host.innerHTML, /Loading the Squarespace meter…/);
  const list = host.innerHTML.slice(host.innerHTML.indexOf('<div class="mkl">'));
  assert.ok(!/In preparation|Draft ·|draft ·|No Squarespace meter reading/.test(list) && !/No Squarespace meter reading/.test(host.innerHTML), 'nothing contradicts the board while the rest loads');
});

test('item 13: the Quarter plan "Next" title uses the actual delivery status (no "FB/IG draft" once scheduled)', () => {
  const steps = [{ key: 'gpt-8w-social-2026-11-10-fbig', day: '2026-11-10', channel: 'Facebook + Instagram', title: 'What focus bracketing can do', status: 'pending', draft: true }, { key: 'gpt-8w-social-2026-12-08-fbig', day: '2026-12-08', channel: 'Facebook + Instagram', title: 'Christmas', status: 'pending', draft: true }];
  const idx = { 'gpt-8w-social-2026-11-10-fbig': SCHED('Facebook Tue 10 Nov 6:30pm'), 'gpt-8w-social-2026-12-08-fbig': st('in_preparation', 'In preparation', '📄') };
  const nx = nextActionOf({}, attachStatus(steps, idx), '2026-11-09');
  assert.equal(nx.text, 'FB/IG: What focus bracketing can do');
  assert.match(nx.status_line, /^🕒 Scheduled on platform · Facebook Tue 10 Nov 6:30pm/);
  assert.equal(nx.then.text, 'FB/IG draft: Christmas', 'an unapproved draft is still called a draft');
});

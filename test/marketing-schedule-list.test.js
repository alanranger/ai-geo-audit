/**
 * Schedule List view (Alan-approved 9 Nov) + shared status vocabulary + channel filter (QUESTION-2026-11-09
 * schedule-list-view-and-status-refresh, schedule-channel-filter-email-budget-light-logic).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function load(storeInit = {}) {
  const store = { ...storeInit };
  const listeners = [];
  const win = { localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } } };
  const document = { getElementById: () => null, addEventListener: (t, fn) => listeners.push([t, fn]), createElement: () => ({}), head: { appendChild: () => {}, insertAdjacentHTML: () => {} } };
  const ctx = vm.createContext({ window: win, document, localStorage: win.localStorage, Intl, Date, Number, String, Map, Set, JSON, Math, Promise, Array, Object, console, encodeURIComponent, setTimeout, MutationObserver: class { observe() {} } });
  for (const f of ['../lib/marketing-schedule-model.js', '../lib/marketing-schedule-list.js', '../lib/marketing-schedule.js']) vm.runInContext(fs.readFileSync(new URL(f, import.meta.url), 'utf8'), ctx);
  return { win, store, listeners };
}
const email = (key, title, at, people, state = 'sch') => ({ id: `email|${key}`, row: 'email', key, record_key: key, title, short: title, day: at.slice(0, 10), time: at.slice(11, 16), people, state, draft: false, raw: { planned_at: at, delivery: { aud: { people, business_copy: 1, sends: people + 1 } } } });
const THU = [
  email('theme|academy', 'Academy next step', '2026-11-12T09:30:00Z', 10),
  email('theme|update', 'November photography update', '2026-11-12T10:00:00Z', 370),
  email('theme|gifts', 'Photography gifts', '2026-11-12T10:00:00Z', 110),
  email('theme|norfolk', 'Norfolk final reminder', '2026-11-12T10:30:00Z', 38)
];
const post = { id: 'fbig|gpt-x|facebook', row: 'fbig', key: 'gpt-x|facebook', step_key: 'gpt-x', title: 'What focus bracketing can do', short: 'What focus bracketing…', day: '2026-11-10', state: 'pl', draft: true, raw: {} };
const outlook = { id: 'outlook|o', row: 'outlook', key: 'o', step_key: 'step|o', title: 'Personal note to past clients', short: 'Personal note', day: '2026-11-09', state: 'pl', raw: {} };
const model = (items) => ({ today: '2026-11-09', items, byId: new Map(items.map((x) => [x.id, x])), s: { campaign: { overrides: { a: { offer_code: 'NORFOLK150', offer_ends: '2026-11-14' } } } }, freq: null });
const opts = (channel = 'all') => ({ range: { from: '2026-11-09', to: '2026-11-15' }, channel });
const env = (L) => { const e = { review: () => ({ ready: false, blocker: 'Artwork still needed', planned_at: '2026-11-10T18:30:00Z' }) }; e.status = (x) => L.statusOf(x, e); return e; };

test('List: Thu 12 Nov same-day emails are ONE block "4 targeted emails" with each title, time, recipients and 528 recipient sends', () => {
  const { win } = load();
  const L = win.mkScheduleList;
  const html = L.listHtml(model([...THU, post]), opts(), env(L));
  assert.equal((html.match(/targeted emails/g) || []).length, 1);
  assert.match(html, /✉ 4 targeted emails/);
  for (const t of ['Academy next step — 9:30am — 10 recipients', 'November photography update — 10:00am — 370 recipients', 'Photography gifts — 10:00am — 110 recipients', 'Norfolk final reminder — 10:30am — 38 recipients']) assert.ok(html.includes(t), t);
  assert.match(html, /528 recipient sends · separate audiences/);
  assert.match(html, /🕒<\/i>Scheduled/);
});

test('List: an unfinished post is grey "In preparation" with one blocker and "Planned {time}", never Scheduled or Needs approval', () => {
  const { win } = load();
  const L = win.mkScheduleList;
  const html = L.listHtml(model([post]), opts(), env(L));
  assert.match(html, /📄<\/i>In preparation<\/span><small>Artwork still needed<\/small>/);
  assert.match(html, /Planned 6:30pm/);
  assert.ok(!/Scheduled|Needs approval/.test(html));
  const ready = { review: () => ({ ready: true, planned_at: '2026-11-10T18:30:00Z' }) };
  ready.status = (x) => L.statusOf(x, ready);
  assert.match(L.listHtml(model([post]), opts(), ready), /⚠<\/i>Needs approval/, 'amber only when caption, artwork and URL are all ready');
});

test('List: Tasks & reminders are a separate strip (Outlook note, offer end), never rows in the publication list', () => {
  const { win } = load();
  const L = win.mkScheduleList;
  const m = model([outlook, post]);
  const list = L.listHtml(m, opts(), env(L));
  const tasks = L.tasksHtml(m, opts(), env(L));
  assert.ok(!list.includes('Personal note to past clients'));
  assert.match(tasks, /Tasks &amp; reminders/);
  assert.match(tasks, /Personal note to past clients · personal note for Alan to review and send/);
  assert.match(tasks, /NORFOLK150 offer ends/);
});

test('status vocabulary: the server status model wins when present; otherwise the adapter (Sent / Published / Checking delivery)', () => {
  const { win } = load();
  const L = win.mkScheduleList;
  const srv = { ...THU[0], raw: { ...THU[0].raw, status: { code: 'verification_unavailable', blocker: 'Squarespace read failed' } } };
  assert.deepEqual(JSON.parse(JSON.stringify([L.statusOf(srv).label, L.statusOf(srv).blocker])), ['Verification unavailable', 'Squarespace read failed']);
  assert.equal(L.statusOf({ ...THU[0], state: 'done', raw: { done_at: '2026-11-12T09:30:00Z' } }).label, 'Sent');
  assert.equal(L.statusOf({ ...post, state: 'done', raw: { done_at: 'x' } }).label, 'Published');
  assert.equal(L.statusOf({ ...THU[0], state: 'late' }).label, 'Checking delivery', 'a due release is never "Late" without evidence');
  const pl = { placements: () => [{ placement: 'linkedin_feed', label: 'LinkedIn', stage: 'published', provider_url: 'https://www.linkedin.com/feed/update/urn:li:activity:1/', actual_at: '2026-11-09T09:06:19Z' }] };
  const li = L.statusOf({ ...post, row: 'linkedin' }, pl);
  assert.deepEqual([li.label, li.link], ['Published', 'https://www.linkedin.com/feed/update/urn:li:activity:1/']);
});

test('the same status label in List and in both grids (one adapter)', () => {
  const { win } = load();
  const m = { ...model(THU), items: THU, week_start: '2026-11-09', moments: [], s: null };
  const wk = win.mkScheduleModel.weeks({ ...m }, 1);
  assert.ok(wk.length);
  const list = win.mkScheduleLayout(m, 'list');
  const days = win.mkScheduleLayout(m, 'days', 'channels');
  for (const html of [list, days]) assert.match(html, /🕒<\/i>Scheduled/);
});

test('channel filter: List + grids; the range and cycle persist when the filter changes; remembered per viewer', () => {
  const { win, store, listeners } = load({ 'mks-lrange': '4w', 'mks-cycle': 'next' });
  assert.deepEqual(JSON.parse(JSON.stringify(win.mkScheduleView())), { mode: 'list', channel: 'all', lrange: '4w', cycle: 'next' }, 'List is the default layout');
  const click = listeners.find(([t]) => t === 'click');
  const el = { dataset: { mksChannel: 'linkedin' }, tagName: 'BUTTON' };
  const fire = (sel, target) => listeners.filter(([t]) => t === 'click').forEach(([, fn]) => fn({ target: { closest: (s) => (s === '#marketing-root' ? {} : (s === sel ? target : null)) } }));
  assert.ok(click);
  fire('[data-mks-channel]', el);
  assert.deepEqual(JSON.parse(JSON.stringify(win.mkScheduleView())), { mode: 'list', channel: 'linkedin', lrange: '4w', cycle: 'next' });
  assert.equal(store['mks-channel'], 'linkedin');
  const L = win.mkScheduleList;
  const all = [...THU, post, { ...post, id: 'linkedin|gpt-ll-newsletter-2026-11-15|linkedin', row: 'linkedin', step_key: 'gpt-ll-newsletter-2026-11-15', title: 'Light & Logic newsletter (LinkedIn) · November edition', day: '2026-11-15' }];
  const li = L.listHtml(model(all), opts('linkedin'), env(L));
  assert.match(li, /Light &amp; Logic newsletter \(LinkedIn\)/);
  assert.match(li, /LinkedIn · Light &amp; Logic newsletter · GPT prepares, Alan approves/);
  assert.match(li, /edition being prepared by GPT · not scheduled on LinkedIn/);
  assert.ok(!li.includes('targeted emails') && !li.includes('What focus bracketing'), 'LinkedIn only');
  assert.equal(all.filter((x) => L.matchChannel(x, 'facebook')).length, 1, 'Facebook / Instagram filters show the shared FB + IG post');
});

test('Squarespace email view: real cycle boundaries, budget after each step, one row per send with cohort, audience approval and credits', () => {
  const { win } = load();
  const L = win.mkScheduleList;
  const d = {
    meter: {
      capacity: { quota: 5000, used: 2979, committed: 765, draft_proposals: 0, next_cycle: { starts_at: '2026-11-12T12:51:47Z', ends_at: '2026-12-12T12:51:47Z', allowance: 5000, committed: 0, draft_proposals: 2167 } },
      deliveries: [{ key: 'theme|pnm', title: 'Pick n Mix Kick-Starter relaunch', record_stage: 'scheduled', send_at: '2026-11-10T10:00:00Z', side: 'current', bucket: 'committed', amount: 127, provider: { state: 'scheduled' }, snapshot: { export_id: 'e1', list_name: 'ARP | Pick n Mix Kick-Starter' }, aud: { people: 126, business_copy: 1, sends: 127 }, estimate: null, evidence: { by: 'Squarespace collector' } },
        { key: 'email|x', title: 'Cancelled', cancelled: true, side: 'current', aud: {} }]
    },
    exports: [{ export_id: 'e1', list_name: 'ARP | Pick n Mix Kick-Starter', status: 'loaded', exclusions: { owner_copy: 1 }, status_history: [{ at: '2026-11-08T11:43:00Z', status: 'blocked' }, { at: '2026-11-08T11:49:05Z', status: 'pending_import' }] }]
  };
  const m = { ...model([]), freq: { weeks: { '2026-11-09': { from: '2026-11-06', to: '2026-11-12', by_count: { 1: 10, 2: 114, 3: 500, '4+': 39 }, approved_over: 325 } } } };
  const cur = L.emailViewHtml(m, d, { cycle: 'current' });
  assert.match(cur, /Current cycle \(resets Thu 12 Nov 12:51\)/);
  assert.match(cur, /Actual used <b>2,979<\/b> → left 2,021/);
  assert.match(cur, /Confirmed commitments \(platform-scheduled\) <b>765<\/b> → left 1,256/);
  assert.match(cur, /126 people \+ 1 business copy = 127 sends/);
  assert.match(cur, /audience agreed Sun 8 Nov · content scheduled/);
  assert.match(cur, /— estimated → 127 committed → — actual/);
  assert.match(cur, /3 emails 500 \(325 approved third\)/);
  assert.ok(!cur.includes('Cancelled'));
  const next = L.emailViewHtml(m, d, { cycle: 'next' });
  assert.match(next, /Draft estimates <b>2,167<\/b> → left 2,833/);
  assert.match(next, /LinkedIn newsletter editions never use Squarespace credits/);
});

/**
 * YouTube Shorts in the schedule (QUESTION-2026-11-09-youtube-shorts-in-shared-content-records, part f): a YouTube
 * row per release, the YouTube channel filter, "▶ {title} · {duration}" chips on the emails carrying a Short (the
 * email keeps its own status), and the per-video content record with every use's own status and time.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function load() {
  const listeners = [];
  const store = {};
  const win = { localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } } };
  const document = { getElementById: () => null, addEventListener: (t, fn) => listeners.push([t, fn]), createElement: () => ({}), head: { appendChild: () => {}, insertAdjacentHTML: () => {} } };
  const ctx = vm.createContext({ window: win, document, localStorage: win.localStorage, Intl, Date, Number, String, Map, Set, JSON, Math, Promise, Array, Object, console, encodeURIComponent, setTimeout, MutationObserver: class { observe() {} } });
  for (const f of ['../lib/marketing-schedule-model.js', '../lib/marketing-schedule-list.js', '../lib/marketing-schedule.js']) vm.runInContext(fs.readFileSync(new URL(f, import.meta.url), 'utf8'), ctx);
  const setBoard = (board) => listeners.filter(([t]) => t === 'mk-status-refreshed').forEach(([, fn]) => fn({ detail: board }));
  return { win, setBoard };
}

const SHORTS = [
  ['check-whole-frame', 'Check the Whole Frame | A Quick Photography Composition Tip', '0:24', '2026-11-10', '2026-11-19'],
  ['ten-minutes', 'Ten Minutes, One Scene | A Simple Photography Exercise', '1:01', '2026-11-17', '2026-11-26'],
  ['style', 'Your Photography Style Is Not Chosen in Advance', '0:45', '2026-11-24', '2026-12-03'],
  ['polished-wall', 'The Polished Wall | A Photography Reflection', '2:40', '2026-12-01', '2026-12-10'],
  ['mystery', 'Mystery or Confusion? | Photography Composition', '0:28', '2026-12-08', '2026-12-17'],
  ['rules', 'Stop Applying Photography Rules. Start Making Choices.', '0:54', '2026-12-15', '2026-12-23'],
  ['grasmere', 'Grasmere, Lake District | A Moment of Landscape Inspiration', '1:04', '2026-12-22', '2026-12-30']
];
const sched = (at, url) => ({ code: 'scheduled', label: 'Scheduled', icon: '🕒', tone: 'blue', when: 'Scheduled', at, link: url, evidence: 'YouTube scheduled (private until release)' });
const prep = (day) => ({ code: 'in_preparation', label: 'In preparation', icon: '📄', tone: 'grey', when: `Planned ${day} (no time yet)`, blocker: 'audience not frozen' });
const content = SHORTS.map(([slug, title, duration, tue, emailDay], i) => {
  const at = `${tue}T18:00:00Z`;
  const url = `https://youtube.com/shorts/v${i}`;
  return {
    asset_key: `video|short|${slug}`, title, format: 'short_video', format_label: 'Short video / reel', purpose: 'educate', purpose_source: 'rule (from the title; GPT / Alan may change it)',
    url, duration, release_at: at, status: sched(at, url), needs_alan: false,
    provider: { privacy: 'private', publish_at: at, upload_status: 'processed', processing_status: 'succeeded', read_at: '2026-11-09T11:56:34Z', error: null },
    uses: [
      { use_key: 'youtube', channel: 'youtube', ref: `youtube|v${i}`, planned_at: at, link: url, status: sched(at, url) },
      { use_key: `email|theme|gpt-8w-${emailDay}`, channel: 'email', ref: `send|theme|gpt-8w-${emailDay}`, campaign_key: `theme|gpt-8w-${emailDay}`, planned_on: emailDay, module_state: i === 1 ? 'inserted' : 'proposed', title: `Email ${emailDay}`, status: prep(emailDay) }
    ]
  };
});
const KEY = 'theme|gpt-8w-2026-11-19';
const draftEmail = { id: `email|${KEY}`, row: 'email', key: KEY, record_key: KEY, title: 'Small details, new possibilities', short: 'Small details', day: '2026-11-19', state: 'pl', draft: true, people: 120, raw: { delivery: { status: { code: 'draft', label: 'Draft', icon: '📄', tone: 'grey', blocker: 'content draft · not scheduled in Squarespace' } } } };
const shortOf = (c) => ({ asset_key: c.asset_key, title: c.title, duration: c.duration, url: c.url, release_at: c.release_at, public: false, status: 'scheduled', label: 'Short not public yet ⚠' });
const board = { content, emails: [{ key: KEY, campaign_key: KEY, status: prep('Thu 19 Nov'), shorts: [shortOf(content[0])], short_check: shortOf(content[0]) }], tasks: [], placements: [] };
const opts = (channel, from = '2026-11-09', to = '2026-11-15') => ({ range: { from, to }, channel });

function setup(b = board) {
  const { win, setBoard } = load();
  const L = win.mkScheduleList;
  const M = win.mkScheduleModel;
  const m = M.build({ items: [], content: b.content, today: '2026-11-09' });
  m.items.push(draftEmail);
  m.byId.set(draftEmail.id, draftEmail);
  setBoard(b);
  const env = { board: b };
  env.status = (x) => L.statusOf(x, env);
  return { win, L, M, m, env };
}

test('YouTube: one row per release, Tuesday 18:00 UK, Scheduled from YouTube\'s own status; the YouTube filter shows all 7 (10 Nov – 22 Dec)', () => {
  const { L, m, env } = setup();
  const yt = m.items.filter((x) => x.row === 'youtube');
  assert.equal(yt.length, 7);
  for (const x of yt) {
    assert.equal(new Date(`${x.day}T12:00:00Z`).getUTCDay(), 2, 'Tuesday');
    assert.equal(x.time, '18:00');
    assert.equal(x.state, 'sch');
    assert.equal(L.statusOf(x, env).code, 'scheduled');
  }
  assert.deepEqual([yt[0].day, yt[6].day], ['2026-11-10', '2026-12-22']);
  assert.ok(L.CHANNELS.some(([k, l]) => k === 'youtube' && l === 'YouTube'));
  const html = L.listHtml(m, opts('youtube'), env);
  assert.equal((html.match(/data-mkl-item="youtube\|/g) || []).length, 7, 'filter count is 7 from This week');
  assert.equal((html.match(/🕒<\/i>Scheduled/g) || []).length, 7);
  assert.equal((html.match(/6:00pm · <a href="https:\/\/youtube\.com\/shorts\/v\d"[^>]*>Open on YouTube<\/a>/g) || []).length, 7);
  assert.match(html, /<span class="mkl-ic"><svg[^]*?YouTube · Short video \/ reel/);
  assert.ok(!html.includes(KEY), 'no email rows under the YouTube filter');
  assert.equal((L.listHtml(m, opts('email', '2026-11-16', '2026-11-22'), env).match(/data-mkl-item="youtube/g) || []).length, 0);
});

test('Email row carrying a Short: "▶ Check the Whole Frame · 0:24" + "Short not public yet ⚠"; the row status stays the email\'s own (Draft)', () => {
  const { L, m, env } = setup();
  const html = L.listHtml(m, opts('all', '2026-11-16', '2026-11-22'), env);
  const row = html.slice(html.indexOf(`data-mkl-item="email|${KEY}"`));
  assert.match(row, /data-mkl-content="youtube\|video\|short\|check-whole-frame"[^>]*>▶ Check the Whole Frame · 0:24<\/span><span class="mkl-ytc mkl-amb">Short not public yet ⚠<\/span>/);
  assert.match(row, /📄<\/i>Draft<\/span>/);
  const plain = { ...env, board: { ...board, emails: [{ ...board.emails[0], shorts: undefined, short_check: undefined }] } };
  plain.status = (x) => L.statusOf(x, plain);
  assert.deepEqual(JSON.parse(JSON.stringify(L.statusOf(draftEmail, env))), JSON.parse(JSON.stringify(L.statusOf(draftEmail, plain))), 'a chip never changes the email status');
  assert.ok(!/Scheduled/.test(row.slice(0, row.indexOf('</div></div>'))), 'never YouTube\'s Scheduled on the email row');
  const pub = { ...board, emails: [{ ...board.emails[0], short_check: { ...board.emails[0].short_check, public: true, label: 'Short public ✓' } }] };
  assert.match(L.shortChips(draftEmail, pub), /mkl-ok">Short public ✓/);
});

test('Grids: a YouTube channel row / column with the releases, and the Short chip on the email card', () => {
  const { win, m } = setup();
  const weeks = win.mkScheduleLayout(m, 'weeks', 'dates');
  assert.match(weeks, /YouTube<\/th>/);
  assert.equal((weeks.match(/data-mks-item="youtube\|/g) || []).length, 7);
  assert.match(weeks, /data-mks-item="email\|theme\|gpt-8w-2026-11-19"[^]*?▶ Check the Whole Frame · 0:24/);
  const byCh = win.mkScheduleLayout(m, 'weeks', 'channels');
  assert.match(byCh, /<b>YouTube<\/b><small>Shorts<\/small>/);
  const days = win.mkScheduleLayout(m, 'days', 'channels');
  assert.match(days, /data-mks-item="youtube\|video\|short\|check-whole-frame"[^>]*>[^]*?Scheduled/);
});

test('Content record: format, purpose with its source, and every use with its own status and time; the email module shows proposed / inserted', () => {
  const { L } = setup();
  const html = L.contentHtml(content[0]);
  assert.match(html, /Format<\/th><td>Short video \/ reel/);
  assert.match(html, /Purpose<\/th><td>Educate<small>source: rule \(from the title; GPT \/ Alan may change it\)<\/small>/);
  assert.match(html, /Uses \(2\)/);
  assert.match(html, /data-mkl-use="youtube"><td>YouTube release<\/td><td><span class="mkl-st mkl-sch"><i>🕒<\/i>Scheduled<\/span><\/td><td>Tue 10 Nov 18:00<\/td>/);
  assert.match(html, /data-mkl-use="email\|theme\|gpt-8w-2026-11-19"><td>Squarespace email module<\/td><td><span class="mkl-st mkl-prep"><i>📄<\/i>In preparation<\/span><small>audience not frozen<\/small><\/td><td>Thu 19 Nov · time not set<\/td>[^]*?module <b>proposed<\/b>/);
  assert.match(L.contentHtml(content[1]), /module <b>inserted<\/b>/);
  assert.match(html, /Native Facebook \/ Instagram \/ LinkedIn uses: none planned or approved yet/);
});

test('Time passing never marks a Short Public: past 18:00 with YouTube still saying Scheduled, the row stays Scheduled (never late / done)', () => {
  const { win } = load();
  const L = win.mkScheduleList;
  const m = win.mkScheduleModel.build({ items: [], content, today: '2026-11-11' });
  const x = m.byId.get('youtube|video|short|check-whole-frame');
  assert.equal(x.state, 'sch');
  assert.equal(L.statusOf(x, { board }).code, 'scheduled');
  const chk = { ...content[0], uses: [{ ...content[0].uses[0], status: { code: 'checking', label: 'Checking YouTube', at: '2026-11-10T18:00:00Z' } }, content[0].uses[1]] };
  const cx = win.mkScheduleModel.build({ items: [], content: [chk], today: '2026-11-11' }).items[0];
  assert.deepEqual([cx.state, L.statusOf(cx, {}).code], ['pl', 'checking'], 'the server\'s "checking" after release time shows as checking, never Public');
  const pub = { ...content[0], uses: [{ ...content[0].uses[0], status: { code: 'published', label: 'Public', at: '2026-11-10T18:00:00Z' } }, content[0].uses[1]] };
  assert.equal(win.mkScheduleModel.build({ items: [], content: [pub], today: '2026-11-11' }).items[0].state, 'done', 'Public only from YouTube\'s own status');
});

test('window.mkOpenContent(assetKey): false when the Short is not on the schedule (Waiting falls back to the YouTube link)', () => {
  const { win, setBoard } = load();
  assert.equal(typeof win.mkOpenContent, 'function');
  assert.equal(win.mkOpenContent('video|short|check-whole-frame'), false, 'no model built yet');
  setBoard(board);
  assert.equal(win.mkOpenContent('video|short|not-a-short'), false);
});

test('Tasks & reminders: empty "·" segments are dropped (never "· ·" before the badge)', () => {
  const { L } = setup();
  const gbp = { id: 'gbp|u', row: 'gbp', key: 'u', step_key: 'step|u', title: 'Google Business update: £150 off, book by Sat 14 Nov 23:59 · ', short: 'x', day: '2026-11-13', state: 'pl', raw: {} };
  const m = { today: '2026-11-09', items: [gbp], byId: new Map([[gbp.id, gbp]]), s: null };
  const env = { board: { tasks: [] } };
  env.status = (x) => L.statusOf(x, env);
  const html = L.tasksHtml(m, opts('all'), env);
  assert.match(html, /Google Business update: £150 off, book by Sat 14 Nov 23:59 · <span class="mkl-st mini/);
  assert.ok(!/·\s*·/.test(html));
});

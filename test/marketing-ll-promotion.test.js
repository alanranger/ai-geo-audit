/**
 * Light & Logic promotion (QUESTION-2026-11-09 live-audit corrections, item 2): the edition promotion modules inside the
 * 19 Nov / 17 Dec email drafts are content assets linked to the email's send and the edition row; the L&L rows say
 * "promoted in: 19 Nov email (draft)", the email view shows the module, and it is budgeted once (the email's own sends).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { promotionsOf } from '../api/aigeo/marketing-schedule-extras.js';

function load() {
  const win = { localStorage: { getItem: () => null, setItem: () => {} } };
  const document = { getElementById: () => null, addEventListener: () => {}, createElement: () => ({}), head: { appendChild: () => {}, insertAdjacentHTML: () => {} } };
  const ctx = vm.createContext({ window: win, document, localStorage: win.localStorage, Intl, Date, Number, String, Map, Set, JSON, Math, Promise, Array, Object, console, encodeURIComponent, setTimeout, MutationObserver: class { observe() {} } });
  for (const f of ['../lib/marketing-schedule-model.js', '../lib/marketing-schedule-list.js']) vm.runInContext(fs.readFileSync(new URL(f, import.meta.url), 'utf8'), ctx);
  return win.mkScheduleList;
}

const ASSETS = [
  { asset_key: 'module|light-and-logic|2026-11-15', title: 'Light & Logic November edition: promotion module', status: 'draft', used_in: ['newsletter|light-and-logic', 'send|theme|gpt-8w-2026-11-19', 'delivery|gpt-ll-newsletter-2026-11-15'], note: 'module in the provider draft' },
  { asset_key: 'module|light-and-logic|2026-12-15', title: 'Light & Logic December edition: promotion module', status: 'draft', used_in: ['newsletter|light-and-logic', 'send|theme|gpt-8w-2026-12-17', 'delivery|gpt-ll-newsletter-2026-12-15'], note: null },
  { asset_key: 'newsletter|light-and-logic', title: 'Light & Logic', status: 'existing', used_in: ['initiative|prog-learning-relationships'] },
  { asset_key: 'gpt-8w-email-2026-11-19', title: 'draft', status: 'draft', used_in: ['send|theme|gpt-8w-2026-11-19'] }
];
const CAMPS = [{ campaign_key: 'theme|gpt-8w-2026-11-19', stage: 'drafted', planned_send_on: '2026-11-19' }, { campaign_key: 'theme|gpt-8w-2026-12-17', stage: 'drafted', planned_send_on: '2026-12-17' }];
const promos = promotionsOf(ASSETS, CAMPS);

test('promotionsOf: only module assets linking the newsletter, an email send and an edition row', () => {
  assert.deepEqual(promos.map((p) => [p.campaign_key, p.edition_step_key, p.edition_day, p.stage]), [
    ['theme|gpt-8w-2026-11-19', 'gpt-ll-newsletter-2026-11-15', '2026-11-15', 'drafted'],
    ['theme|gpt-8w-2026-12-17', 'gpt-ll-newsletter-2026-12-15', '2026-12-15', 'drafted']
  ]);
});

const ll = (day) => ({ id: `linkedin|gpt-ll-newsletter-${day}|linkedin`, row: 'linkedin', key: `gpt-ll-newsletter-${day}|linkedin`, step_key: `gpt-ll-newsletter-${day}`, title: 'Light & Logic newsletter (LinkedIn) · edition', short: 'L&L', day, state: 'pl', raw: {} });
const mail = { id: 'email|theme|gpt-8w-2026-11-19', row: 'email', key: 'theme|gpt-8w-2026-11-19', record_key: 'theme|gpt-8w-2026-11-19', title: 'Small details, new possibilities', short: 'Small details', day: '2026-11-19', state: 'pl', draft: true, people: 120, raw: { delivery: { status: { code: 'in_preparation', blocker: 'audience not frozen' } } } };
const model = (items) => ({ today: '2026-11-09', items, byId: new Map(items.map((x) => [x.id, x])), s: null, freq: null });
const envOf = (L, p) => { const e = { board: null, promotions: p, placements: () => [] }; e.status = (x) => L.statusOf(x, e); return e; };

test('List: L&L edition rows say "promoted in: 19 Nov email (draft)"; the email shows the module chip and keeps its own status', () => {
  const L = load();
  const range = { range: { from: '2026-11-09', to: '2026-12-31' }, channel: 'all' };
  const html = L.listHtml(model([ll('2026-11-15'), ll('2026-12-15'), mail]), range, envOf(L, promos));
  assert.match(html, /promoted in: 19 Nov email \(draft\)/);
  assert.match(html, /promoted in: 17 Dec email \(draft\)/);
  assert.match(html, /📰 Light &amp; Logic Nov edition module/);
  assert.ok(!html.includes('promotion: none recorded'));
  assert.equal(L.statusOf(mail, envOf(L, promos)).code, L.statusOf(mail, envOf(L, [])).code, 'the module never changes the email status');
  assert.match(L.listHtml(model([ll('2026-11-15')]), range, envOf(L, [])), /promotion: none recorded/);
});

test('Email view: the module on its send row, the promotion line, and budgeted once (same budget with or without the module)', () => {
  const L = load();
  const d = { meter: { capacity: { quota: 5000, used: 3090, committed: 654, draft_proposals: 0, next_cycle: { starts_at: '2026-11-12T12:51:00Z', ends_at: '2026-12-12T12:51:00Z', allowance: 5000, committed: 0, draft_proposals: 0 } }, deliveries: [{ key: 'theme|gpt-8w-2026-11-19', title: 'Small details, new possibilities', send_day: '2026-11-19', side: 'next', bucket: 'provisional', record_stage: 'drafted', aud: { people: 537, business_copy: 1, sends: 538 }, estimate: { sends: 538 } }] }, exports: [] };
  const m = model([mail]);
  const withP = L.emailViewHtml(m, d, { cycle: 'next', promotions: promos });
  const without = L.emailViewHtml(m, d, { cycle: 'next', promotions: [] });
  assert.match(withP, /📰 Light &amp; Logic Nov edition module/);
  assert.match(withP, /Light &amp; Logic promotion: Nov edition \(15 Nov\) → module in the 19 Nov email \(draft\) · Dec edition \(15 Dec\) → module in the 17 Dec email \(draft\)\. Budgeted once/);
  assert.match(without, /Light &amp; Logic promotion: none recorded yet/);
  const bar = (h) => h.slice(h.indexOf('mkl-budget'), h.indexOf('</div></div>', h.indexOf('mkl-budget')));
  assert.equal(bar(withP), bar(without), 'budget bar identical: no extra sends for the module');
  assert.equal((withP.match(/mkl-send/g) || []).length, (without.match(/mkl-send/g) || []).length, 'no extra send rows');
});

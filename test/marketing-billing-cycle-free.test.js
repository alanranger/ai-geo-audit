/**
 * QUESTION-2026-11-11 billing-cycle-tile-reserves-and-free-to-spend: per future cycle, Scheduled emails (provider-
 * scheduled only) · Light & Logic (planned) budget · Kept back for ad-hoc · Free for new campaigns = allowance − all of
 * them. Budgets come from the stored Targets settings (never a default); the Light & Logic row is PLANNED (its frozen
 * list never makes it look scheduled) and is subtracted once; the Email capacity tile's next-cycle line agrees.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { meterView } from '../lib/marketing/meter.mjs';
import { budgetView, emailBudgetOf, futureCycles, llPlanned } from '../lib/marketing/delivery-budget.mjs';

const RESET = '2026-11-12T12:51:47.184Z';
const NOW = new Date('2026-11-11T14:20:00Z');
const LATEST = { captured_at: '2026-11-11T13:47:54Z', cycle_reset_at: RESET, quota_emails: 5000, used_emails: 3217 };
const BUDGET = emailBudgetOf({ email: { monthly_cap_sends: 5000, light_and_logic_budget_sends: 700, adhoc_reserve_sends: 700, email_budget_note: 'Alan via GPT, 10–11 Nov 2026' } }, '2026-11-11T14:21:09Z');
const plain = (x) => JSON.parse(JSON.stringify(x));

const sched = (key, at, recipients) => ({
  rec: { campaign_key: key, kind: 'theme', title: key, stage: 'scheduled', audience: 'segments', planned_send_on: at.slice(0, 10), scheduled_for: at, sqs_draft_id: `d-${key}` },
  row: { email_id: `d-${key}`, subject: key, scheduled_for: at, mailing_list_names: [key], recipients, state: 'scheduled', collected_at: '2026-11-11T13:47:00Z', campaign_key: key, link_state: 'linked' }
});
const ll = (day) => ({ campaign_key: `theme|light-and-logic-email-${day}`, kind: 'theme', title: `Light & Logic ${day}`, stage: 'proposed', audience: 'segments', segment_ids: ['gpt-approved-11nov-newsletter'], planned_send_on: day, export_id: `x-ll-${day}`, estimate_sends: 700, reserved_sends: 0 });
const llExport = (day) => ({ export_id: `x-ll-${day}`, campaign_key: `theme|light-and-logic-email-${day}`, list_name: `ARP | Light and Logic | ${day}`, eligible_count: 680, status: 'loaded', load_result: { list_count: '681' }, owner: { included: true, count: 0, business_copy: 1 } });
/** Today's shape: 8 scheduled per future cycle (2,200 / 2,196), 6 in 12 Jan → 12 Feb (1,316), a planned L&L each month. */
const S = [
  ...[['2026-11-19', 576], ['2026-11-26', 179], ['2026-11-26', 399], ['2026-12-01', 13], ['2026-12-03', 179], ['2026-12-03', 399], ['2026-12-10', 235], ['2026-12-10', 220]].map(([d, r], i) => sched(`theme|n${i}`, `${d}T19:30:00Z`, r)),
  ...[['2026-12-17', 179], ['2026-12-17', 399], ['2026-12-23', 179], ['2026-12-23', 399], ['2026-12-30', 179], ['2026-12-30', 399], ['2027-01-07', 313], ['2027-01-07', 149]].map(([d, r], i) => sched(`theme|a${i}`, `${d}T19:30:00Z`, r)),
  ...[['2027-01-14', 40], ['2027-01-14', 399], ['2027-01-21', 398], ['2027-01-21', 40], ['2027-01-28', 200], ['2027-01-28', 239]].map(([d, r], i) => sched(`theme|j${i}`, `${d}T19:30:00Z`, r))
];
const DAYS = ['2026-11-15', '2026-12-15', '2027-01-15'];
function meter(extra = {}) {
  return meterView(LATEST, [...S.map((s) => s.rec), ...DAYS.map(ll), ...(extra.campaigns || [])], [], NOW, { schedules: [...S.map((s) => s.row), ...(extra.schedules || [])], exports: DAYS.map(llExport), email_budget: 'budget' in extra ? extra.budget : BUDGET });
}
function load() {
  const win = {};
  const ctx = vm.createContext({ window: win, document: { getElementById: () => null, querySelector: () => null, head: { insertAdjacentHTML: () => {} } }, localStorage: { getItem: () => null, setItem: () => {} }, Date, Intl, Number, String, Map, Set, Math, Array, Object, JSON, RegExp, Promise, console, setTimeout, CustomEvent: class {}, MutationObserver: class { observe() {} } });
  for (const f of ['../lib/marketing-sqs-cycles.js', '../lib/marketing-delivery.js']) vm.runInContext(fs.readFileSync(new URL(f, import.meta.url), 'utf8'), ctx);
  return win;
}

test('settings: read from the Targets row, never a default; unset = null', () => {
  assert.deepEqual([BUDGET.light_and_logic, BUDGET.adhoc, BUDGET.note], [700, 700, 'Alan via GPT, 10–11 Nov 2026']);
  assert.deepEqual(plain(emailBudgetOf({ email: { monthly_cap_sends: 5000 } })), { light_and_logic: null, adhoc: null, note: null, set_at: null });
  assert.deepEqual(plain(emailBudgetOf(null)).light_and_logic, null);
});

test('three future cycles at the reset instant; free = 5,000 − provider-scheduled − 700 − 700 = 1,400 / 1,404 / 2,284', () => {
  const m = meter();
  assert.deepEqual(futureCycles(m.cycle).map((c) => [c.start, c.end]), [[RESET, '2026-12-12T12:51:47.184Z'], ['2026-12-12T12:51:47.184Z', '2027-01-12T12:51:47.184Z'], ['2027-01-12T12:51:47.184Z', '2027-02-12T12:51:47.184Z']]);
  assert.deepEqual(m.budget.cycles.map((c) => [c.scheduled_n, c.scheduled, c.light_and_logic.amount, c.adhoc, c.frozen, c.free]), [[8, 2200, 700, 700, 0, 1400], [8, 2196, 700, 700, 0, 1404], [6, 1316, 700, 700, 0, 2284]]);
  assert.equal(m.capacity.next_cycle.budget.free, 1400, 'the Email capacity tile reads the same figure');
});

test('the Light & Logic email is PLANNED while not scheduled in Squarespace (its frozen 681 list is not counted, the 700 budget once)', () => {
  const m = meter();
  const d = m.deliveries.find((x) => x.campaign_key === 'theme|light-and-logic-email-2026-11-15');
  assert.deepEqual([d.ll_planned, llPlanned(d), d.snapshot.amount], [true, true, 681]);
  const win = load();
  const col = plain(win.mkSqsCycles.build({ meter: m, segments: [], runs: {} }).columns[1]);
  const row = col.rows.find((r) => r.key === 'theme|light-and-logic-email-2026-11-15');
  assert.deepEqual([row.tag, row.amount, row.reserved], ['PLANNED', 700, false]);
  assert.deepEqual([col.totals.n_reserved, col.totals.n_planned, col.totals.total], [8, 1, 2200], 'not in the scheduled count or total');
});

test('"This cycle" keeps the Light & Logic email as FROZEN at its snapshot (no PLANNED, no budget) — as before', () => {
  const late = { ...LATEST, cycle_reset_at: '2026-11-16T12:51:47.184Z' };
  const m = meterView(late, [...S.map((s) => s.rec), ...DAYS.map(ll)], [], NOW, { schedules: S.map((s) => s.row), exports: DAYS.map(llExport), email_budget: BUDGET });
  const col = plain(load().mkSqsCycles.build({ meter: m, segments: [], runs: {} }).columns[0]);
  const row = col.rows.find((r) => r.key === 'theme|light-and-logic-email-2026-11-15');
  assert.deepEqual([row.tag, row.amount, row.reserved, col.reserves], ['FROZEN', 681, true, null]);
  assert.equal(col.totals.n_planned, 0);
});

test('once the Light & Logic email is scheduled in Squarespace it is a scheduled email and the budget line is not taken again', () => {
  const s = { email_id: 'ns-ll', subject: 'L&L', scheduled_for: '2026-11-15T09:00:00Z', mailing_list_names: ['ARP | Light and Logic'], recipients: 681, state: 'scheduled', collected_at: '2026-11-11T13:47:00Z', campaign_key: 'theme|light-and-logic-email-2026-11-15', link_state: 'linked' };
  const c = meter({ schedules: [s] }).budget.cycles[0];
  assert.deepEqual([c.scheduled_n, c.scheduled, c.light_and_logic.amount, c.free], [9, 2881, 0, 5000 - 2881 - 700]);
});

test('tile: the four footer lines in order with hovers; red when free is negative; "This cycle" unchanged', () => {
  const win = load();
  const html = win.mkSqsCyclesTileHtml({ meter: meter(), segments: [], runs: {} }, NOW.getTime());
  const next = html.split('data-mkc-col="1"')[1].split('data-mkc-col="2"')[0];
  const lines = [...next.matchAll(/data-mkc-line="(\w+)"[^>]*><span>([^<]+)<\/span><b>([^<]+)<\/b>/g)].map((x) => [x[1], x[2], x[3]]);
  assert.deepEqual(lines, [['scheduled', 'Scheduled emails (8)', '2,200'], ['ll', 'Light &amp; Logic (planned)', '700'], ['adhoc', 'Kept back for ad-hoc', '700']]);
  assert.match(next, /data-mkc-free title="5,000 − scheduled emails − Light &amp; Logic − ad-hoc[^"]*"><span>Free for new campaigns<\/span><span>1,400<\/span>/);
  assert.match(next, /data-mkc-line="ll" title="Alan&#39;s monthly Light &amp; Logic full-list email: 700 a billing cycle[^"]*light_and_logic_budget_sends · Alan via GPT, 10–11 Nov 2026|data-mkc-line="ll" title="Alan's monthly Light &amp; Logic full-list email: 700 a billing cycle[^"]*light_and_logic_budget_sends · Alan via GPT, 10–11 Nov 2026/);
  assert.match(html, /data-mkc-after-free="2284"[^>]*>12 Jan → 12 Feb: free for new campaigns 2,284 \(5,000 − 1,316 scheduled − 700 Light &amp; Logic − 700 ad-hoc\)/);
  const cur = html.split('data-mkc-col="0"')[1].split('data-mkc-col="1"')[0];
  assert.doesNotMatch(cur, /data-mkc-line|Free for new campaigns/, 'this cycle: no reserve deduction');
  const big = { budget: emailBudgetOf({ email: { light_and_logic_budget_sends: 3000, adhoc_reserve_sends: 700 } }) };
  assert.match(win.mkSqsCyclesTileHtml({ meter: meter(big), segments: [], runs: {} }, NOW.getTime()), /class="mkc-left mkc-free neg"[^>]*><span>Free for new campaigns<\/span><span>−900<\/span>/);
});

test('Email capacity tile: the next-cycle line uses the same Free for new campaigns figure', () => {
  const win = load();
  const m = meter();
  const rows = win.mkCapacityRows(win.mkCapacity({ meter: m }, null));
  const next = rows.find((r) => /^Next cycle/.test(r[0]));
  assert.match(next[1], /^<b>1,400<\/b> free for new campaigns · 2,200 scheduled \+ 700 Light &amp; Logic \+ 700 ad-hoc/);
  assert.equal(budgetView(m.deliveries, m.cycle, 5000, BUDGET).cycles[0].free, 1400);
});

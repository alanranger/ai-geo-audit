/**
 * "Squarespace campaigns by billing cycle" tile (QUESTION-2026-11-10 squarespace-campaigns-by-cycle-tile) on synthetic
 * fixtures shaped like 10 Nov: four schedules on 12 Nov (525), drafts on the engaged segment (live count, not the frozen
 * estimate_sends), two drafts with no segment chosen. Cycle bucketing at the reset instant, no double counting, the
 * live audience, the "left" maths, and agreement with the capacity tile's next-cycle drafts figure.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { meterView } from '../lib/marketing/meter.mjs';

const RESET = '2026-11-12T12:51:47.184Z';
const NOW = new Date('2026-11-10T16:26:00Z');
const LATEST = { captured_at: '2026-11-10T16:18:45Z', cycle_reset_at: RESET, quota_emails: 5000, used_emails: 3217 };

function load() {
  const win = {};
  vm.runInContext(fs.readFileSync(new URL('../lib/marketing-sqs-cycles.js', import.meta.url), 'utf8'), vm.createContext({ window: win, Date, Intl, Number, String, Map, Set, Math, Array, Object, JSON }));
  return win;
}

const sched = (key, at, recipients, list) => ({
  rec: { campaign_key: key, kind: 'theme', title: key.replace('theme|', ''), stage: 'scheduled', audience: 'segments', export_id: null, planned_send_on: at.slice(0, 10), scheduled_for: at, sqs_draft_id: `d-${key}` },
  sch: { email_id: `d-${key}`, subject: key, scheduled_for: at, mailing_list_names: [list], recipients, state: 'scheduled', collected_at: '2026-11-10T16:00:00Z', campaign_key: key, link_state: 'linked' }
});
const SCHED = [
  sched('theme|academy-return-12nov', '2026-11-12T09:30:00Z', 11, 'ARP | Academy'),
  sched('theme|gifts-engaged-12nov', '2026-11-12T10:00:00Z', 366, 'ARP | Gifts'),
  sched('theme|gifts-reconnect-12nov', '2026-11-12T10:00:00Z', 109, 'ARP | Reconnect'),
  sched('theme|norfolk-engaged-third-12nov', '2026-11-12T10:30:00Z', 39, 'ARP | Norfolk')
];
const draft = (key, day, over = {}) => ({ campaign_key: key, kind: 'theme', title: `Draft ${day}`, stage: 'drafted', audience: 'segments', segment_ids: ['gpt-8w-engaged-review'], planned_send_on: day, estimate_sends: 544, estimate_as_of: '2026-11-08', sqs_draft_id: `d-${key}`, ...over });
const NO_SEGMENT = { audience: null, segment_ids: [] };
const DRAFTS = [
  draft('theme|gpt-8w-2026-11-19', '2026-11-19'), draft('theme|gpt-8w-2026-11-26', '2026-11-26'),
  draft('theme|gpt-8w-academy-2026-12-01', '2026-12-01', { ...NO_SEGMENT, estimate_sends: 11 }),
  draft('theme|gpt-8w-2026-12-03', '2026-12-03'), draft('theme|gpt-8w-2026-12-10', '2026-12-10'),
  draft('theme|gpt-8w-pnm-2026-12-14', '2026-12-14', { ...NO_SEGMENT, estimate_sends: 127 }),
  draft('theme|gpt-8w-2026-12-17', '2026-12-17'), draft('theme|gpt-8w-2026-12-23', '2026-12-23'), draft('theme|gpt-8w-2026-12-30', '2026-12-30'),
  draft('theme|gpt-8w-2027-01-20', '2027-01-20')
];
const LIVE = 541;
/** Values built inside the vm context: compare as plain JSON (another realm's arrays aren't reference-equal prototypes). */
const same = (a, b) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b);
const estimates = () => Object.fromEntries(DRAFTS.filter((c) => c.audience === 'segments').map((c) => [c.campaign_key, { people: LIVE - 1, business_copy: 1, sends: LIVE, segment_id: 'gpt-8w-engaged-review', attached: true }]));

function overview(extra = {}) {
  const campaigns = [...SCHED.map((s) => s.rec), ...DRAFTS, ...(extra.campaigns || [])];
  const schedules = [...SCHED.map((s) => s.sch), ...(extra.schedules || [])];
  const meter = meterView(LATEST, campaigns, [], NOW, { schedules, estimates: { ...estimates(), ...(extra.estimates || {}) } });
  return { meter, segments: [{ segment_id: 'gpt-8w-engaged-review', name: '8-week plan · engaged subscribers · REVIEW' }], runs: { 'sync:customers': { status: 'ok', started_at: '2026-11-10T16:12:58Z', finished_at: '2026-11-10T16:13:22Z' } } };
}

test('three columns at Squarespace\'s reset instant: 4 scheduled this cycle, 5 drafts next cycle, 4 the cycle after, January outside', () => {
  const M = load().mkSqsCycles;
  const m = M.build(overview());
  assert.equal(m.columns.length, 3);
  same([m.bounds.reset, m.bounds.next_reset, m.bounds.after], [RESET, '2026-12-12T12:51:47.184Z', '2027-01-12T12:51:47.184Z']);
  const [cur, next, after] = m.columns;
  same(cur.rows.map((r) => [r.tag, r.amount]), [['SCHED', 11], ['SCHED', 366], ['SCHED', 109], ['SCHED', 39]]);
  same(next.rows.map((r) => [r.day, r.tag]), [['2026-11-19', 'DRAFT'], ['2026-11-26', 'DRAFT'], ['2026-12-01', 'DRAFT'], ['2026-12-03', 'DRAFT'], ['2026-12-10', 'DRAFT']]);
  same(after.rows.map((r) => r.day), ['2026-12-14', '2026-12-17', '2026-12-23', '2026-12-30']);
  assert.equal(m.outside.beyond, 1, '20 Jan is after the three cycles: not placed, counted in the footnote');
});

test('bucketing edges: an instant before the reset is this cycle, after it next; a day-only send on the reset day is not placed', () => {
  const M = load().mkSqsCycles;
  const b = M.boundsOf({ start: '2026-10-12T12:51:47.184Z', reset: RESET, next_reset: '2026-12-12T12:51:47.184Z' });
  assert.equal(M.columnOf({ side: 'current', send_at: '2026-11-12T12:51:00Z' }, b), 0);
  assert.equal(M.columnOf({ side: 'next', send_at: '2026-11-12T12:52:00Z' }, b), 1);
  assert.equal(M.columnOf({ side: 'later', send_at: '2027-01-12T12:51:00Z' }, b), 2);
  assert.equal(M.columnOf({ side: 'later', send_at: '2027-01-12T12:52:00Z' }, b), null);
  assert.equal(M.columnOf({ side: 'later', send_day: '2027-01-11' }, b), 2);
  assert.equal(M.columnOf({ side: 'later', send_day: '2027-01-12' }, b), null, 'reset day without a time: never assumed');
  assert.equal(M.columnOf({ side: 'unallocated', send_day: '2026-12-12' }, b), null);
  const m = M.build(overview({ campaigns: [draft('theme|reset-day', '2026-12-12')], estimates: { 'theme|reset-day': { sends: 50, attached: true } } }));
  assert.equal(m.outside.unallocated, 1);
});

test('DRAFT audience = the live segment count (541), not the frozen estimate_sends (544); no segment = labelled plan estimate', () => {
  const M = load().mkSqsCycles;
  const next = M.build(overview()).columns[1];
  const seg = next.rows.find((r) => r.key === 'theme|gpt-8w-2026-11-19');
  assert.equal(seg.amount, LIVE);
  assert.match(seg.basis, /^live: 8-week plan · engaged subscribers · REVIEW, counted on this read \(last customer sync 10 Nov, 16:13\)$/);
  const running = overview();
  running.runs['sync:customers'] = { status: 'running', started_at: '2026-11-10T16:45:06Z', finished_at: null };
  assert.match(M.build(running).columns[1].rows[0].basis, /\(customer sync running since 10 Nov, 16:45\)$/);
  const academy = next.rows.find((r) => r.key === 'theme|gpt-8w-academy-2026-12-01');
  assert.equal(academy.amount, 11);
  assert.match(academy.basis, /plan estimate as of 8 Nov: no segment chosen/);
  assert.equal(seg.group, '8-week plan · engaged subscribers · REVIEW');
});

test('totals = the sum of the rows; "Left after these" = provider remaining − scheduled; later cycles 5,000 − total', () => {
  const M = load().mkSqsCycles;
  const d = overview();
  const m = M.build(d);
  const sum = (rows) => rows.reduce((t, r) => t + (r.amount || 0), 0);
  const [cur, next, after] = m.columns;
  assert.equal(cur.totals.reserved, 525);
  assert.equal(cur.left.value, 5000 - 3217 - 525);
  assert.equal(cur.left.value, d.meter.capacity.free_after_commitments, 'same as the capacity tile\'s free after commitments');
  assert.equal(next.totals.total, sum(next.rows));
  assert.equal(next.totals.total, 4 * LIVE + 11);
  assert.equal(next.left.value, 5000 - next.totals.total);
  assert.equal(after.totals.total, sum(after.rows));
  assert.equal(after.totals.total, 3 * LIVE + 127);
  assert.equal(after.left.value, 5000 - after.totals.total);
  same([next.totals.n_reserved, next.totals.n_drafts], [0, 5]);
});

test('item 7: the capacity tile\'s next-cycle drafts figure and this tile\'s next-cycle drafts agree (same live amounts)', () => {
  const M = load().mkSqsCycles;
  const d = overview();
  const next = M.build(d).columns[1];
  assert.equal(d.meter.capacity.next_cycle.draft_items, next.rows.filter((r) => r.bucket === 'draft').length);
  assert.equal(d.meter.capacity.next_cycle.draft_proposals, next.totals.draft_bucket);
  assert.equal(d.meter.capacity.next_cycle.draft_proposals, 4 * LIVE + 11);
});

test('no double counting: a draft whose Squarespace draft is now an unlinked schedule is counted once, as SCHED (both tiles)', () => {
  const M = load().mkSqsCycles;
  const key = 'theme|gpt-8w-2026-11-19';
  const unlinked = { email_id: `d-${key}`, subject: 'Small details', scheduled_for: '2026-11-19T10:00:00Z', mailing_list_names: ['ARP | Small details'], recipients: 530, state: 'scheduled', collected_at: '2026-11-10T16:00:00Z', campaign_key: null, link_state: 'ambiguous', link_candidates: [key, 'theme|other'] };
  const d = overview({ schedules: [unlinked] });
  const next = M.build(d).columns[1];
  const rows = next.rows.filter((r) => r.day === '2026-11-19');
  same(rows.map((r) => [r.tag, r.amount]), [['SCHED', 530]]);
  assert.equal(d.meter.capacity.next_cycle.draft_items, 4, 'the capacity tile drops it from its drafts too');
  assert.equal(d.meter.capacity.next_cycle.committed, 530);
  assert.equal(next.totals.total, 530 + 3 * LIVE + 11);
  assert.equal(next.totals.draft_bucket, d.meter.capacity.next_cycle.draft_proposals);
});

test('released sends and cancelled records are not rows; a linked schedule is one row, not record + schedule', () => {
  const M = load().mkSqsCycles;
  const d = overview({ campaigns: [draft('theme|cancelled', '2026-11-20', { stage: 'cancelled' })], estimates: { 'theme|cancelled': { sends: 300, attached: true } } });
  const m = M.build(d);
  const all = m.columns.flatMap((c) => c.rows);
  assert.ok(!all.some((r) => r.key === 'theme|cancelled'));
  assert.equal(all.filter((r) => r.key === 'theme|gifts-engaged-12nov').length, 1);
  assert.equal(M.isOpen({ bucket: 'released' }), false);
  assert.equal(M.isOpen({ bucket: 'draft', scheduled_as: 'sqs:x' }), false);
});

test('tile HTML: 3 columns, row click keys, days left, totals hover breakdown, title tip on SCHED vs DRAFT', () => {
  const win = load();
  const html = win.mkSqsCyclesTileHtml(overview(), NOW.getTime());
  assert.equal((html.match(/data-mkc-col=/g) || []).length, 3);
  assert.match(html, /This cycle<\/div><div class="mkc-d">to Thu 12 Nov 12:51 · 2 days left/);
  assert.match(html, /Next cycle<\/div><div class="mkc-d">12 Nov → 12 Dec/);
  assert.match(html, /Cycle after<\/div><div class="mkc-d">12 Dec → 12 Jan/);
  assert.equal((html.match(/data-mkc-open=/g) || []).length, 13);
  assert.ok(html.includes('data-mkc-open="theme|gifts-engaged-12nov"'));
  assert.match(html, /Used so far 3,217 \+ scheduled<\/span><b>525<\/b>/);
  assert.match(html, /Left after these<\/span><span>1,258<\/span>/);
  assert.match(html, /0 scheduled · 5 drafts<\/span><b>2,175<\/b>/);
  assert.match(html, /<span>Free for new campaigns \(budgets not set\)<\/span><span>5,000<\/span>/, '11 Nov: the highlighted line is Free for new campaigns (no budgets in this fixture)');
  assert.match(html, /Left if all go<\/span><b>2,825<\/b>/, 'the drafts still come off it in the line below');
  assert.match(html, /title="8-week plan · engaged subscribers · REVIEW: 4 emails · 2,164 sends\nPlan estimate \(no segment chosen\): 1 email · 11 sends"/);
  assert.match(html, /SCHED = in Squarespace&#39;s Scheduled tab|SCHED = in Squarespace's Scheduled tab/);
  assert.match(html, /DRAFT = a planned campaign record, not reserved/);
  assert.equal(win.mkSqsCycles.timeLeft(RESET, Date.parse('2026-11-12T03:00:00Z')), '10 h left');
});

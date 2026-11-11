/**
 * QUESTION-2026-11-11 billing-cycle-tile-draft-counts-and-unknown-audiences: the billing-cycle footer counts every row
 * shown; drafts with no audience are counted but never costed ("x drafts without an audience yet (not costed)"), and
 * "Left if all go" becomes "Left after costed sends" while any row is un-costed. Disjoint audience versions on the same
 * day count once each with their own recipients. Emails after the three cycles are listed in the footnote.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { meterView } from '../lib/marketing/meter.mjs';

const RESET = '2026-11-12T12:51:47.184Z';
const NOW = new Date('2026-11-11T12:45:00Z');
const LATEST = { captured_at: '2026-11-11T12:30:00Z', cycle_reset_at: RESET, quota_emails: 5000, used_emails: 3217 };
const plain = (x) => JSON.parse(JSON.stringify(x));
const rec = (key, day, extra = {}) => ({ campaign_key: key, kind: 'theme', title: key.replace('theme|', ''), stage: 'drafted', audience: null, segment_ids: [], planned_send_on: day, export_id: null, sqs_draft_id: `d-${key}`, ...extra });
const sched = (id, key, at, recipients, list) => ({ email_id: id, subject: id, scheduled_for: at, mailing_list_names: [list], recipients, state: 'scheduled', collected_at: '2026-11-11T12:00:00Z', campaign_key: key, link_state: key ? 'linked' : 'unlinked' });

function load() {
  const win = {};
  vm.runInContext(fs.readFileSync(new URL('../lib/marketing-sqs-cycles.js', import.meta.url), 'utf8'), vm.createContext({ window: win, Date, Intl, Number, String, Map, Set, Math, Array, Object, JSON }));
  return win;
}
function overview({ campaigns = [], schedules = [], estimates = {} }) {
  return { meter: meterView(LATEST, campaigns, [], NOW, { schedules, estimates }), segments: [], runs: {} };
}

/* Next cycle (12 Nov → 12 Dec): one scheduled email, one costed draft, two drafts with no audience yet. */
const NEXT = {
  campaigns: [
    rec('theme|sched-19', '2026-11-19', { stage: 'scheduled', audience: 'segments', scheduled_for: '2026-11-19T19:30:00Z' }),
    rec('theme|costed-26', '2026-11-26', { audience: 'segments', segment_ids: ['seg-a'] }),
    rec('theme|noaud-03', '2026-12-03'),
    rec('theme|noaud-10', '2026-12-10')
  ],
  schedules: [sched('d-theme|sched-19', 'theme|sched-19', '2026-11-19T19:30:00Z', 576, 'ARP | 19 Nov')],
  estimates: { 'theme|costed-26': { people: 178, business_copy: 1, sends: 179, segment_id: 'seg-a', attached: true } }
};

test('footer counts every draft row shown; un-costed drafts are named and never sized', () => {
  const win = load();
  const col = plain(win.mkSqsCycles.build(overview(NEXT)).columns[1]);
  assert.equal(col.rows.length, 4);
  assert.deepEqual([col.totals.n_reserved, col.totals.n_drafts, col.totals.no_audience], [1, 3, 2], 'was "1 scheduled · 1 draft": the two drafts with no audience were missing');
  assert.equal(col.totals.total, 576 + 179, 'total = scheduled recipients + costed drafts; nothing invented for the two');
  assert.deepEqual(col.rows.filter((r) => r.amount == null).map((r) => r.key), ['theme|noaud-03', 'theme|noaud-10']);
  const html = win.mkSqsCyclesTileHtml(overview(NEXT), NOW.getTime());
  assert.match(html, /1 scheduled · 3 drafts<\/span><b>755<\/b>/);
  assert.match(html, /data-mkc-uncosted="2"[^>]*>2 drafts without an audience yet \(not costed\)</);
});

test('"Left after costed sends" while any row is un-costed; "Left if all go" only when every row is costed', () => {
  const win = load();
  const col = plain(win.mkSqsCycles.build(overview(NEXT)).columns[1]);
  assert.deepEqual([col.left.label, col.left.value], ['Left after costed sends', 5000 - 755]);
  const costed = { ...NEXT, campaigns: NEXT.campaigns.slice(0, 2) };
  const all = plain(win.mkSqsCycles.build(overview(costed)).columns[1]);
  assert.deepEqual([all.left.label, all.left.value, all.totals.uncosted], ['Left if all go', 5000 - 755, 0]);
  assert.doesNotMatch(win.mkSqsCyclesTileHtml(overview(costed), NOW.getTime()), /not costed\)/);
});

test('this cycle: an un-costed draft renames the drafts line; the reserved line keeps "Left after these"', () => {
  const win = load();
  const cur = { campaigns: [rec('theme|today', '2026-11-11', { stage: 'scheduled', audience: 'segments', scheduled_for: '2026-11-11T19:30:00Z' }), rec('theme|noaud-today', '2026-11-11')], schedules: [sched('d-theme|today', 'theme|today', '2026-11-11T19:30:00Z', 11, 'ARP | Academy')] };
  const col = plain(win.mkSqsCycles.build(overview(cur)).columns[0]);
  assert.deepEqual([col.left.label, col.left.value, col.left.drafts_label, col.totals.n_drafts, col.totals.no_audience], ['Left after these', 5000 - 3217 - 11, 'Left after costed sends', 1, 1]);
});

test('disjoint audience versions on the same day: each counted once with its own recipients (separate records, or two schedules on one record)', () => {
  const win = load();
  const twoRecords = {
    campaigns: [rec('theme|v-8w-26', '2026-11-26', { stage: 'scheduled', audience: 'segments', scheduled_for: '2026-11-26T19:30:00Z' }), rec('theme|v-res-26', '2026-11-26', { stage: 'scheduled', audience: 'segments', scheduled_for: '2026-11-26T19:30:00Z' })],
    schedules: [sched('d-theme|v-8w-26', 'theme|v-8w-26', '2026-11-26T19:30:00Z', 179, 'ARP | 8w'), sched('d-theme|v-res-26', 'theme|v-res-26', '2026-11-26T19:30:00Z', 399, 'ARP | residential')]
  };
  const a = plain(win.mkSqsCycles.build(overview(twoRecords)).columns[1]);
  assert.deepEqual(a.rows.map((r) => [r.tag, r.amount]), [['SCHED', 179], ['SCHED', 399]]);
  assert.equal(a.totals.reserved, 578);
  const oneRecord = {
    campaigns: [rec('theme|v-26', '2026-11-26', { stage: 'scheduled', audience: 'segments', scheduled_for: '2026-11-26T19:30:00Z' })],
    schedules: [sched('d-theme|v-26', 'theme|v-26', '2026-11-26T19:30:00Z', 179, 'ARP | version A'), { ...sched('second-version', 'theme|v-26', '2026-11-26T19:30:00Z', 399, 'ARP | version B'), collected_at: '2026-11-11T11:00:00Z' }]
  };
  const b = plain(win.mkSqsCycles.build(overview(oneRecord)).columns[1]);
  assert.deepEqual(b.rows.map((r) => r.amount).sort((x, y) => x - y), [179, 399], 'each version once, its own recipients');
  assert.equal(b.totals.reserved, 578, 'never 2 × one version, never both on one row');
});

test('emails after the three cycles: listed in the footnote with their dates and costed sends (they show once this cycle resets)', () => {
  const win = load();
  const late = { campaigns: [rec('theme|jan-14', '2027-01-14', { stage: 'scheduled', audience: 'segments', scheduled_for: '2027-01-14T19:30:00Z' }), rec('theme|jan-28', '2027-01-28', { stage: 'scheduled', audience: 'segments', scheduled_for: '2027-01-28T19:30:00Z' })], schedules: [sched('d-theme|jan-14', 'theme|jan-14', '2027-01-14T19:30:00Z', 399, 'ARP | Jan'), sched('d-theme|jan-28', 'theme|jan-28', '2027-01-28T19:30:00Z', 239, 'ARP | Jan 28')] };
  const m = plain(win.mkSqsCycles.build(overview(late)));
  assert.equal(m.outside.beyond, 2);
  const html = win.mkSqsCyclesTileHtml(overview(late), NOW.getTime());
  assert.match(html, /data-mkc-outside title="14 Jan · SCHED · jan-14 · 399\n28 Jan · SCHED · jan-28 · 239">2 emails after these three cycles \(14 Jan → 28 Jan · 638 sends\): in the cycle from 12 Jan, shown once this cycle resets</);
});

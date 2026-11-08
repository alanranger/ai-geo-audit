/**
 * Marketing schedule (question 2026-11-08 marketing-tab-schedule-views-days-and-weeks) on synthetic fixtures built
 * through the real builders: server deliveries (lib/marketing/delivery.mjs deliveryView) → browser delivery items
 * (lib/marketing-delivery.js) → schedule model (lib/marketing-schedule-model.js). Checks: counts per week and
 * channel (w/c 9 Nov = the strategy_campaigns email rows that week), the rolling-7-day email rule, the Norfolk 8 Nov
 * duplicate pair, gaps as "nothing planned" (no invented steps), Facebook + Instagram as one card, "Selling this week".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { deliveryView } from '../lib/marketing/delivery.mjs';

const NOW = new Date('2026-11-08T13:00:00Z');
const TODAY = '2026-11-08';
const RESET = '2026-11-12T12:51:47.184Z';
const METER = { captured_at: '2026-11-08T12:54:13Z', cycle_reset_at: RESET, quota_emails: 5000, used_emails: 2437 };

function browser() {
  const store = {};
  const win = { localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } } };
  const document = { getElementById: () => null, head: { insertAdjacentHTML: () => {} } };
  const ctx = vm.createContext({ window: win, document, localStorage: win.localStorage, Intl, Date, Number, String, Map, Set, JSON, Math, Promise, Array, Object, console });
  for (const f of ['../lib/marketing-delivery.js', '../lib/marketing-schedule-model.js']) vm.runInContext(fs.readFileSync(new URL(f, import.meta.url), 'utf8'), ctx);
  return win;
}

/** A scheduled theme email with an operator-verified Squarespace schedule (recipients on the record). */
const theme = (key, title, at, people, extra = {}) => ({ campaign_key: key, kind: 'theme', title, stage: 'scheduled', window_start: at.slice(0, 10), window_end: at.slice(0, 10), audience: 'segments', scheduled_for: at, scheduled_recipients: people, schedule_evidence: 'operator_verified', schedule_evidence_by: 'Alan via GPT', ...extra });
const CAMPAIGNS = [
  { campaign_key: 'event|2026-11-20|/norfolk', kind: 'event', title: 'Norfolk Photography Workshop | Cromer to Hunstanton', stage: 'drafted', export_id: 'x-nor', planned_send_on: '2026-11-08', window_end: '2026-11-20' },
  theme('theme|norfolk-workshops-8nov', 'Norfolk, Macro and something to watch', '2026-11-08T17:00:00Z', 311, { export_id: 'x-nw' }),
  theme('theme|return-9nov', 'Something to inspire your next photograph', '2026-11-09T10:00:00Z', 111),
  theme('theme|pnm', 'Pick n Mix Kick-Starter relaunch', '2026-11-10T10:00:00Z', 127, { window_end: '2026-12-15' }),
  theme('theme|gifts-engaged-12nov', 'A photography gift - and your November update', '2026-11-12T10:00:00Z', 371),
  theme('theme|gifts-reconnect-12nov', 'Give someone time for their photography', '2026-11-12T10:00:00Z', 111),
  theme('theme|norfolk-third-12nov', 'Norfolk offer ends Saturday - a final workshop reminder', '2026-11-12T10:30:00Z', 39),
  theme('theme|academy-12nov', 'Your next step with the Photography Academy', '2026-11-12T09:30:00Z', 11),
  { campaign_key: 'email|2026-11-09', kind: 'weekly_email', title: 'Weekly email Thu 12 Nov', stage: 'cancelled', window_start: '2026-11-12', scheduled_for: '2026-11-12T17:30:00Z', estimate_sends: 0 }
];
const EXPORTS = [
  { export_id: 'x-nor', campaign_key: null, list_name: 'ARP | Norfolk150', eligible_count: 313, status: 'blocked', owner: { included: true, count: 0, business_copy: 1 } },
  { export_id: 'x-nw', campaign_key: 'theme|norfolk-workshops-8nov', list_name: 'ARP | Norfolk workshop clients', eligible_count: 310, status: 'pending_import', owner: { included: true, count: 0, business_copy: 1 } }
];
const people = (from, k) => new Set(Array.from({ length: k }, (_, i) => `p${from + i}`));
const MEMBERS = new Map([['x-nor', people(0, 313)], ['x-nw', people(3, 310)]]);

const step = (week, channel, day, text, extra = {}) => ({ key: `step|${week}|${channel}|${day}`, week, channel, day, scheduled_day: day, step: text, brief: '', covers: [], featured: [], ...extra });
const WEEKS = [
  { week: '2026-11-02', rows: [], steps: [
    step('2026-11-02', 'Facebook + Instagram', '2026-11-03', 'Post: Norfolk 20–22 Nov'),
    step('2026-11-02', 'LinkedIn', '2026-11-04', 'Post: Lightroom course starts Thu 12 Nov')
  ] },
  { week: '2026-11-09', rows: [{ type: 'moment', stage: 'Last places', name: 'Hay Woods walk', event_key: '2026-12-04|/hay-woods', date: '2026-12-04' }], steps: [
    step('2026-11-09', 'Outlook personal notes', '2026-11-09', 'Personal note to past clients: "Last places Hay Woods walk Fri 4 Dec"'),
    step('2026-11-09', 'Google Business', '2026-11-09', 'Google Business check (5–10 min)', { gbp: 'check' }),
    step('2026-11-09', 'Facebook + Instagram', '2026-11-10', 'Post: Norfolk 20–22 Nov'),
    step('2026-11-09', 'LinkedIn', '2026-11-11', 'Post: Lightroom course starts Tue 12 Jan'),
    step('2026-11-09', 'Squarespace email', '2026-11-12', 'Main email of the week: "Hay Woods walk, Norfolk"', { is_email: true })
  ] },
  { week: '2026-11-16', rows: [], steps: [step('2026-11-16', 'Squarespace email', '2026-11-19', 'Main email of the week: "Hay Woods walk, Suffolk"', { is_email: true })] }
];
const STRATEGY = {
  week_start: '2026-11-02',
  diary: [{ date: '2026-11-20', title: 'Norfolk Photography Workshop | Cromer to Hunstanton', url: '/norfolk' }],
  campaign: {
    weeks: WEEKS, carried: { late: [], older: [] }, ticks: {}, rules: { email: { per_week: 1 } },
    overrides: { '2026-11-20|/norfolk': { offer_code: 'NORFOLK150', offer_note: '£150 off', offer_ends: '2026-11-14' } },
    campaigns: [
      ...CAMPAIGNS.map((c) => ({ ...c })),
      { campaign_key: 'email|2026-11-16', kind: 'weekly_email', title: 'Weekly email w/c 2026-11-16', stage: 'proposed', window_start: '2026-11-19', audience: null }
    ]
  },
  quarter_plan: {
    quarters: [{ key: 'q1-2026', state: 'current', end_date: '2026-12-31' }],
    initiatives: {
      gifts: { kind: 'initiative', title: 'Gifts & Christmas revenue', start_date: '2026-11-01', end_date: '2026-12-31', actions: [{ label: 'Christmas gift push for beginners course', due: '2026-11-16', is_ticked: false }] },
      housekeeping: { kind: 'housekeeping', title: 'Housekeeping', start_date: '2026-10-01', end_date: '2027-09-30', actions: [] }
    }
  }
};

function model(over = {}) {
  const win = browser();
  const meter = deliveryView(METER, { campaigns: CAMPAIGNS, exports: EXPORTS, schedules: [], sent: [], runs: [], members: MEMBERS, ...over.inputs }, {}, NOW);
  const d = { meter: { ...meter, capacity: meter.capacity } };
  const s = over.s || STRATEGY;
  const items = win.mkDeliveryItems(d, s);
  const m = win.mkScheduleModel.build({ items, d, s, cap: { ...meter.capacity, unchosen: [] }, g: over.g || null, today: TODAY });
  return { win, m, d, s, items };
}
const weekOf = (m, win, week) => win.mkScheduleModel.weeks(m, 8).find((w) => w.week === week);
const plain = (v) => JSON.parse(JSON.stringify(v));

test('w/c 9 Nov: email count and sends match the strategy_campaigns email rows that week (cancelled weekly left out)', () => {
  const { m, win } = model();
  const rows = CAMPAIGNS.filter((c) => c.stage !== 'cancelled' && c.scheduled_for && c.scheduled_for.slice(0, 10) >= '2026-11-09' && c.scheduled_for.slice(0, 10) <= '2026-11-15');
  const w = weekOf(m, win, '2026-11-09');
  assert.equal(w.emails.count, rows.length);
  assert.equal(w.emails.count, 6);
  assert.equal(w.emails.sends, rows.reduce((t, c) => t + c.scheduled_recipients, 0));
  assert.equal(w.emails.sends, 770);
  assert.equal(w.cells.email.length, 3, 'Mon, Tue singly; Thu 4 emails folded into one card');
  const thu = w.cells.email.find((c) => c.group);
  assert.deepEqual([thu.day, thu.count, thu.people], ['2026-11-12', 4, 532]);
});

test('counts per channel: FB+IG is one card per post, late posts fold into one late card in their week', () => {
  const { m, win, items } = model();
  assert.equal(items.filter((x) => x.channel === 'facebook' || x.channel === 'instagram').length, 4, 'builder: one item per platform');
  assert.equal(m.items.filter((x) => x.row === 'fbig').length, 2, 'schedule: one card per shared post');
  const w2 = weekOf(m, win, '2026-11-02');
  assert.deepEqual([w2.cells.fbig.length, w2.cells.fbig[0].late, w2.cells.linkedin[0].late], [1, true, true]);
  const w9 = weekOf(m, win, '2026-11-09');
  assert.deepEqual(['fbig', 'linkedin', 'outlook', 'gbp'].map((r) => w9.cells[r].length), [1, 1, 1, 1]);
  assert.equal(m.byId.get(w9.cells.fbig[0].id).state, 'pl');
});

test('rolling 7 days: more than 2 emails in any 7 days is red; an approved exception covering the window is not', () => {
  const { m, win } = model();
  const R = win.mkScheduleModel.rolling;
  const counts = new Map([['2026-11-09', 1], ['2026-11-10', 1]]);
  assert.equal(R(counts, '2026-11-09', '2026-11-15', []).red, false, '2 in 7 days is within the limit');
  counts.set('2026-11-12', 1);
  const r = R(counts, '2026-11-09', '2026-11-15', []);
  assert.deepEqual([r.max, r.at, r.red], [3, '2026-11-12', true]);
  assert.equal(R(counts, '2026-11-09', '2026-11-15', [{ from: '2026-11-12', to: '2026-11-12' }]).red, false);
  assert.equal(R(new Map([['2026-11-01', 2], ['2026-11-09', 1]]), '2026-11-09', '2026-11-15', []).red, false, '8 days apart: two windows');
  assert.equal(R(new Map([['2026-11-08', 2], ['2026-11-09', 1]]), '2026-11-09', '2026-11-15', []).red, true, 'Sun 8 counts against Mon 9');
  assert.equal(weekOf(m, win, '2026-11-09').emails.red, true);
  assert.equal(weekOf(m, win, '2026-11-16').emails.red, false, 'judged by its own emails: Thu 19 has 1 in its 7 days');
});

test('Norfolk 8 Nov: the send budget duplicate pair shows on both cards and as the first Needs-you line', () => {
  const { m, d } = model();
  const w = d.meter.warnings.find((x) => /Possible duplicate/.test(x.text));
  assert.deepEqual(w.pair, ['event|2026-11-20|/norfolk', 'theme|norfolk-workshops-8nov']);
  assert.equal(m.pairs.length, 1);
  const [a, b] = m.pairs[0];
  assert.deepEqual([a.record_key, b.record_key].sort(), ['event|2026-11-20|/norfolk', 'theme|norfolk-workshops-8nov']);
  assert.deepEqual([a.dup, b.dup], [b.id, a.id]);
  assert.deepEqual([a.day, b.day, a.people, b.people], [TODAY, TODAY, 314, 311]);
  assert.match(m.needs[0].text, /may be the same email \(314 \/ 311 people\)/);
  assert.deepEqual(plain(m.needs[0].ids).sort(), [a.id, b.id].sort());
});

test('an unmatched Squarespace schedule beside a same-day candidate record is the duplicate pair once that record is cancelled', () => {
  const sched = { email_id: '6af06c3b60d4554034f330ba', subject: 'Norfolk, 20–22 November — last 2 places', scheduled_for: '2026-11-08T17:00:00Z', mailing_list_names: ['ARP | Norfolk workshop clients'], recipients: 311, state: 'scheduled', collected_at: '2026-11-08T12:54:14Z', campaign_key: null, link_state: 'ambiguous', link_candidates: ['event|2026-11-20|/norfolk', 'theme|norfolk-workshops-8nov'] };
  const campaigns = CAMPAIGNS.map((c) => (c.campaign_key === 'event|2026-11-20|/norfolk' ? { ...c, stage: 'cancelled' } : c));
  const { m } = model({ inputs: { campaigns, schedules: [sched] } });
  assert.equal(m.pairs.length, 1);
  assert.deepEqual(plain(m.pairs[0].map((x) => x.record_key)).sort(), ['sqs:6af06c3b60d4554034f330ba', 'theme|norfolk-workshops-8nov']);
  assert.equal(m.items.find((x) => x.record_key === 'event|2026-11-20|/norfolk').state, 'resolved', 'cancelled record not on the grid');
  assert.ok(!m.needs.some((x) => x.link), 'paired, so no separate "link it" line');
});

test('gaps: future weeks with no step say "nothing planned" on Email / FB+IG / LinkedIn; no steps are invented', () => {
  const { m, win } = model();
  const w16 = weekOf(m, win, '2026-11-16');
  assert.deepEqual([w16.gaps.email, w16.gaps.fbig, w16.gaps.linkedin, w16.gaps.outlook, w16.gaps.gbp], [false, true, true, false, false]);
  assert.deepEqual([w16.emails.count, w16.emails.unknown, w16.emails.sends], [1, 1, 0], 'the weekly email step has no audience yet: counted, people unknown');
  const w23 = weekOf(m, win, '2026-11-23');
  assert.deepEqual([w23.gaps.email, w23.gaps.fbig, w23.gaps.linkedin], [true, true, true]);
  assert.equal(Object.values(w23.cells).flat().length, 0, 'nothing invented for a week with no steps');
  assert.equal(win.mkScheduleModel.weeks(m, 8).length, 8);
  assert.equal(win.mkScheduleModel.weeks(m, 20, win.mkScheduleModel.quarterEnd(STRATEGY)).at(-1).week, '2026-12-28');
});

test('Days view: today first, late items gathered in today\'s column, offer end on its day', () => {
  const { m, win } = model({ g: { reachable: true, last_post_at: '2026-11-08T08:10:00Z' } });
  const dv = win.mkScheduleModel.days(m, TODAY, 7);
  assert.deepEqual([dv.days[0], dv.days[6], dv.blocks], [TODAY, '2026-11-14', 1]);
  const email = dv.rows.find((r) => r.row === 'email');
  assert.equal(email.cells[0].length, 2, 'Sun 8: the two Norfolk records');
  assert.equal(email.cells[4].length, 4, 'Thu 12: four emails');
  const fbig = dv.rows.find((r) => r.row === 'fbig');
  assert.deepEqual([fbig.late.length, fbig.cells.flat().length], [1, 1], 'late 3 Nov post in today\'s column; Tue 10 post on its day');
  assert.equal(dv.rows.find((r) => r.row === 'gbp').cells[0][0].short, 'Auto post');
  assert.deepEqual(dv.offers.map((o) => o.offer_code), ['NORFOLK150']);
  assert.equal(win.mkScheduleModel.days(m, TODAY, 28).blocks, 4);
});

test('Selling this week: moments, offer end, events and quarter-plan actions; housekeeping never shown', () => {
  const { win } = model();
  const S = win.mkScheduleModel.sellingFor;
  const w9 = plain(S(STRATEGY, '2026-11-09').map((x) => `${x.b} ${x.t}`.trim()));
  assert.deepEqual(w9, ['Hay Woods walk last places', 'NORFOLK150 ends Sat 14']);
  const w16 = plain(S(STRATEGY, '2026-11-16').map((x) => `${x.b} ${x.t}`.trim()));
  assert.deepEqual(w16, ['Norfolk 20 Nov', 'Christmas gift push for beginners course']);
  const quiet = plain(S(STRATEGY, '2026-12-07').map((x) => [x.t, !!x.quiet]));
  assert.deepEqual(quiet, [['Gifts & Christmas revenue', true]]);
});

test('card titles are at most 4 words; the full title is kept', () => {
  const { win, m } = model();
  const T = win.mkScheduleModel.shortTitle;
  assert.equal(T('Weekly email (Hay Woods walk, Norfolk)'), 'Weekly: Hay Woods walk');
  assert.equal(T('Post: "Last 2 places" for Norfolk 20–22 Nov'), 'Last 2 places Norfolk');
  assert.equal(T('Norfolk, 20–22 November — last 2 places, £150 off'), 'Norfolk, 20–22 November');
  assert.equal(T('Google Business check (5–10 min)'), 'Weekly check');
  for (const x of m.items) assert.ok(x.short.split(/\s+/).length <= 4, x.short);
  assert.ok(m.items.every((x) => x.title));
});

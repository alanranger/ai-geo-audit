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
  const d = { meter: { ...meter, capacity: meter.capacity }, ...(over.drafts ? { drafts: over.drafts } : {}) };
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

/** Per-person inputs (lib/marketing/frequency.mjs shape): disjoint cohorts, one approved third-email exception. */
const FREQ = (extra = []) => ({
  emails: [
    { key: 'theme|a', day: '2026-11-08', people: ['p1', 'p2', 'p3', 'p4'], owners: 1 },
    { key: 'theme|b', day: '2026-11-10', people: ['p1', 'p2', 'p3'], owners: 1 },
    { key: 'theme|c', day: '2026-11-12', people: ['p5', 'p6'], owners: 1 },
    { key: 'theme|third', day: '2026-11-12', people: ['p1'], owners: 1, exception: true },
    ...extra
  ],
  academy: [{ day: '2026-11-11', person: 'p4' }],
  drafts: [{ key: 'theme|gpt-8w-2026-11-19', day: '2026-11-19', sends: 544 }]
});

test('an unmatched Squarespace draft is listed in Needs you as "unmatched platform draft" (final fix item 10)', () => {
  const { m } = model({ drafts: { available: true, drafts: 10, linked: 9, unmatched: [{ email_id: 'b1', subject: 'Academy return — review draft, no audience', link_state: 'unlinked' }] } });
  const need = m.needs.find((x) => /unmatched platform draft/.test(x.text));
  assert.ok(need);
  assert.match(need.text, /^1 unmatched platform draft in Squarespace \(“Academy return/);
  assert.equal(need.go, 'mkd-drafts');
  assert.ok(!model().m.needs.some((x) => /unmatched platform draft/.test(x.text)), 'none without drafts data');
});

test('per person, not per campaign: 5 emails in a week to disjoint cohorts is fine; >2 only with an approved exception', () => {
  const { m, win } = model({ inputs: { frequency: FREQ() } });
  const w = weekOf(m, win, '2026-11-09').emails;
  assert.equal(w.per_person, '3×2 · 1×3 (approved) · 2×1', 'p2 p3 p4 get 2 (p4 = 1 email + 1 Academy auto), p1 gets 3 under the exception');
  assert.deepEqual([w.red, w.amber, w.freq.emails, w.freq.sends, w.freq.owner_copies, w.freq.academy_auto], [false, false, 4, 14, 4, 1]);
  assert.ok(!m.needs.some((x) => /limit|emails in the next 7 days/.test(x.text)), 'no campaign-count limit message');
  assert.equal(weekOf(m, win, '2026-11-16').emails.freq_estimate, true, 'a draft with no saved audience = estimate');
});

test('per person: amber at 3 without an approved exception, red only at 4+', () => {
  const amber = model({ inputs: { frequency: FREQ([{ key: 'theme|d', day: '2026-11-13', people: ['p2'], owners: 1 }]) } });
  const wa = weekOf(amber.m, amber.win, '2026-11-09').emails;
  assert.deepEqual([wa.amber, wa.red, wa.per_person], [true, false, '2×2 · 2×3 (1 approved) · 2×1']);
  assert.match(amber.m.needs.find((x) => x.level === 'amber' && /3 emails/.test(x.text)).text, /^1 person gets 3 emails in 7 days .* without an approved exception \(1 more covered/);
  const red = model({ inputs: { frequency: FREQ([{ key: 'theme|d', day: '2026-11-13', people: ['p1'], owners: 1, exception: true }]) } });
  const wr = weekOf(red.m, red.win, '2026-11-09').emails;
  assert.deepEqual([wr.red, wr.max], [true, 4], 'an exception never covers a 4th email');
  assert.ok(red.m.needs.some((x) => x.level === 'red' && /4 or more emails/.test(x.text)));
});

test('drafts: GPT\'s drafted email and manual social step are dashed draft cards, never counted as sends', () => {
  const draft = { campaign_key: 'theme|gpt-8w-2026-11-19', kind: 'theme', title: 'Small details, new possibilities', stage: 'drafted', planned_send_on: '2026-11-19', estimate_sends: 544, sqs_draft_id: 'a'.repeat(24), audience: 'segments' };
  const social = { key: 'gpt-8w-social-2026-11-20-fbig', week: '2026-11-16', day: '2026-11-20', scheduled_day: '2026-11-20', channel: 'Facebook + Instagram', step: 'From small details to winter landscapes', brief: 'brief', covers: [], featured: [], manual: true, state: { status: 'pending' } };
  const s = { ...STRATEGY, campaign: { ...STRATEGY.campaign, carried: { late: [], older: [], future: [social] } } };
  const { m, win } = model({ inputs: { campaigns: [...CAMPAIGNS, draft] }, s });
  const em = m.items.find((x) => x.record_key === draft.campaign_key);
  const fb = m.items.find((x) => x.step_key === social.key);
  assert.deepEqual([em.draft, em.state, em.time, em.people], [true, 'pl', 'draft · time not set', 544]);
  assert.deepEqual([fb.draft, fb.state, fb.day], [true, 'pl', '2026-11-20']);
  const w = weekOf(m, win, '2026-11-16').emails;
  assert.deepEqual([w.count, w.drafts, w.draft_people], [1, 1, 544], 'the draft is listed apart; only the weekly step counts');
  assert.equal(weekOf(m, win, '2026-11-09').emails.sends, 770, 'reserved sends unchanged by drafts');
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
  assert.equal(win.mkScheduleModel.weeks(m, 20, win.mkScheduleModel.quarterEnd(STRATEGY)).at(-1).week, '2026-12-28');
});

test('"This week + 8" from Sun 8 Nov: 9 rows w/c 9 Nov → w/c 4 Jan; the week ending today shows above only with late items', () => {
  const { m, win } = model();
  const list = win.mkScheduleModel.weeks(m, 9);
  const main = list.filter((w) => w.week >= '2026-11-09');
  assert.deepEqual([main.length, main[0].week, main.at(-1).week], [9, '2026-11-09', '2027-01-04']);
  assert.deepEqual([list[0].week, list[0].tag, main[0].tag], ['2026-11-02', 'this week · ends today', 'next week · from tomorrow'], 'w/c 2 Nov has late posts');
  assert.equal(win.mkScheduleModel.firstWeek('2026-11-09'), '2026-11-09', 'Monday: this week');
  assert.equal(win.mkScheduleModel.firstWeek('2026-11-12'), '2026-11-09', 'Thursday: this week');
  const quiet = model({ s: { ...STRATEGY, campaign: { ...STRATEGY.campaign, weeks: WEEKS.slice(1) } }, inputs: { campaigns: CAMPAIGNS.filter((c) => !c.scheduled_for || c.scheduled_for >= '2026-11-09') } });
  const q = win.mkScheduleModel.weeks(quiet.m, 9);
  assert.equal(q.length >= 9, true, 'never fewer than 9');
});

test('generator placeholder weekly email is not shown or counted where a real campaign covers that week; its modules show on the campaign', async () => {
  const { markCoveredEmailSteps } = await import('../lib/strategy-campaigns.mjs');
  const gpt = (day, title) => ({ campaign_key: `theme|gpt-8w-${day}`, kind: 'theme', title, stage: 'drafted', planned_send_on: day, window_start: day, window_end: day, audience: 'segments', estimate_sends: 546, sqs_draft_id: `draft-${day}` });
  const drafts = [gpt('2026-11-19', 'Small details, new possibilities — and a photography gift'), gpt('2026-11-26', 'A photography gift they can choose for themselves')];
  const w23 = { week: '2026-11-23', rows: [], steps: [step('2026-11-23', 'Squarespace email', '2026-11-26', 'Main email of the week: "Woodland masterclass, Abstract & Macro"', { is_email: true, featured: [{ name: 'Woodland masterclass', when: 'Sun 10 Jan', stage: 'Main push' }] })] };
  const weeks = markCoveredEmailSteps([...WEEKS.map((w) => ({ ...w, steps: w.steps.map((x) => ({ ...x })) })), w23], [...CAMPAIGNS, ...drafts]);
  assert.deepEqual(plain(weeks[2].steps[0].covered_by), ['theme|gpt-8w-2026-11-19']);
  const s = { ...STRATEGY, campaign: { ...STRATEGY.campaign, weeks, campaigns: STRATEGY.campaign.campaigns.filter((c) => c.campaign_key !== 'email|2026-11-16') } };
  const { m, win } = model({ s, inputs: { campaigns: [...CAMPAIGNS, ...drafts] } });
  for (const wk of ['2026-11-16', '2026-11-23']) {
    const w = weekOf(m, win, wk);
    const cards = w.cells.email.map((c) => m.byId.get(c.id));
    assert.deepEqual(plain(cards.map((x) => x.record_key)), [`theme|gpt-8w-${wk === '2026-11-16' ? '2026-11-19' : '2026-11-26'}`], `${wk}: one weekly email`);
    assert.equal(w.emails.unknown, 0, `${wk}: no "+1 not drafted"`);
  }
  const ph = m.items.find((x) => x.step_key === 'step|2026-11-23|Squarespace email|2026-11-26');
  assert.deepEqual([ph.state, plain(ph.covered_by)], ['resolved', ['theme|gpt-8w-2026-11-26']]);
  assert.deepEqual(plain(m.items.find((x) => x.record_key === 'theme|gpt-8w-2026-11-26').suggested), ['Woodland masterclass Sun 10 Jan (main push)']);
  assert.equal(drafts.length + CAMPAIGNS.length, 11, 'no records created or removed');
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
  assert.deepEqual(w16, ['Norfolk 20 Nov', 'Christmas gift push for…']);
  const quiet = plain(S(STRATEGY, '2026-12-07').map((x) => [x.t, !!x.quiet]));
  assert.deepEqual(quiet, [['Gifts & Christmas revenue', true]]);
});

const MOMENTS = [
  { moment_key: 'bfcm-2026', label: 'Black Friday / Cyber Monday', starts_on: '2026-11-27', ends_on: '2026-11-30', priority: 10 },
  { moment_key: 'pnm-kickstarter-deadline-2026', label: 'Pick n Mix Kick-Starter deadline', starts_on: '2026-12-15', ends_on: null, priority: 10 },
  { moment_key: 'christmas-2026', label: 'Christmas', starts_on: '2026-12-25', ends_on: '2026-12-26', priority: 30 },
  { moment_key: 'gift-vouchers-2026', label: 'Christmas gift vouchers', starts_on: '2026-11-16', ends_on: '2026-12-24', priority: 40 }
];
test('Selling this week: fixed moments first (BF/CM w/c 23 Nov, 15 Dec w/c 14 Dec), at most 4; next action replaces the stale wording; "don\'t promote" only as happening', () => {
  const { win } = model();
  const S = win.mkScheduleModel.sellingFor;
  const gifts = { ...STRATEGY.quarter_plan.initiatives.gifts, next_action: 'Gift email', next_action_date: '2026-11-16' };
  const s = {
    ...STRATEGY,
    diary: [...STRATEGY.diary, { date: '2026-12-01', title: 'Camera Courses For Beginners - 3-week beginners - Coventry', url: '/beginners-dec' }],
    campaign: { ...STRATEGY.campaign, overrides: { ...STRATEGY.campaign.overrides, '2026-12-01|/beginners-dec': { promote_mode: 'dont_promote' } } },
    quarter_plan: { ...STRATEGY.quarter_plan, initiatives: { ...STRATEGY.quarter_plan.initiatives, gifts } }
  };
  const text = (week) => plain(S(s, week, MOMENTS).map((x) => (x.quiet ? `(${x.t})` : `${x.b} ${x.t}`.trim())));
  assert.deepEqual(text('2026-11-23'), ['Black Friday / Cyber Monday 27–30 Nov', 'Christmas gift vouchers']);
  assert.deepEqual(text('2026-12-14'), ['Pick n Mix Kick-Starter deadline 15 Dec', 'Christmas gift vouchers']);
  assert.deepEqual(text('2026-11-16'), ['Christmas gift vouchers', 'Norfolk 20 Nov', 'Gift email 16 Nov']);
  assert.ok(!text('2026-11-16').some((t) => /beginners course/i.test(t)), 'no "Christmas gift push for beginners course"');
  assert.deepEqual(text('2026-11-30'), ['Black Friday / Cyber Monday 27–30 Nov', 'Christmas gift vouchers', '(Beginners course 1 Dec (not promoted))'], '1 Dec beginners: happening, not selling');
  const many = [...MOMENTS, ...['a', 'b', 'c', 'd'].map((k) => ({ moment_key: k, label: `Moment ${k}`, starts_on: '2026-11-24', priority: 60 }))];
  assert.equal(S(s, '2026-11-23', many).length, 4, 'at most 4');
});

test('card titles never drop words: short title if set, else cut at a word boundary with "…"; the full title is kept', () => {
  const { win, m } = model();
  const T = win.mkScheduleModel.shortTitle;
  assert.equal(T('A photography gift they can choose for themselves'), 'A photography gift they can…');
  assert.equal(T('Give someone time for their photography'), 'Give someone time for their…');
  assert.equal(T('Still looking for a photography gift? It can arrive by email'), 'Still looking for a…');
  assert.equal(T('Something to inspire your next photograph'), 'Something to inspire your…');
  assert.equal(T('A photography gift they can choose for themselves', 'Gift they choose'), 'Gift they choose', 'the campaign\'s short title wins');
  assert.equal(T('Post: "Last 2 places" for Norfolk 20–22 Nov'), 'Last 2 places for Norfolk…');
  assert.equal(T('Google Business check (5–10 min)'), 'Weekly check');
  for (const x of m.items) {
    assert.ok(x.short.replace(/…$/, '').length <= 28, x.short);
    const words = x.short.replace(/…$/, '').split(/\s+/);
    if (!/^Weekly|Auto post/.test(x.short)) assert.ok(x.title.replace(/["“”]/g, '').includes(words.join(' ')), `${x.short} is a prefix of ${x.title}`);
  }
  assert.ok(m.items.every((x) => x.title));
});

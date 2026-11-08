import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assemblePlan, courseLastNights, purposeRule } from '../lib/strategy-initiatives.mjs';
import { initiativeStatus, kpiBoxes, milestoneEnd } from '../lib/strategy-initiative-measures.mjs';
import { defaultStrategyActions } from '../lib/strategy-action-seed.mjs';
import { changesOf, initiativePatch, linkRow } from '../api/aigeo/strategy-initiatives.js';

const SQL = fs.readFileSync(new URL('../migrations/strategy_initiatives_20261108.sql', import.meta.url), 'utf8');
const TODAY = '2026-11-08';

test('seed maps every existing quarter action exactly once', () => {
  const block = SQL.split("select 'https://www.alanranger.com', 'action'")[1].split('on conflict')[0];
  const keys = [...block.matchAll(/^\s*\('([a-z0-9-]+)', '([a-z0-9-]+)'/gm)].map((m) => m[1]);
  const expected = defaultStrategyActions().map((a) => a.action_key);
  assert.equal(keys.length, expected.length);
  assert.deepEqual([...keys].sort(), [...expected].sort());
  assert.equal(new Set(keys).size, keys.length);
});

test('seed: approved gift base target, stretch unapproved, no December beginners promotion, no build history', () => {
  assert.match(SQL, /"total": 2100/);
  assert.match(SQL, /"amount": 1100, "actual": "booking_sheet_category"/);
  assert.match(SQL, /"amount": 1000, "actual": "evidence", "evidence": \[\]/);
  assert.match(SQL, /"stretch": \{"approved": false/);
  assert.match(SQL, /not like-for-like gift actuals/);
  assert.doesNotMatch(SQL, /dec(ember)? beginners/i);
  assert.doesNotMatch(SQL, /dropped|push dropped/i);
  assert.match(SQL, /no offer is approved/);
});

const ini = (k, extra = {}) => ({ initiative_key: k, kind: 'initiative', title: k, quarter_keys: ['q1-2026'], owner: 'GPT', next_action_date: '2026-11-16', review_date: '2026-11-30', status_rule: { type: 'not_set' }, focus: {}, ...extra });
function fixture(over = {}) {
  const initiatives = [
    ini('q1-gifts', { measure: 'gift', status_rule: { type: 'target', needs_known_actuals: true }, target: { total: 2100, window: { start: '2026-11-01', end: '2026-12-31' }, lines: [{ key: 'vouchers', label: 'Gift voucher issue receipts', amount: 1100, actual: 'booking_sheet_category', category: 8 }, { key: 'gift_121', label: 'Gift 1-to-1 sales', amount: 1000, actual: 'evidence', evidence: [] }] } }),
    ini('q1-pnm', { measure: 'pnm', status_label: 'In progress', status_rule: { type: 'milestone_pace', benchmark: 'straight-line' }, focus: { campaign_key: 'theme|pnm' } }),
    ini('q1-near', { focus: { event_rule: { from: '2026-11-08', to: '2027-01-31' }, rule_priority: 20 } }),
    ini('q2-spring', { quarter_keys: ['q1-2026', 'q2-2027'], focus: { event_rule: { from: '2027-02-01', to: '2027-09-30' }, rule_priority: 40 } }),
    ini('prog-learning-relationships', { kind: 'programme', measure: 'purpose', quarter_keys: ['q1-2026', 'q2-2027'] }),
    ini('housekeeping', { kind: 'housekeeping', status_rule: { type: 'none' } })
  ];
  const quarters = [
    { quarter_key: 'q1-2026', label: 'Q1', start_date: '2026-10-01', end_date: '2026-12-31', theme: 'T1', milestone_key: 'dec26', initiative_keys: ['q1-gifts', 'q1-pnm', 'q1-near'], programme_key: 'prog-learning-relationships', housekeeping_key: 'housekeeping' },
    { quarter_key: 'q2-2027', label: 'Q2', start_date: '2027-01-01', end_date: '2027-03-31', theme: 'T2', milestone_key: 'mar27', initiative_keys: ['q2-spring'], programme_key: 'prog-learning-relationships', housekeeping_key: 'housekeeping' }
  ];
  const links = [
    { ref_type: 'action', ref_key: 'a-hk', initiative_key: 'housekeeping', role: 'primary' },
    { ref_type: 'action', ref_key: 'a-news', initiative_key: 'q1-pnm', role: 'primary', related_ref: 'send|theme|pnm' },
    { ref_type: 'campaign', ref_key: 'theme|pnm', initiative_key: 'q1-pnm', role: 'primary' },
    { ref_type: 'delivery', ref_key: 'send|theme|pnm', initiative_key: 'q1-pnm', role: 'primary', purpose_primary: 'sell', purpose_secondary: ['nurture'] }
  ];
  const campaignRows = [{ campaign_key: 'theme|pnm', kind: 'theme', title: 'Pick n Mix', stage: 'scheduled', reserved_sends: 127, actual_sends: null, sent_on: null, window_start: '2026-11-08', window_end: '2026-12-15', stage_history: [{ stage: 'scheduled', scheduled_for: '2026-11-10T10:00:00Z', recipients: 127 }] }];
  const step = (key, channel, title, featured = [], extra = {}) => ({ key, day: '2026-11-05', scheduled_day: '2026-11-05', channel, step: title, featured, covers: [], brief: '', state: { status: 'pending' }, ...extra });
  const macro = { name: 'Macro', when: 'Sat 28 Nov', date: '2026-11-28', title: 'Abstract and Macro Photography Workshop' };
  const vyrnwy = { name: 'Vyrnwy', when: '13–14 Mar', date: '2027-03-13', title: 'Lake Vyrnwy weekend' };
  const campaign = {
    weeks: [{
      week: '2026-11-02', steps: [
        step('step|e', 'Squarespace email', 'Main email of the week', [macro, vyrnwy], { is_email: true, brief: 'Lead · Light & Logic folded in (no separate send)' }),
        step('step|o', 'Outlook personal notes', 'Personal note', [macro]),
        step('step|tip', 'Facebook + Instagram', 'Post: one useful photography tip (no dated event to promote this week)'),
        step('plan|1', 'Quarter action', 'Pick n Mix launch newsletter'),
        step('step|gbp', 'Google Business', 'Google Business check (5–10 min)', [], { gbp: 'check' })
      ]
    }, { week: '2026-11-09', steps: [] }],
    campaigns: [
      { campaign_key: 'event|2026-11-28|/macro', kind: 'event', title: 'Macro', event: { date: '2026-11-28', kind: 'day' }, stage: 'proposed' },
      { campaign_key: 'event|2027-03-13|/vyrnwy', kind: 'event', title: 'Vyrnwy', event: { date: '2027-03-13', kind: 'residential' }, stage: 'proposed' },
      { campaign_key: 'theme|other', kind: 'theme', title: 'Unlinked theme', stage: 'proposed' }
    ]
  };
  const actions = [
    { id: 1, action_key: 'a-hk', quarter_key: 'q1-2026', label: 'Plans tab', due_week_start: '2026-10-12', is_ticked: true, sort_order: 1 },
    { id: 2, action_key: 'a-news', quarter_key: 'q1-2026', label: 'Pick n Mix launch newsletter', due_week_start: '2026-11-02', is_ticked: true, sort_order: 2 },
    { id: 3, action_key: 'a-q2', quarter_key: 'q2-2027', label: 'Not mapped yet', due_week_start: '2027-03-01', is_ticked: false, sort_order: 1 }
  ];
  const master = { revenue_equivalent: { survival_monthly: [4300, 3500, 2300, 4700, 5600, 6000, 4500, 3400, 5400, 6000, 6000, 5200] }, seasonal: { survival: [3300, 2700, 1800, 3600, 4300, 4600, 3500, 2600, 4200, 4600, 4000, 4200] } };
  const txns = [
    { txn_date: '2026-11-03', category_order: 2, amount: 500 },
    { txn_date: '2026-11-04', category_order: 8, amount: 100 },
    { txn_date: '2026-11-05', category_order: 9, amount: -60 },
    { txn_date: '2026-10-20', category_order: 2, amount: 1000 }
  ];
  return {
    today: TODAY, txns, gpRates: [{ year: 2026, category_order: 2, gp_rate: 0.5 }], master, diary: [], campaign, actions, insights: null,
    roadmap: [{ key: 'dec26', label: 'Dec 26', plans: 3, beginners_non_jlr: 8, returning_r12: 16000 }, { key: 'mar27', label: 'Mar 27', plans: 6, beginners_non_jlr: 17, returning_r12: 18000 }],
    roadmapNow: { beginners_non_jlr: 0, returning_r12: 11200 }, pnm: { since_relaunch: 0, relaunch: '2026-11-10' }, courseLastNights: [{ date: '2026-11-23', beginners: true }],
    initiatives, quarters, links, assets: [{ asset_key: 'email|pnm', kind: 'email', title: 'PnM email', used_in: ['send|theme|pnm'] }], campaignRows, ...over
  };
}

test('trace: initiative → campaign → delivery → asset, Pick n Mix scheduled not sent with its reservation', () => {
  const p = assemblePlan(fixture());
  const pnm = p.initiatives['q1-pnm'];
  assert.deepEqual(pnm.campaigns.map((c) => c.campaign_key), ['theme|pnm']);
  const d = pnm.deliveries.find((x) => x.key === 'send|theme|pnm');
  assert.equal(d.status, 'scheduled');
  assert.equal(d.sent, false);
  assert.equal(d.reserved_sends, 127);
  assert.equal(d.scheduled_for, '2026-11-10T10:00:00Z');
  assert.deepEqual(d.assets, ['email|pnm']);
  assert.deepEqual(pnm.assets.map((a) => a.asset_key), ['email|pnm']);
  assert.match(pnm.measure.lines[0].value, /scheduled .*127 sends reserved · not sent/);
  assert.equal(pnm.actions.find((a) => a.action_key === 'a-news').related_ref, 'send|theme|pnm');
  assert.equal(p.links['delivery|send|theme|pnm'].initiative_key, 'q1-pnm');
  assert.equal(p.links['campaign|theme|pnm'].title, 'q1-pnm');
});

test('each campaign and delivery has one primary initiative (rules by event date); unlinked ones are reported, not hidden', () => {
  const p = assemblePlan(fixture());
  const owners = Object.values(p.initiatives).flatMap((i) => i.campaigns.map((c) => c.campaign_key));
  assert.equal(new Set(owners).size, owners.length);
  assert.equal(p.links['campaign|event|2026-11-28|/macro'].initiative_key, 'q1-near');
  assert.equal(p.links['campaign|event|2027-03-13|/vyrnwy'].initiative_key, 'q2-spring');
  assert.deepEqual(p.unlinked.campaigns, ['theme|other']);
  assert.equal(p.links['delivery|step|tip'].initiative_key, 'prog-learning-relationships');
  assert.ok(!p.links['delivery|plan|1'] && !p.links['delivery|step|gbp'], 'quarter actions and checks are not deliveries');
});

test('an edit (stored link) moves the campaign once, with no duplicate rows', () => {
  const f = fixture();
  f.links.push({ ref_type: 'campaign', ref_key: 'event|2026-11-28|/macro', initiative_key: 'q2-spring', role: 'primary' });
  const p = assemblePlan(f);
  assert.equal(p.initiatives['q1-near'].campaigns.length, 0);
  assert.equal(p.initiatives['q2-spring'].campaigns.filter((c) => c.campaign_key === 'event|2026-11-28|/macro').length, 1);
  assert.equal(p.links['campaign|event|2026-11-28|/macro'].source, 'set');
});

test('purpose mix: deliveries counted once, modules separately; stored tag beats the channel rule', () => {
  const p = assemblePlan(fixture());
  const m = p.purpose_mix;
  assert.equal(m.deliveries, 4);
  assert.equal(Object.values(m.by_primary).reduce((a, b) => a + b, 0), 4);
  assert.deepEqual(m.by_primary, { sell: 3, educate: 1, inspire: 0, nurture: 0 });
  assert.equal(m.set_by_hand, 1);
  assert.equal(m.modules.total, 6);
  assert.equal(m.modules.by_purpose.educate, 2);
  assert.deepEqual(purposeRule({ channel: 'Facebook + Instagram', title: 'Post: Norfolk', featured: [{}], is_email: false, brief: '' }), { primary: 'inspire', secondary: ['sell'] });
});

test('purpose mix: GPT drafts counted on their own line from their stored tags; cancelled never counted', () => {
  const f = fixture();
  f.campaignRows.push(
    { campaign_key: 'theme|gpt-8w-2026-11-19', kind: 'theme', title: 'Draft', stage: 'drafted', planned_send_on: '2026-11-12', reserved_sends: 0 },
    { campaign_key: 'email|2026-11-09', kind: 'weekly_email', title: 'Cancelled weekly', stage: 'cancelled', scheduled_for: '2026-11-12T17:30:00Z' },
    { campaign_key: 'event|2026-11-20|/norfolk', kind: 'event', title: 'Cancelled Norfolk row', stage: 'cancelled', planned_send_on: '2026-11-08' }
  );
  f.links.push({ ref_type: 'campaign', ref_key: 'theme|gpt-8w-2026-11-19', initiative_key: 'q1-near', role: 'primary', purpose_primary: 'educate' });
  const p = assemblePlan(f);
  const m = p.purpose_mix;
  assert.deepEqual(m.by_primary, { sell: 3, educate: 1, inspire: 0, nurture: 0 }, 'scheduled / approved line unchanged');
  assert.deepEqual([m.draft.deliveries, m.draft.by_primary.educate, m.draft.set_by_hand], [1, 1, 1]);
  assert.ok(!p.links['delivery|send|event|2026-11-20|/norfolk'] && !p.links['delivery|send|email|2026-11-09'], 'cancelled records are not deliveries');
});

test('action mapping: old vs new counts per quarter, unmapped listed', () => {
  const p = assemblePlan(fixture());
  assert.deepEqual(p.action_mapping.by_quarter['q1-2026'], { old: 2, mapped: 2, under_initiatives: 1, housekeeping: 1, ticked: 2 });
  assert.deepEqual(p.action_mapping.unmapped, ['a-q2']);
});

test('gift: vouchers from issue receipts only (redemptions excluded), gift 1-to-1 unknown ≠ 0 → grey Needs review', () => {
  const p = assemblePlan(fixture());
  const g = p.initiatives['q1-gifts'];
  const [v, o] = g.measure.target_lines;
  assert.equal(v.actual, 100);
  assert.equal(v.gap, 1000);
  assert.equal(o.actual, null);
  assert.match(o.evidence_basis, /unknown, not £0/);
  assert.deepEqual([g.status.label, g.status.rag], ['Needs review', 'grey']);
});

test('status: RAG only against a disclosed dated benchmark; never red for an unticked task', () => {
  const pnm = { kind: 'initiative', status_label: 'In progress', status_rule: { type: 'milestone_pace', benchmark: 'straight-line' } };
  const before = initiativeStatus(pnm, { pace: { actual: 0, target: 3, start: '2026-11-10', end: '2026-12-31' } }, TODAY);
  assert.deepEqual([before.label, before.rag], ['In progress', 'grey']);
  const after = initiativeStatus(pnm, { pace: { actual: 0, target: 3, start: '2026-11-10', end: '2026-12-31' } }, '2026-12-01');
  assert.equal(after.rag, 'red');
  assert.equal(after.benchmark, 'straight-line');
  const notSet = initiativeStatus({ kind: 'initiative', status_rule: { type: 'not_set' } }, { lines: [] }, TODAY);
  assert.deepEqual([notSet.label, notSet.rag], ['Target not set', 'grey']);
  const p = assemblePlan(fixture({ actions: fixture().actions.map((a) => ({ ...a, is_ticked: false, due_week_start: '2026-10-01' })) }));
  assert.ok(Object.values(p.initiatives).every((i) => !i.status || i.status.rag !== 'red'));
  assert.equal(initiativeStatus({ kind: 'housekeeping', status_rule: { type: 'none' } }, {}, TODAY), null);
});

test('KPI boxes: sales still needed to quarter end net of month-to-date, GP beside it, labelled windows', () => {
  const f = fixture();
  const [sales, plans, beg, ret] = kpiBoxes(f.quarters[0], 'current', f);
  assert.equal(sales.raw, (6000 - 540) + 5200);
  assert.match(sales.sub, /to 31 Dec · Nov £5\.5k left \+ Dec £5\.2k/);
  assert.match(sales.window, /sales to 31 Dec 2026 · seasonal survival targets/);
  assert.equal(sales.gp.raw, (4000 - 250) + 4200);
  assert.match(sales.gp.line, /booked this quarter £750/);
  assert.equal(plans.value, '0 / 3');
  assert.match(plans.sub, /cumulative from relaunch 10 Nov · by 31 Dec/);
  assert.match(beg.sub, /cumulative from 1 Oct/);
  assert.match(beg.window, /from 1 Oct 2026/);
  assert.match(ret.label, /rolling 12 m/);
  const [s2, p2] = kpiBoxes(f.quarters[1], 'future', f);
  assert.equal(s2.label, 'Sales target Jan–Mar');
  assert.equal(s2.raw, 4300 + 3500 + 2300);
  assert.equal(p2.value, '6 by Mar 27');
  assert.equal(milestoneEnd('dec26'), '2026-12-31');
});

test('quarter display: current + next full, later compact; next shows selling started when an initiative starts now', () => {
  const p = assemblePlan(fixture());
  assert.deepEqual(p.quarters.map((q) => [q.key, q.state, q.display]), [['q1-2026', 'current', 'full'], ['q2-2027', 'future', 'full']]);
  assert.equal(p.quarters[1].selling_started, false);
  const f = fixture();
  f.initiatives.find((i) => i.initiative_key === 'q2-spring').start_date = '2026-11-08';
  assert.equal(assemblePlan(f).quarters[1].selling_started, true);
});

test('course last nights come from the live course dates (Week N of N)', () => {
  const feeds = { courses: [{ date: '2026-11-09', title: 'Beginners Photography Course - Week 1 of 3' }, { date: '2026-11-23', title: 'Beginners Photography Course - Week 3 of 3' }, { date: '2026-11-01', title: 'Beginners - Week 3 of 3' }] };
  assert.deepEqual(courseLastNights(feeds, TODAY), [{ date: '2026-11-23', title: 'Beginners Photography Course - Week 3 of 3', beginners: true }]);
});

test('API validation: owners, dates, purpose tags only on the primary link, changes recorded', () => {
  assert.throws(() => initiativePatch({ initiative_key: 'q1-pnm', owner: 'Bob' }), /owner must be/);
  assert.throws(() => initiativePatch({ initiative_key: 'q1-pnm', review_date: '17/11/2026' }), /YYYY-MM-DD/);
  assert.deepEqual(initiativePatch({ initiative_key: 'q1-pnm', owner: 'Alan', review_date: '2026-11-17' }).patch, { owner: 'Alan', review_date: '2026-11-17' });
  assert.throws(() => linkRow({ ref_type: 'delivery', ref_key: 'x', initiative_key: 'q1-pnm', role: 'supporting', purpose_primary: 'sell' }), /primary link only/);
  assert.throws(() => linkRow({ ref_type: 'delivery', ref_key: 'x', initiative_key: 'q1-pnm', purpose_primary: 'promote' }), /purpose_primary/);
  assert.deepEqual(linkRow({ ref_type: 'campaign', ref_key: 'theme|x', initiative_key: 'q1-pnm' }), { ref_type: 'campaign', ref_key: 'theme|x', initiative_key: 'q1-pnm', role: 'primary' });
  assert.deepEqual(linkRow({ ref_type: 'delivery', ref_key: 'd', initiative_key: 'q1-pnm', purpose_primary: 'educate' }).purpose_primary, 'educate');
  assert.deepEqual(changesOf({ owner: 'GPT', title: 'A' }, { owner: 'Alan', title: 'A' }), { owner: { from: 'GPT', to: 'Alan' } });
});

/**
 * Pick n Mix plans from the Booking Sheet "PnM Plans" tab (Claude / Alan, 8 Nov 2026) on FIXTURE rows only — never
 * Alan's workbook or booking_sheet_plans. Tab rows are read first, statement files are history; a row links by Email
 * (confirmed), else exact Client name (probable). Plan money goes through the existing same-sale checks.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import xlsx from 'xlsx';
import { mergePlanSources, planState, planStatusOf, planTypeKey, relaunchDate, sheetPlans, DEFAULT_PNM_RELAUNCH } from '../lib/marketing/plan-sources.mjs';
import { computeAll } from '../lib/marketing/rebuild.mjs';
import { rowCtx, evalNode } from '../lib/marketing/query/evaluate.mjs';
import { validateQuery } from '../lib/marketing/query/english.mjs';
import { overlays } from '../lib/marketing/client-health.mjs';
import { parsePlansTab, persistPlans } from '../lib/booking-sheet-plans-courses.mjs';
import { DEFAULT_KPI_TARGETS } from '../lib/targets-master.mjs';
import { targetsPatch } from '../api/aigeo/targets-master.js';

const TODAY = '2026-11-20';
const HEADINGS = ['Plan ID', 'Client', 'Email', 'Start Date', 'End Date', 'Plan Type', 'Plan Value £', 'Payment £', 'Discount %', 'Residential Discount %', 'Review Length (mins)', 'Academy Granted', 'Academy Until',
  'Review 1 Due', 'Review 1 Held', 'Review 2 Due', 'Review 2 Held', 'Review 3 Due', 'Review 3 Held', 'Review 4 Due', 'Review 4 Held', 'Status', 'Came From', 'Course Attended'];

const row = (id, client, email, start, end, extra = {}) => ({ id, plan_id: `PNM-${id}`, client_name: client, email, start_date: start, end_date: end, plan_type: 'Annual', plan_value: 600, payment: 600, status: 'Active', source_row: id + 1, ...extra });
const FIXTURE = [
  row(1, 'Client Active', 'active@example.com', '2026-11-12', '2027-11-11'),
  row(2, 'Client Future', 'future@example.com', '2026-12-05', '2027-12-04', { plan_type: 'Monthly', payment: 50 }),
  row(3, 'Client Ended', 'ended@example.com', '2025-11-12', '2026-11-11'),
  row(4, 'Client Noemail', null, '2026-11-14', '2027-11-13', { payment: 300 })
];
const profile = (id, email, first, last) => ({ profile_id: id, email, first_name: first, last_name: last });
const PROFILES = [profile('pa', 'active@example.com', 'Client', 'Active'), profile('pf', 'future@example.com', 'Client', 'Future'), profile('pe', 'ended@example.com', 'Client', 'Ended'), profile('pn', 'noemail@example.com', 'Client', 'Noemail')];
const src = (extra = {}) => ({ profiles: PROFILES, orders: [], lines: [], geo: [], suppression: [], sheetPlans: FIXTURE, ...extra });

const C = (field, op, value) => ({ type: 'cond', field, op, value: value ?? null });
const qctx = { today: TODAY, asOf: TODAY, engagementComplete: true, windows: { warm_days: 90, cooling_days: 180 } };
const run = (q, facts, anchor) => evalNode(validateQuery({ root: q }).root, rowCtx({ facts, anchor_key: anchor }, qctx)).r;
const HAS_PLAN = C('pnm_status', 'in', ['active', 'starting']);
const HASNT_PLAN = C('pnm_status', 'not_in', ['active', 'starting']);

test('fixture rows: active / future start / ended / cancelled status', () => {
  const { plans } = sheetPlans(FIXTURE);
  assert.deepEqual(plans.map((p) => planState(p, TODAY)), ['active', 'starting', 'ended', 'active']);
  assert.equal(planState({ starts: '2026-11-12', ends: '2027-11-11', status: 'Cancelled' }, TODAY), 'ended');
  assert.equal(planState({ starts: '2026-11-12', ends: '2027-11-11', status: 'Pending' }, TODAY), 'active');
  assert.equal(planState({ starts: null, status: 'Active' }, TODAY), 'active');
  assert.equal(planStatusOf([], TODAY), 'none');
  assert.equal(planStatusOf([{ starts: '2025-01-01', ends: '2025-12-31' }, { starts: '2026-12-01' }], TODAY), 'starting');
  assert.deepEqual(['Annual', '12 month', 'Quarterly', 'Monthly', ''].map(planTypeKey), ['annual', 'annual', 'quarterly', 'monthly', null]);
});

test('tab rows map to plans + one payment each (Payment £, else Plan Value £), source marked; empty tab = nothing', () => {
  const { plans, payments } = sheetPlans([...FIXTURE, { id: 9, plan_id: 'PNM-9', client_name: null, email: null }, row(10, 'Client Value', 'v@example.com', '2026-11-15', null, { payment: null, plan_value: 450 })]);
  assert.equal(plans.length, 5);
  assert.equal(plans[0].plan_key, 'bsp:PNM-1');
  assert.equal(plans[0].source, 'booking_sheet');
  assert.equal(plans[0].source_file, 'Booking Sheet · PnM Plans tab');
  assert.deepEqual(payments.map((p) => p.amount), [600, 50, 600, 300, 450]);
  assert.equal(payments[0].paid_on, '2026-11-12');
  assert.equal(payments[0].date_reliable, false);
  assert.deepEqual(sheetPlans([]), { plans: [], payments: [] });
});

test('tab first, statements as history: the same client + start in both is one plan (the tab row)', () => {
  const sheet = sheetPlans([row(1, 'Client Active', 'active@example.com', '2026-11-12', '2027-11-11')]);
  const history = { plans: [{ plan_key: 'old-1', email: 'active@example.com', starts: '2026-11-12' }, { plan_key: 'old-2', email: 'x@example.com', starts: '2019-01-01', ends: '2019-12-31' }], payments: [{ plan_key: 'old-1', amount: 600 }, { plan_key: 'old-2', amount: 40 }] };
  const m = mergePlanSources(sheet, history);
  assert.deepEqual(m.plans.map((p) => [p.plan_key, p.source]), [['bsp:PNM-1', 'booking_sheet'], ['old-2', 'statement']]);
  assert.deepEqual(m.payments.map((p) => p.plan_key), ['bsp:PNM-1', 'old-2']);
  assert.equal(m.duplicates, 1);
});

test('person link: Email = confirmed; no email = probable by exact Client name; status, filter and overlay follow', () => {
  const { st, facts } = computeAll(src(), TODAY);
  const link = (id) => st.links.find((l) => l.source === 'bs_plan' && l.source_id === `bsp:PNM-${id}`);
  assert.deepEqual([link(1).anchor, link(1).match_method, link(1).confirmed], ['sqs:pa', 'plan_sheet_email', true]);
  assert.deepEqual([link(4).anchor, link(4).match_method, link(4).confirmed, link(4).candidate_anchor], ['name:client noemail', 'plan_sheet_name_only', false, 'sqs:pn']);
  const f = (a) => facts.get(a);
  assert.deepEqual(f('sqs:pa').plans.map((p) => [p.plan_key, p.source, p.level]), [['bsp:PNM-1', 'booking_sheet', 'c']]);
  assert.deepEqual(f('sqs:pn').plans.map((p) => [p.plan_key, p.level]), [['bsp:PNM-4', 'p']]);
  assert.equal(f('name:client noemail').attached_to, 'sqs:pn');
  const has = (a) => run(HAS_PLAN, f(a), a);
  assert.deepEqual(['sqs:pa', 'sqs:pf', 'sqs:pe', 'sqs:pn'].map(has), ['yes', 'yes', 'no', 'yes']);
  assert.deepEqual(['sqs:pa', 'sqs:pf', 'sqs:pe', 'sqs:pn'].map((a) => run(HASNT_PLAN, f(a), a)), ['no', 'no', 'yes', 'no']);
  assert.deepEqual(['sqs:pa', 'sqs:pf', 'sqs:pe'].map((a) => run(C('pnm_status', 'in', ['ended']), f(a), a)), ['no', 'no', 'yes']);
  assert.equal(run(C('pnm_type', 'in', ['monthly']), f('sqs:pf'), 'sqs:pf'), 'yes');
  assert.deepEqual(['sqs:pa', 'sqs:pf', 'sqs:pe'].map((a) => overlays(f(a), TODAY).active_plan), [true, false, false]);
});

test('empty PnM Plans tab: 0 plans, nobody has a plan, no error', () => {
  const { st, facts } = computeAll(src({ sheetPlans: [] }), TODAY);
  assert.equal(st.plan.plans, 0);
  assert.equal([...facts.entries()].filter(([a, x]) => run(HAS_PLAN, x, a) === 'yes').length, 0);
});

const tx = (rowNo, date, amount, category, funding, client = 'Client Active') => ({ source_workbook: 'w', source_row: rowNo, txn_date: date, client_name: client, category_label: category, event_label: 'x', channel: null, is_redemption: false, amount, funding });
const pnmOrder = (n, email, date, gross) => ({ order_id: `o${n}`, order_number: n, customer_email: email, created_on: `${date}T10:00:00Z`, grand_total_gbp: gross, refunded_total_gbp: 0, fulfillment_status: 'FULFILLED', payment_state: 'PAID', testmode: false });

test('plan money counts once: a Pick n Mix Inc sheet row or Squarespace Pick n Mix order of the same money is the plan payment', () => {
  const one = row(1, 'Client Active', 'active@example.com', '2026-11-12', '2027-11-11');
  const sheetDup = computeAll(src({ sheetPlans: [one], transactions: [tx(1, '2026-11-13', 600, '4. Pick n Mix Inc', 'Stripe')] }), TODAY).facts.get('sqs:pa');
  assert.equal(sheetDup.value.c.net, 600);
  assert.equal(sheetDup.value.c.by_src.plan, 600);
  const sqsDup = computeAll(src({ sheetPlans: [one], orders: [pnmOrder(4001, 'active@example.com', '2026-11-12', 600)], lines: [{ order_id: 'o4001', line_index: 0, product_name: 'Pick n Mix Plan - Annual', line_type: 'SERVICE', quantity: 1 }] }), TODAY).facts.get('sqs:pa');
  assert.equal(sqsDup.value.c.net, 600);
  assert.equal(sqsDup.value.c.by_src.squarespace, 600);
  assert.equal(sqsDup.value.c.by_src.plan, 0);
});

test('Alan 8 Nov rulings kept: a Stripe 1-2-1 of the plan amount is separate; a Bank row inside the plan period is the plan payment', () => {
  const one = row(1, 'Client Active', 'active@example.com', '2026-11-12', '2027-11-11');
  const stripe = computeAll(src({ sheetPlans: [one], transactions: [tx(1, '2026-11-14', 600, '7. 1-2-1', 'Stripe')] }), TODAY).facts.get('sqs:pa');
  assert.equal(stripe.value.c.net, 1200);
  const bank = computeAll(src({ sheetPlans: [one], transactions: [tx(1, '2027-02-01', 600, '3. Workshops Residential', 'Bank')] }), TODAY).facts.get('sqs:pa');
  assert.equal(bank.value.c.net, 600);
});

/* ---------- Booking Sheet sync: the tab's exact headings, empty tab, missing tab ---------- */

const book = (name, rows) => {
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(rows), name);
  return wb;
};
const FIX_ROW = ['PNM-001', 'Client Active', 'Active@Example.com', '2026-11-12', '2027-11-11', 'Annual', 600, 540, 10, 5, 45, 'Yes', '2027-11-11', '2027-02-12', '', '2027-05-12', '', '2027-08-12', '', '2027-11-11', '', 'Active', 'Beginners course', 'Beginners Nov 2026'];

test('sync: "PnM Plans" tab with the exact headings maps every column; template rows with only a Plan ID are skipped', () => {
  const parsed = parsePlansTab(book('PnM Plans', [HEADINGS, FIX_ROW, ['PNM-002'], []]), { propertyUrl: 'https://www.alanranger.com', sourceFile: 'fixture.xlsx' });
  assert.equal(parsed.sheet, 'PnM Plans');
  assert.equal(parsed.rows.length, 1);
  const r = parsed.rows[0];
  assert.deepEqual([r.plan_id, r.client_name, r.email, r.start_date, r.end_date, r.plan_type, r.plan_value, r.payment, r.discount_pct, r.residential_discount_pct, r.review_length_mins, r.academy_granted, r.academy_until],
    ['PNM-001', 'Client Active', 'active@example.com', '2026-11-12', '2027-11-11', 'Annual', 600, 540, 10, 5, 45, true, '2027-11-11']);
  assert.deepEqual([r.review_1_due, r.review_2_due, r.review_3_due, r.review_4_due, r.review_1_held, r.status, r.came_from, r.course_attended], ['2027-02-12', '2027-05-12', '2027-08-12', '2027-11-11', null, 'Active', 'Beginners course', 'Beginners Nov 2026']);
});

test('sync: an empty tab (headings only) = 0 rows written, old rows cleared, no error; a missing tab writes nothing', async () => {
  const calls = [];
  const sb = { from: (t) => ({ delete: () => ({ eq: (k, v) => { calls.push(['delete', t, k, v]); return Promise.resolve({ error: null }); } }), insert: (rows) => { calls.push(['insert', t, rows.length]); return Promise.resolve({ error: null }); } }) };
  const empty = parsePlansTab(book('PnM Plans', [HEADINGS]), { propertyUrl: 'p' });
  assert.deepEqual([empty.sheet, empty.rows.length], ['PnM Plans', 0]);
  assert.deepEqual(await persistPlans(sb, 'p', empty), { written: 0, sheet: 'PnM Plans' });
  assert.deepEqual(calls, [['delete', 'booking_sheet_plans', 'property_url', 'p']]);
  const missing = parsePlansTab(book('Sales 2026', [['x']]), { propertyUrl: 'p' });
  assert.equal(missing.sheet, null);
  assert.deepEqual(await persistPlans(sb, 'p', missing), { written: 0, sheet: null });
  assert.equal(calls.length, 1);
});

test('sync: the older tab name "Plans" is still read; "PnM Plans" wins when both exist', () => {
  assert.equal(parsePlansTab(book('Plans', [HEADINGS, FIX_ROW]), { propertyUrl: 'p' }).rows.length, 1);
  const wb = book('Plans', [HEADINGS]);
  xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet([HEADINGS, FIX_ROW]), 'PnM Plans');
  assert.equal(parsePlansTab(wb, { propertyUrl: 'p' }).sheet, 'PnM Plans');
});

test('relaunch setting: Targets panel kpi_targets.pnm_relaunch_date, default 10 Nov 2026, validated on save', () => {
  assert.equal(DEFAULT_KPI_TARGETS.pnm_relaunch_date, DEFAULT_PNM_RELAUNCH);
  assert.equal(relaunchDate(undefined), '2026-11-10');
  assert.equal(relaunchDate({ pnm_relaunch_date: '2026-11-17' }), '2026-11-17');
  assert.equal(relaunchDate({ pnm_relaunch_date: 'soon' }), '2026-11-10');
  assert.equal(targetsPatch({ kpi_targets: { plans_active: 12, pnm_relaunch_date: '2026-11-17' } }).kpi_targets.pnm_relaunch_date, '2026-11-17');
  assert.equal('pnm_relaunch_date' in targetsPatch({ kpi_targets: { plans_active: 12, pnm_relaunch_date: '' } }).kpi_targets, false);
  assert.throws(() => targetsPatch({ kpi_targets: { pnm_relaunch_date: '10/11/2026' } }), /pnm_relaunch_date/);
});

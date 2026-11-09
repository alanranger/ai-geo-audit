/**
 * Prospects (QUESTION-2026-11-09 (p)): D2C / B2B market split, value basis ("est." shown; unknown counted, never
 * added), revalidate flag (no auto-loss by age), overdue / undated cash never added into the current month, and the
 * same-person Booking Sheet sale match (another client's sale refused; several possible sales → review, never the first).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { pickSale, pipelineBuckets, pipelineByMonth, probsOf, quarterFeedOf, rowFlags, saleReviewsOf, summarizeProspects } from '../lib/strategy-prospects.mjs';
import { buildSalesGap, monthsFrom, quarterPipeline } from '../lib/strategy-sales-gap.mjs';
import { enquiryPatch, stageRule, viaOf } from '../api/aigeo/prospects.js';

const TODAY = '2026-11-09';
const CONFIG = [{ stage: 'qualify', probability: 0.2 }, { stage: 'quote', probability: 0.4 }, { stage: 'scheduled', probability: 0.75 }, { stage: 'booked_paid', probability: 1 }];
const P = probsOf(CONFIG);
const enq = (id, stage, value, cash, extra = {}) => ({ id, client_or_org: `TEST ${id}`, type: '1-2-1', stage, value_gbp: value, cash_month: cash, owner: 'GPT', last_touch_at: '2026-11-08T10:00:00Z', ...extra });
const ROWS = [
  enq('d2c-dated', 'quote', 500, '2026-12-01', { customer_market: 'D2C', value_basis: 'quoted' }),
  enq('b2b-dated', 'quote', 2500, '2026-11-01', { customer_market: 'B2B', value_basis: 'agreed', type: 'commission' }),
  enq('b2b-overdue', 'quote', 1000, '2026-09-01', { customer_market: 'B2B', value_basis: 'quoted', type: 'commission', review_status: 'revalidate' }),
  enq('d2c-undated', 'qualify', 300, null, { customer_market: 'D2C', value_basis: 'estimated', review_status: 'revalidate', last_touch_at: '2026-01-09T10:00:00Z' }),
  enq('unknown', 'qualify', 999, null, { customer_market: 'B2B', value_basis: 'unknown' }),
  enq('legacy', 'qualify', 100, '2026-12-01')
];

test('dated / undated / overdue: overdue and undated are shown and never added into the current month (or any month)', () => {
  const m = pipelineByMonth(ROWS, P, '2026-11');
  assert.equal(m['2026-11'].total, 2500 * 0.4, 'Nov = the dated B2B quote only: the September overdue quote is not moved into Nov');
  assert.equal(m['2026-12'].total, 500 * 0.4 + 100 * 0.2);
  assert.deepEqual(Object.keys(m).sort(), ['2026-11', '2026-12'], 'no key for the overdue or undated enquiries');
  const b = pipelineBuckets(ROWS, P, '2026-11');
  assert.deepEqual([b.dated_gbp, b.overdue_gbp, b.overdue_count, b.undated_gbp, b.undated_count], [1000 + 200 + 20, 400 * 0.25, 1, 60 * 0.25, 2], 'undated = estimated £300 qualify (60, a revalidate lead × 0.25) + the unknown one (counted, £0); the overdue quote is revalidate too');
  const s = summarizeProspects({ rows: ROWS, config: CONFIG, history: [], today: TODAY, months: monthsFrom(TODAY, 3) });
  assert.equal(s.pipeline.total, 1220 + 100 + 15, 'total weighted = dated + undated + overdue');
  assert.equal(s.pipeline.undated_weighted, s.pipeline.undated_gbp, 'existing field name kept');
  assert.equal(s.pipeline.no_cash_month, 2);
  const g = buildSalesGap({ today: TODAY, txns: [], targets: Array(12).fill(5000), events: [], fill: { day: 0.5, residential: 0.5, course: 0.5, all: 0.5 }, lead: null, pipeline: s.by_month, pipeline_open: quarterFeedOf(s) });
  assert.equal(g.months[0].pipeline_weighted, 1000, 'Nov Remedy: dated Nov only (no overdue, no undated)');
  assert.ok(g.remedy.rows.every((r) => Math.abs(r.lever1.gbp + r.lever2.gbp + r.lever3.gbp - r.gap) < 0.01), 'levers still add up');
  const q = quarterPipeline(s.by_month, quarterFeedOf(s), ['2026-11', '2026-12', '2027-01']);
  assert.deepEqual([q.dated, q.undated, q.later, q.weighted], [1220, 15, 0, 1235], 'quarter tile: overdue is neither dated nor "later"');
  assert.equal(quarterFeedOf(s).overdue_gbp, 100, 'overdue passed on for its own line');
  assert.deepEqual(quarterFeedOf({ error: 'boom' }), { error: 'boom' });
});

test('D2C / B2B split; unknown value counted, never added (not a £0 sale); estimated share; revalidate count', () => {
  const b = pipelineBuckets(ROWS, P, '2026-11');
  assert.deepEqual(b.by_market.D2C, { count: 2, value: 800, weighted: 200 + 15 }, 'the revalidate £300 qualify counts at a quarter (60 × 0.25)');
  assert.deepEqual(b.by_market.B2B, { count: 3, value: 3500, weighted: 1000 + 100 }, 'the unknown B2B enquiry counts 1, adds £0 value; the revalidate quote at a quarter');
  assert.equal(b.by_market.unclassified.count, 1, 'a row with no market is unclassified');
  assert.equal(b.unknown_count, 1);
  assert.equal(b.estimated_gbp, 15);
  assert.equal(b.revalidate_count, 2);
  const s = summarizeProspects({ rows: ROWS, config: CONFIG, history: [], today: TODAY, months: monthsFrom(TODAY, 3) });
  assert.equal(s.tiles.find((t) => t.stage === 'qualify').unknown, 1);
  assert.equal(s.tiles.find((t) => t.stage === 'qualify').value, 400, 'qualify value = 300 + 100; the unknown 999 is not added');
  assert.equal(JSON.stringify(s).includes('TEST'), false, 'no names in the summary');
});

test('revalidate is a flag only: nothing is lost or closed by age', () => {
  const rows = JSON.parse(JSON.stringify(ROWS));
  const s = summarizeProspects({ rows, config: CONFIG, history: [], today: '2027-06-01', months: monthsFrom('2027-06-01', 3) });
  assert.deepEqual(rows, JSON.parse(JSON.stringify(ROWS)), 'rows untouched');
  assert.equal(s.closed_lost, 0);
  assert.equal(s.pipeline.open, ROWS.length, 'every enquiry still open months later');
  assert.deepEqual(rowFlags(ROWS[3], TODAY), { overdue_cash: false, undated: true, value_unknown: false, estimated: true, revalidate: true, review_factor: 0.25, dated_event: false, revenue_type: 'new_sale', line: 'pipeline', allocated: false });
  assert.equal(rowFlags(ROWS[2], TODAY).overdue_cash, true);
});

const SALES = [{ source_workbook: 'Sales 2026', source_row: 10, txn_date: '2026-11-05', amount: 300 }, { source_workbook: 'Sales 2026', source_row: 11, txn_date: '2026-11-05', amount: 300 }];
const ME = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const link = (row, person, confirmed = true) => ({ source_id: `Sales 2026:${row}`, person_id: person, confirmed });

test('matchSale: refuses a different person\'s sale; matches only the same person; several possible sales → review, never the first row', () => {
  assert.match(pickSale([SALES[0]], [link(10, OTHER)], ME).refused, /different client/, 'another client\'s confirmed sale is refused');
  assert.match(pickSale(SALES, [link(10, OTHER), link(11, OTHER)], ME).refused, /different client/);
  assert.deepEqual(pickSale(SALES, [link(10, OTHER), link(11, ME)], ME), { sale: SALES[1] }, 'the same person\'s sale, not the first row');
  const two = pickSale(SALES, [link(10, ME), link(11, ME)], ME);
  assert.equal(two.sale, undefined, 'two possible sales for the same person: left unmatched');
  assert.deepEqual(two.review, { candidates: 2, same_person: 2, reason: 'more than one possible Booking Sheet sale' });
  assert.equal(pickSale(SALES, [link(10, ME)], ME).review.candidates, 2, 'an unlinked same-date-and-amount sale keeps it ambiguous');
  assert.equal(pickSale([SALES[0]], [], ME).review.reason, 'sale not linked to this client yet');
  assert.equal(pickSale([SALES[0]], [link(10, ME, false)], ME).review.candidates, 1, 'an unconfirmed (name-only) link is a review, not a match');
  assert.match(pickSale([], [], ME).refused, /not found/);
  assert.equal(stageRule({ stage: 'quote' }, { stage: 'booked_paid' }, two.review), 'booked_paid', 'a review flag lets the stage move with no sale matched');
  const hist = [{ enquiry_id: 'x', at: '1', changes: { match_review: two.review } }];
  assert.deepEqual(Object.keys(saleReviewsOf(hist)), ['x']);
  assert.deepEqual(saleReviewsOf([...hist, { enquiry_id: 'x', at: '2', matched_sale: SALES[1] }]), {}, 'a later match clears the review');
  const s = summarizeProspects({ rows: [enq('x', 'booked_paid', 300, '2026-11-01')], config: CONFIG, history: hist, today: TODAY, months: monthsFrom(TODAY, 3) });
  assert.deepEqual([s.booked_unmatched, s.booked_review], [1, 1]);
});

test('API: new fields validated; a new enquiry with a value needs value_basis; via recorded', () => {
  assert.throws(() => enquiryPatch({ customer_market: 'B2C' }), /customer_market must be one of: D2C, B2B, unclassified/);
  assert.throws(() => enquiryPatch({ value_basis: 'guess' }), /value_basis must be one of/);
  assert.throws(() => enquiryPatch({ review_status: 'old' }), /review_status must be one of: recent, revalidate/);
  assert.deepEqual(enquiryPatch({ customer_market: 'D2C', value_basis: 'estimated', value_basis_note: ' JLR-funded leisure ', review_status: 'revalidate', source_ref: '1a16e2a2f4d316bb' }),
    { customer_market: 'D2C', value_basis: 'estimated', value_basis_note: 'JLR-funded leisure', review_status: 'revalidate', source_ref: '1a16e2a2f4d316bb' });
  const base = { client_or_org: 'TEST', type: '1-2-1', enquiry_date: '2026-11-01' };
  assert.throws(() => stageRule(null, { ...base, value_gbp: 150 }, null), /needs value_basis/);
  assert.equal(stageRule(null, { ...base, value_gbp: 0 }, null), 'qualify', 'no value → no basis needed');
  assert.equal(stageRule(null, { ...base, value_gbp: 150, value_basis: 'unknown' }, null), 'qualify');
  assert.deepEqual([viaOf({ via: 'claude' }), viaOf({ via: 'gpt' }), viaOf({})], ['claude', 'gpt', 'dashboard']);
});

test('UI: Market / Value basis / Review columns + filters; "est." on estimates; overdue + undated flags; Pipeline tile D2C / B2B, dated vs undated, overdue', () => {
  const ctx = { document: { addEventListener() {} }, console, Intl, Date, Math, Number, String, JSON, Promise, Object };
  ctx.window = ctx;
  vm.runInNewContext(fs.readFileSync(new URL('../lib/strategy-prospects.js', import.meta.url), 'utf8'), ctx);
  const ui = [enq('a', 'quote', 2500, '2099-01-01', { customer_market: 'B2B', value_basis: 'agreed' }), enq('b', 'quote', 1000, '2020-01-01', { customer_market: 'B2B', value_basis: 'quoted', review_status: 'revalidate' }),
    enq('c', 'qualify', 300, null, { customer_market: 'D2C', value_basis: 'estimated', review_status: 'revalidate' }), enq('d', 'qualify', 0, null, { customer_market: 'D2C', value_basis: 'unknown' })];
  Object.assign(ctx.stProspectsParts.state, { rows: ui, config: CONFIG, clients: {} });
  const s = { prospects: summarizeProspects({ rows: ui, config: CONFIG, history: [], today: TODAY, months: monthsFrom(TODAY, 3) }) };
  const html = ctx.stProspectsParts.sectionHtml(s);
  for (const h of ['Market', 'Value basis', 'Review']) assert.match(html, new RegExp(`data-pp-sort="[a-z_]+" style="cursor:pointer">${h}<`), `${h} column`);
  for (const f of ['market', 'stage', 'review']) assert.match(html, new RegExp(`data-pp-f="${f}"`), `${f} filter`);
  assert.match(html, /£300 <span class="pp-est">est\.<\/span>/, 'estimated value shows "est."');
  assert.match(html, /£15 <span class="pp-est">est\.<\/span> <span class="pp-tag" title="old leads count at a quarter">× 0\.25<\/span>/, 'estimated weighted shows "est."; a revalidate lead × 0.25');
  assert.match(html, /<span class="rt-sub">unknown<\/span>/, 'unknown value reads unknown, not £0');
  assert.match(html, /Overdue cash expectation · revise/);
  assert.match(html, /undated potential/);
  assert.match(html, /<span class="pp-chip pp-reval">revalidate<\/span>/);
  assert.match(html, /<b>D2C £15<\/b> · <b>B2B £1,100<\/b>/, 'market split on the Pipeline tile (revalidate leads at a quarter)');
  assert.match(html, /dated £1,000 · dated-event enquiries £0 · undated £15 \(2 without a cash month: not in any month\)/);
  assert.match(html, /1 overdue cash expectation £100/);
  assert.match(html, /1 value unknown \(not in totals\)/);
  assert.match(html, /2 to revalidate<\/span> \(old leads count at a quarter\)/);
  ctx.stProspectsParts.state.market = 'D2C';
  assert.deepEqual(ctx.stProspectsParts.visibleRows().map((r) => r.id), ['c', 'd'], 'market filter');
  Object.assign(ctx.stProspectsParts.state, { market: '', review: 'revalidate' });
  assert.deepEqual(ctx.stProspectsParts.visibleRows().map((r) => r.id).sort(), ['b', 'c'], 'review filter');
});

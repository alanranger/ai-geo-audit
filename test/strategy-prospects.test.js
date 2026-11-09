/**
 * Prospects pipeline (QUESTION-2026-11-09 (i)): weighted £ in the cash month; lever 3 "still to find" with the
 * per-type baseline floored at 0; booked / paid never counted twice; stalled → Needs Alan only when Alan owns it;
 * API validation (idempotent, booked_paid needs a Booking Sheet match, closed_lost needs a reason).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { pipelineByMonth, probsOf, stalledForAlan, summarizeProspects, conversionOf, weightedOf } from '../lib/strategy-prospects.mjs';
import { buildSalesGap, monthsFrom } from '../lib/strategy-sales-gap.mjs';
import { openDecisions } from '../lib/marketing/decision-state.mjs';
import { changesOf, enquiryPatch, stageRule } from '../api/aigeo/prospects.js';

const TODAY = '2026-11-09';
const CONFIG = [{ stage: 'qualify', probability: 0.2 }, { stage: 'quote', probability: 0.4 }, { stage: 'scheduled', probability: 0.75 }, { stage: 'booked_paid', probability: 1 }];
const P = probsOf(CONFIG);
const enq = (id, type, stage, value, cash, extra = {}) => ({ id, client_or_org: `TEST ${id}`, type, stage, value_gbp: value, cash_month: cash, owner: 'Alan', last_touch_at: '2026-11-08T10:00:00Z', created_at: '2026-11-01T10:00:00Z', ...extra });
const ROWS = [
  enq('a', 'corporate training', 'quote', 1200, '2026-12-01'),
  enq('b', 'mentoring', 'scheduled', 600, '2026-11-01'),
  enq('c', 'commission', 'quote', 850, '2026-12-01', { last_touch_at: '2026-10-22T10:00:00Z' }),
  enq('d', 'voucher / gift', 'qualify', 300, '2026-12-01', { owner: 'GPT', last_touch_at: '2026-10-01T10:00:00Z' }),
  enq('e', '1-2-1', 'booked_paid', 300, '2026-11-01'),
  enq('f', 'other', 'closed_lost', 500, '2026-11-01', { lost_reason: 'went elsewhere' }),
  enq('g', '1-2-1', 'quote', 200, '2026-10-01')
];

test('weighted £ = value × stage probability, in the cash month; booked / closed-lost leave the pipeline; a past cash month counts now', () => {
  assert.equal(weightedOf(ROWS[0], P), 480);
  assert.equal(weightedOf(ROWS[4], P), 0, 'booked / paid is out of the pipeline');
  assert.equal(weightedOf(ROWS[5], P), 0, 'closed-lost is out of the pipeline');
  const m = pipelineByMonth(ROWS, P, '2026-11');
  assert.deepEqual(Math.round(m['2026-11'].total), 450 + 80, 'Nov: mentoring scheduled 450 + the October 1-2-1 quote 80 (past cash month → now)');
  assert.deepEqual(Math.round(m['2026-12'].total), 480 + 340 + 60);
  assert.equal(m['2026-12'].cats[11], 480 + 340, 'corporate training + commission sell into Commissions (11)');
  assert.equal(m['2026-12'].cats[8], 60);
  const s = summarizeProspects({ rows: ROWS, config: CONFIG, history: [], today: TODAY, months: monthsFrom(TODAY, 3) });
  assert.deepEqual(s.pipeline.by_month.map((x) => [x.label, Math.round(x.weighted)]), [['Nov', 530], ['Dec', 880], ['Jan', 0]]);
  assert.equal(s.pipeline.stalled, 2, 'c (18 days) and d (39 days)');
  assert.equal(s.pipeline.stalled_alan, 1);
  assert.equal(s.tiles.find((t) => t.stage === 'booked_paid').count, 1);
  assert.equal(JSON.stringify(s).includes('TEST'), false, 'the summary carries no names');
});

const LEAD = { day: { n: 120, q25_days: 19, median_days: 45, q75_days: 139 }, residential: { n: 17, q25_days: 31, median_days: 76, q75_days: 104 }, course: { n: 25, q25_days: 23, median_days: 36, q75_days: 63 } };
const TXNS = [
  { txn_date: '2025-11-10', category_order: 7, amount: 240 }, { txn_date: '2025-11-12', category_order: 6, amount: 275 }, { txn_date: '2025-11-20', category_order: 10, amount: 300 },
  { txn_date: '2026-11-05', category_order: 7, amount: 300 } // the booked / paid 1-2-1 (enquiry e), in the Booking Sheet
];
const gap = (pipeline) => buildSalesGap({ today: TODAY, txns: TXNS, targets: Array(12).fill(5000), events: [], fill: { day: 0.56, residential: 0.56, course: 0.58, all: 0.56 }, lead: LEAD, pipeline });

test('lever 3: still to find = needed − normal (per type, less the pipeline of that type, floored at 0) − pipeline', () => {
  const base = gap(null).months[0];
  assert.equal(base.normal_non_dated, 815);
  assert.equal(base.still_to_find, Math.max(0, base.non_dated_needed - 815));
  const other = gap({ '2026-11': { total: 100, cats: {}, other: 100 } }).months[0];
  assert.equal(base.still_to_find - other.still_to_find, 100, '"other" has no baseline: still to find drops by exactly the weighted £');
  const one = gap({ '2026-11': { total: 400, cats: { 7: 400 }, other: 0 } }).months[0];
  assert.equal(one.normal_adjusted, 815 - 240, '1-2-1 baseline 240 − 400 pipeline → floored at 0');
  assert.equal(one.still_to_find, base.still_to_find - 400 + 240, 'covered = max(baseline, pipeline) for that type, never both');
  const r = gap({ '2026-11': { total: 400, cats: { 7: 400 }, other: 0 } }).remedy.rows[0];
  assert.equal(r.gap, one.still_to_find);
  assert.ok(Math.abs(r.lever1.gbp + r.lever2.gbp + r.lever3.gbp - r.gap) < 0.01, 'levers still add up to the gap');
});

test('booked / paid is never counted twice: out of the pipeline, its sale counted once in sold', () => {
  const s = summarizeProspects({ rows: ROWS, config: CONFIG, history: [], today: TODAY, months: monthsFrom(TODAY, 3) });
  const nov = gap(s.by_month).months[0];
  assert.equal(nov.sold, 300, 'the Booking Sheet sale only');
  assert.equal(Math.round(nov.pipeline_weighted), 530, 'the booked £300 is not in the pipeline');
});

test('stalled → Needs Alan only when Alan owns the next step (no names in the decision)', () => {
  const items = stalledForAlan(ROWS, TODAY);
  assert.deepEqual(items.map((x) => x.key), ['prospect|c']);
  assert.match(items[0].what, /^Chase stalled enquiry: commission · quote · £850$/);
  assert.match(items[0].why, /No touch in 18 days/);
  const open = openDecisions({ today: TODAY, planApproved: { decided_at: 'x' }, drafts: 0, release: [], outlook: [], blockedOpen: 0, actions: [], verified: [], prospects: items });
  assert.ok(open.some((o) => o.type === 'prospect_stalled'));
  assert.equal(stalledForAlan([{ ...ROWS[2], owner: 'GPT' }], TODAY).length, 0);
});

test('conversion per stage only once 20+ enquiries have closed', () => {
  assert.equal(conversionOf(ROWS, []).rates, null);
  const closed = Array.from({ length: 20 }, (_, i) => enq(`x${i}`, '1-2-1', i < 8 ? 'booked_paid' : 'closed_lost', 100, '2026-10-01', { lost_reason: 'x' }));
  const hist = closed.map((e) => ({ enquiry_id: e.id, from_stage: 'quote', to_stage: e.stage }));
  assert.equal(conversionOf(closed, hist).rates.quote, 40);
});

test('API: validated, idempotent by id, booked_paid needs a Booking Sheet match, closed_lost needs a reason', () => {
  assert.throws(() => enquiryPatch({ type: 'lunch' }), /type must be one of/);
  assert.throws(() => enquiryPatch({ value_gbp: -5 }), /value_gbp/);
  assert.equal(enquiryPatch({ cash_month: '2026-12' }).cash_month, '2026-12-01');
  assert.throws(() => stageRule(null, { type: '1-2-1' }, null), /client_or_org and type/);
  assert.throws(() => stageRule({ stage: 'quote' }, { stage: 'booked_paid' }, null), /matched_sale/);
  assert.equal(stageRule({ stage: 'quote' }, { stage: 'booked_paid' }, { txn_date: '2026-11-05', amount: 300 }), 'booked_paid');
  assert.throws(() => stageRule({ stage: 'quote' }, { stage: 'closed_lost' }, null), /lost_reason/);
  const prev = { stage: 'quote', value_gbp: '850.00', cash_month: '2026-12-01', type: 'commission' };
  assert.deepEqual(changesOf(prev, enquiryPatch({ stage: 'quote', value_gbp: 850, cash_month: '2026-12', type: 'commission' })), {}, 'same payload → no change, no history');
  assert.deepEqual(changesOf(prev, { stage: 'scheduled' }), { stage: { from: 'quote', to: 'scheduled' } });
});

test('UI: four stage tiles + Pipeline, weighted; rows come from the admin API, not the summary', () => {
  const ctx = { document: { addEventListener() {} }, console, Intl, Date, Math, Number, String, JSON, Promise, Object };
  ctx.window = ctx;
  vm.runInNewContext(fs.readFileSync(new URL('../lib/strategy-prospects.js', import.meta.url), 'utf8'), ctx);
  const s = { prospects: summarizeProspects({ rows: ROWS, config: CONFIG, history: [], today: TODAY, months: monthsFrom(TODAY, 3) }) };
  const html = ctx.stProspectsParts.sectionHtml(s);
  assert.equal((html.match(/class="pp-tile /g) || []).length, 5);
  assert.match(html, /Pipeline, weighted[\s\S]*Nov £530 · Dec £880 · Jan £0[\s\S]*2 stalled/);
  assert.match(html, /\+ Add enquiry/);
  assert.match(html, /Real conversion appears once 20 enquiries have closed/);
  assert.doesNotMatch(html, /TEST a/, 'no names from the summary');
});

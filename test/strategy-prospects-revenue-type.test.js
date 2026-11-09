/**
 * Prospects revenue type (QUESTION-2026-11-09 (r)): one row = one line, never two. new_sale → Pipeline, weighted;
 * committed_work → Committed work (full value, its cash month, "committed" in Remedy, never paid automatically);
 * receivable → Cash to collect (never pipeline / new sales / Remedy; paid only on Booking Sheet / provider evidence);
 * partner_development → Partner relationships (counted, never in £ totals, no stalled alarm).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { pipelineByMonth, probsOf, rowFlags, stalledForAlan, summarizeProspects } from '../lib/strategy-prospects.mjs';
import { buildSalesGap, monthsFrom } from '../lib/strategy-sales-gap.mjs';
import { enquiryPatch, proofOf, providerEvidence, stageRule } from '../api/aigeo/prospects.js';

const TODAY = '2026-11-09';
const CONFIG = [{ stage: 'qualify', probability: 0.2 }, { stage: 'quote', probability: 0.4 }, { stage: 'scheduled', probability: 0.75 }, { stage: 'booked_paid', probability: 1 }];
const P = probsOf(CONFIG);
const MONTHS = monthsFrom(TODAY, 3);
const row = (id, revenue_type, stage, value, cash, extra = {}) => ({ id, client_or_org: `TEST ${id}`, type: 'other', customer_market: 'B2B', revenue_type, stage, value_gbp: value, value_basis: 'agreed', cash_month: cash, owner: 'Alan', last_touch_at: '2026-01-01T10:00:00Z', ...extra });
const ROWS = [
  row('new', 'new_sale', 'quote', 500, '2026-12-01', { type: '1-2-1', customer_market: 'D2C', last_touch_at: '2026-11-08T10:00:00Z' }),
  row('committed', 'committed_work', 'allocated', 125, '2026-12-01', { delivery_due: '2026-12-03', invoice_by: '2026-12-11' }),
  row('receivable', 'receivable', 'scheduled', 250, '2026-11-01'),
  row('partner', 'partner_development', 'qualify', 0, null, { value_basis: 'unknown' }),
  row('partner-valued', 'partner_development', 'quote', 400, '2026-12-01')
];
const s = summarizeProspects({ rows: ROWS, config: CONFIG, history: [], today: TODAY, months: MONTHS });

test('each type lands in its own line and only there', () => {
  assert.equal(s.pipeline.total, 500 * 0.4, 'Pipeline, weighted = the new sale only');
  assert.equal(s.pipeline.open, 1);
  assert.deepEqual(s.tiles.map((t) => t.count), [0, 1, 0, 0], 'stage tiles: the new sale only (the valued partner at "quote" is not a quote tile)');
  assert.deepEqual([s.committed.total_gbp, s.committed.count], [125, 1], 'Committed work: full value, not weighted');
  assert.deepEqual(s.committed.by_month.map((m) => [m.label, m.gbp]), [['Nov', 0], ['Dec', 125], ['Jan', 0]], 'committed in its cash month');
  assert.deepEqual([s.cash_to_collect.total_gbp, s.cash_to_collect.count], [250, 1], 'Cash to collect');
  assert.deepEqual(s.partners, { count: 2, unvalued_count: 1, noted_gbp: 400 }, 'partners counted; a noted value is never in a total');
  assert.deepEqual(s.revenue_types, { new_sale: 1, partner_development: 2, committed_work: 1, receivable: 1 });
  assert.deepEqual(ROWS.map((e) => rowFlags(e, TODAY).line), ['pipeline', 'committed', 'cash_to_collect', 'partners', 'partners']);
  assert.equal(rowFlags(ROWS[1], TODAY).allocated, true);
});

test('excluded from the wrong totals; nothing counted twice between prospect and receivable', () => {
  const m = pipelineByMonth(ROWS, P, '2026-11');
  assert.equal(m['2026-11'], undefined, 'the November receivable is in no month (not new sales, not Remedy)');
  assert.deepEqual([m['2026-12'].total, m['2026-12'].committed], [200, 125], 'Dec: weighted new sale + committed work, kept apart; no partner £');
  assert.equal(s.pipeline.by_market.B2B.weighted, 0, 'B2B receivable / committed / partners are not in the pipeline by market');
  const lines = s.pipeline.total + s.committed.total_gbp + s.cash_to_collect.total_gbp;
  assert.equal(lines, 200 + 125 + 250, 'the three £ lines add up with no overlap');
  const invoiced = summarizeProspects({ rows: ROWS.map((e) => (e.id === 'new' ? { ...e, revenue_type: 'receivable' } : e)), config: CONFIG, history: [], today: TODAY, months: MONTHS });
  assert.deepEqual([invoiced.pipeline.total, invoiced.cash_to_collect.total_gbp], [0, 750], 'a prospect turned receivable leaves the pipeline: counted once, in Cash to collect');
  const paid = summarizeProspects({ rows: ROWS.map((e) => (e.id === 'receivable' ? { ...e, stage: 'booked_paid' } : e)), config: CONFIG, history: [], today: TODAY, months: MONTHS });
  assert.deepEqual([paid.cash_to_collect.total_gbp, paid.tiles[3].count], [0, 0], 'a paid receivable leaves Cash to collect and never becomes a new-sales booking');
});

test('partner relationships: no stalled alarm by age; committed work / receivables never stalled as sales', () => {
  assert.equal(s.pipeline.stalled, 0, 'the partner and committed rows were last touched in January');
  assert.deepEqual(stalledForAlan(ROWS, TODAY), []);
  assert.equal(stalledForAlan([{ ...ROWS[3], revenue_type: 'new_sale' }], TODAY).length, 1, 'the same row as a new sale would be stalled');
});

test('Remedy: committed work counts in its cash month, labelled committed; receivables never count', () => {
  const g = buildSalesGap({ today: TODAY, txns: [], targets: Array(12).fill(5000), events: [], fill: { day: 0.5, residential: 0.5, course: 0.5, all: 0.5 }, lead: null, pipeline: s.by_month, pipeline_open: s.pipeline });
  const [nov, dec] = g.months;
  assert.deepEqual([nov.pipeline_weighted, nov.committed_gbp], [0, 0], 'Nov: the £250 receivable is not new sales');
  assert.deepEqual([dec.pipeline_weighted, dec.committed_gbp], [200, 125]);
  assert.equal(dec.still_to_find, Math.max(0, dec.non_dated_needed - dec.normal_adjusted - 200 - 125));
  assert.deepEqual(g.remedy.rows.map((r) => r.committed_gbp), [0, 125, 0], 'Remedy rows carry the committed £');
  assert.ok(g.remedy.rows.every((r) => Math.abs(r.lever1.gbp + r.lever2.gbp + r.lever3.gbp - r.gap) < 0.01), 'levers still add up');
  const commission = summarizeProspects({ rows: [row('c', 'committed_work', 'allocated', 300, '2026-12-01', { type: 'commission' })], config: CONFIG, history: [], today: TODAY, months: MONTHS });
  assert.deepEqual(commission.by_month['2026-12'].committed_cats, { 11: 300 }, 'committed commission reduces the Commissions baseline (no double count)');
});

test('API: revenue_type, delivery_due / invoice_by; allocated only for committed work; paid only on evidence', () => {
  assert.deepEqual(enquiryPatch({ revenue_type: 'committed_work', delivery_due: '2026-12-03', invoice_by: '2026-12-11' }), { revenue_type: 'committed_work', delivery_due: '2026-12-03', invoice_by: '2026-12-11' });
  assert.throws(() => enquiryPatch({ revenue_type: 'royalty' }), /revenue_type must be one of: new_sale, partner_development, committed_work, receivable/);
  const base = { client_or_org: 'TEST', type: 'other', enquiry_date: '2026-11-01' };
  assert.equal(stageRule(null, { ...base, revenue_type: 'committed_work' }, null), 'allocated', 'committed work starts Allocated · delivery pending');
  assert.equal(stageRule(null, { ...base, revenue_type: 'receivable' }, null), 'scheduled');
  assert.equal(stageRule(null, base, null), 'qualify');
  assert.throws(() => stageRule(null, { ...base, stage: 'allocated' }, null), /committed_work only/);
  assert.throws(() => stageRule({ stage: 'scheduled', revenue_type: 'receivable' }, { stage: 'booked_paid' }, null), /booked_paid needs matched_sale/, 'never paid without evidence');
  assert.deepEqual(providerEvidence({ provider: 'paypal', ref: 'TESTREF123' }, 'receivable'), { evidence: 'provider', provider: 'paypal', ref: 'TESTREF123' });
  assert.throws(() => providerEvidence({ provider: 'paypal', ref: 'TESTREF123' }, 'new_sale'), /receivables only/);
  assert.throws(() => providerEvidence({ provider: 'buyer email', ref: '' }, 'receivable'), /provider transaction id/, 'the buyer\'s word is not evidence');
  const review = { review: { candidates: 2 } };
  assert.equal(proofOf(review, 'receivable'), null, 'a receivable needs a real match, not a review flag');
  assert.equal(proofOf(review, 'committed_work'), null);
  assert.deepEqual(proofOf(review, 'new_sale'), { candidates: 2 });
});

test('UI: Revenue type column + filter; Pipeline tile lines; committed / to collect / not in totals cells', () => {
  const ctx = { document: { addEventListener() {} }, console, Intl, Date, Math, Number, String, JSON, Promise, Object };
  ctx.window = ctx;
  vm.runInNewContext(fs.readFileSync(new URL('../lib/strategy-prospects.js', import.meta.url), 'utf8'), ctx);
  Object.assign(ctx.stProspectsParts.state, { rows: ROWS.map((e) => ({ ...e, cash_month: e.cash_month && e.id !== 'receivable' ? '2099-12-01' : e.cash_month })), config: CONFIG, clients: {} });
  const html = ctx.stProspectsParts.sectionHtml({ prospects: s });
  assert.match(html, /<span class="pp-chip pp-r-committed_work">Committed work<\/span>/, 'revenue type chip under the stage when not a new sale');
  assert.match(html, /<select data-pp-f="rtype" aria-label="All revenue types"><option value="" selected>All revenue types<\/option>/);
  assert.match(html, /<b>Pipeline, weighted<\/b><span class="rt-sub">new sales, open stages<\/span><\/div><div class="pp-n">£200</);
  assert.match(html, /<b>Committed work £125<\/b> <span class="rt-sub">\(1 in progress: allocated → delivered → invoiced: Dec £125; full value, not weighted\)/);
  assert.match(html, /<b>Cash to collect £250<\/b> <span class="rt-sub">\(1 invoiced, payment unverified/);
  assert.match(html, /<b>Partner relationships 2<\/b> <span class="rt-sub">\(unvalued: 1 of 2; never in £ totals, no age alarm\)/);
  assert.match(html, /Allocated · delivery pending<\/span><\/div><div class="rt-sub pp-c2"><span class="pp-chip pp-r-committed_work">Committed work<\/span> delivery 3 Dec · invoice by 11 Dec<\/div>/);
  assert.match(html, /Invoiced · payment unverified/);
  assert.match(html, /£125 <span class="pp-tag">committed<\/span>/);
  assert.match(html, /£250 <span class="pp-tag">to collect<\/span>/);
  assert.match(html, /<span class="rt-sub">not in totals<\/span>/);
  ctx.stProspectsParts.state.f.rtype = 'receivable';
  assert.deepEqual(ctx.stProspectsParts.visibleRows().map((r) => r.id), ['receivable']);
});

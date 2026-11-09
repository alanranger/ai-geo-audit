/**
 * Prospects (QUESTION-2026-11-09 (z / y / aa / bb)): priority score + bands (set 9 Nov, review later); committed work
 * allocated → delivered → invoiced; Closed needs a reason code (Other also a note); Parked needs a revisit date, weighs
 * £0, is in no line, never stalls and shows again on its date; refused changes map to a form field with a plain reason;
 * the table hides closed / parked by default and sorts by priority; the drawer shows only the relevant sections.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { PRIORITY, endedLine, isLive, parkedDue, pipelineByMonth, prioritiesOf, priorityScore, probsOf, recencyOf, stalledForAlan, summarizeProspects, weightedOf } from '../lib/strategy-prospects.mjs';
import { monthsFrom } from '../lib/strategy-sales-gap.mjs';
import { enquiryPatch, explainError, refOf, stageRule } from '../api/aigeo/prospects.js';

const TODAY = '2026-11-09';
const CONFIG = [{ stage: 'qualify', probability: 0.2 }, { stage: 'quote', probability: 0.4 }, { stage: 'scheduled', probability: 0.75 }, { stage: 'booked_paid', probability: 1 }];
const P = probsOf(CONFIG);
const touched = (days) => new Date(Date.parse(`${TODAY}T12:00:00Z`) - days * 864e5).toISOString();
const enq = (id, stage, value, extra = {}) => ({ id, client_or_org: `TEST ${id}`, type: '1-2-1', revenue_type: 'new_sale', stage, value_gbp: value, value_basis: 'agreed', owner: 'GPT', last_touch_at: touched(6), ...extra });

test('priority: weighted × recency × quote / due boosts; tooltip; new sales at open stages only', () => {
  assert.deepEqual([14, 15, 45, 46, 120, 121].map(recencyOf), [1, 0.7, 0.7, 0.4, 0.4, 0.2], 'recency bands at 14 / 45 / 120 days');
  const top = priorityScore(enq('a', 'quote', 2500), P, TODAY);
  assert.equal(top.score, 2500 * 0.4 * 1 * 1.25);
  assert.equal(top.tip, '£1,000 weighted × 1.0 recent × 1.25 quote = £1,250', 'the score is explained in the tooltip');
  const due = priorityScore(enq('b', 'qualify', 500, { next_action_date: '2026-11-12', last_touch_at: touched(30) }), P, TODAY);
  assert.equal(due.score, 500 * 0.2 * 0.7 * 1.25, 'next action within 7 days +25%');
  assert.equal(priorityScore(enq('c', 'qualify', 500, { next_action_date: '2026-11-01' }), P, TODAY).score, 100 * 1.25, 'overdue next action +25%');
  assert.equal(priorityScore(enq('d', 'qualify', 300, { review_status: 'revalidate', last_touch_at: touched(300) }), P, TODAY).score, 300 * 0.2 * 0.25 * 0.2, 'revalidate × 0.25, old touch × 0.2');
  assert.equal(priorityScore(enq('e', 'qualify', 900, { value_basis: 'unknown' }), P, TODAY).score, 0, 'unknown value counts £0');
  for (const t of ['committed_work', 'receivable', 'partner_development']) assert.equal(priorityScore(enq('x', 'quote', 900, { revenue_type: t }), P, TODAY), null, `${t}: no priority`);
  for (const s of ['parked', 'closed_lost', 'booked_paid']) assert.equal(priorityScore(enq('x', s, 900), P, TODAY), null, `${s}: no priority`);
});

test('bands: High ≥ £300 or top third with ≥ £50 · Low < £25 · Medium the rest (ENQ-0001-like High at the top, old revalidate Low)', () => {
  const rows = [
    enq('enq1', 'quote', 2500), enq('q138', 'quote', 275, { last_touch_at: touched(12) }), enq('q83', 'quote', 1650, { review_status: 'revalidate', last_touch_at: touched(64) }),
    enq('q53', 'quote', 150, { last_touch_at: touched(22) }), enq('m28', 'qualify', 200, { last_touch_at: touched(29) }), enq('l15', 'qualify', 75, { last_touch_at: touched(0) }),
    ...Array.from({ length: 6 }, (_, i) => enq(`jan${i}`, 'qualify', 300, { review_status: 'revalidate', last_touch_at: touched(300) }))
  ];
  const pr = prioritiesOf(rows, P, TODAY);
  assert.deepEqual(Object.values(pr).sort((a, b) => a.rank - b.rank)[0], { ...pr.enq1 }, 'ENQ-0001-like row ranks first');
  assert.equal(pr.enq1.band, 'High');
  assert.deepEqual(['q138', 'q83', 'q53'].map((id) => pr[id].band), ['High', 'High', 'High'], 'top third with score ≥ £50');
  assert.equal(pr.m28.band, 'Medium', '£28: not top third, not under £25');
  assert.equal(pr.l15.band, 'Low', '£15 < £25');
  assert.ok(rows.filter((e) => e.id.startsWith('jan')).every((e) => pr[e.id].band === 'Low'), 'January revalidate rows Low');
  assert.equal(PRIORITY.high_min_gbp, 300);
  const s = summarizeProspects({ rows, config: CONFIG, history: [], today: TODAY, months: monthsFrom(TODAY, 3) });
  assert.ok(s.priority_rules.every((a) => a.status === 'set 9 Nov, review later'), 'thresholds listed in Rules, set 9 Nov, review later');
});

test('Parked: needs a revisit date, weighs £0, in no line, never stalls, shows again on its date; Closed needs a reason', () => {
  const parked = enq('p', 'parked', 600, { revisit_on: '2026-11-09', last_touch_at: touched(90), cash_month: '2026-12-01' });
  const later = { ...parked, id: 'p2', revisit_on: '2027-01-15' };
  const closed = enq('c', 'closed_lost', 400, { lost_reason: 'went_elsewhere' });
  const committedParked = enq('cw', 'parked', 125, { revenue_type: 'committed_work', revisit_on: '2027-02-01', cash_month: '2026-12-01' });
  const rows = [parked, later, closed, committedParked, enq('open', 'quote', 1000, { cash_month: '2026-12-01' })];
  assert.equal(isLive(parked), false);
  assert.equal(weightedOf(parked, P), 0);
  const m = pipelineByMonth(rows, P, '2026-11');
  assert.deepEqual([m['2026-12'].total, m['2026-12'].committed], [400, 0], 'only the open quote: parked / closed / parked committed work are in no month');
  const s = summarizeProspects({ rows, config: CONFIG, history: [], today: TODAY, months: monthsFrom(TODAY, 3) });
  assert.deepEqual([s.pipeline.total, s.committed.total_gbp, s.pipeline.stalled], [400, 0, 0], 'out of every total; no stalled alarm');
  assert.deepEqual(s.ended, { closed: { count: 1, value: 400 }, parked: { count: 3, value: 1325, due: 1 } });
  assert.deepEqual(endedLine(rows, TODAY).parked.due, 1);
  assert.equal(parkedDue(parked, TODAY), true, 'due on its revisit date');
  assert.equal(parkedDue(later, TODAY), false);
  assert.deepEqual(stalledForAlan(rows.map((e) => ({ ...e, owner: 'Alan' })), TODAY), [], 'never stalled');
  assert.equal(s.conversion.closed, 1, 'parked is not a closed outcome for conversion');
});

test('API rules: committed stages, closed reason codes (Other needs a note), parked date; refused change → field + reason', () => {
  const prev = { stage: 'quote', revenue_type: 'new_sale' };
  assert.throws(() => stageRule(prev, { stage: 'closed_lost' }, null), /closed_lost needs lost_reason/);
  assert.throws(() => enquiryPatch({ lost_reason: 'they went elsewhere' }), /lost_reason must be one of: not_interested, no_response, went_elsewhere, too_expensive, not_a_fit, duplicate, other/);
  assert.equal(stageRule(prev, enquiryPatch({ stage: 'closed_lost', lost_reason: 'went_elsewhere' }), null), 'closed_lost');
  assert.throws(() => stageRule(prev, { stage: 'closed_lost', lost_reason: 'other' }, null), /other needs status_note/);
  assert.equal(stageRule(prev, { stage: 'closed_lost', lost_reason: 'other', status_note: 'TEST note' }, null), 'closed_lost');
  assert.throws(() => stageRule(prev, { stage: 'parked' }, null), /parked needs revisit_on/);
  assert.equal(stageRule(prev, enquiryPatch({ stage: 'parked', revisit_on: '2027-01-15' }), null), 'parked');
  assert.equal(stageRule({ stage: 'parked', revisit_on: '2027-01-15' }, { next_action: 'x' }, null), 'parked', 'the date already on the row counts');
  assert.throws(() => enquiryPatch({ revisit_on: '15/01/2027' }), /revisit_on must be YYYY-MM-DD/);
  const cw = { stage: 'allocated', revenue_type: 'committed_work' };
  assert.equal(stageRule(cw, { stage: 'delivered' }, null), 'delivered');
  assert.equal(stageRule(cw, { stage: 'invoiced' }, null), 'invoiced');
  assert.equal(stageRule(cw, { stage: 'scheduled' }, null), 'scheduled', 'ENQ-0023 → Scheduled is still allowed');
  assert.throws(() => stageRule(prev, { stage: 'delivered' }, null), /stage delivered is for revenue_type committed_work only/);
  assert.throws(() => stageRule(cw, { stage: 'booked_paid' }, null), /booked_paid needs matched_sale/, 'Paid only on a same-client Booking Sheet match');
  assert.deepEqual(explainError('booked_paid needs matched_sale { txn_date, amount } from the Booking Sheet'), { field: 'stage', reason: 'Booked / paid needs a matching Booking Sheet sale for this client: enter the sale date and £ under Booked / paid.' });
  assert.deepEqual(explainError('closed_lost needs lost_reason (a reason code)'), { field: 'lost_reason', reason: 'Closing needs a reason.' });
  assert.deepEqual(explainError('parked needs revisit_on (YYYY-MM-DD)'), { field: 'revisit_on', reason: 'Parking needs a "Revisit on" date.' });
  assert.equal(explainError('next_action_date must be YYYY-MM-DD').field, 'next_action_date');
  assert.equal(refOf('ENQ-0023'), 'ENQ-0023');
  assert.throws(() => refOf('ENQ 23; drop'), /enquiry_ref must look like ENQ-0001/);
});

function ui(rows) {
  const ctx = { document: { addEventListener() {} }, console, Intl, Date, Math, Number, String, JSON, Promise, Object, Set };
  ctx.window = ctx;
  vm.runInNewContext(fs.readFileSync(new URL('../lib/strategy-prospects.js', import.meta.url), 'utf8'), ctx);
  Object.assign(ctx.stProspectsParts.state, { rows, config: CONFIG, clients: {} });
  return ctx.stProspectsParts;
}
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });

test('UI table: priority first + default sort; closed / parked hidden by default, a due parked row shown with GPT\'s revisit action', () => {
  const rows = [
    enq('low', 'qualify', 75, { priority: { band: 'Low', score: 15, tip: 't' } }), enq('high', 'quote', 2500, { priority: { band: 'High', score: 1250, tip: '£1,000 weighted × 1.0 recent × 1.25 quote = £1,250' } }),
    enq('med', 'qualify', 200, { priority: { band: 'Medium', score: 28, tip: 't' } }), enq('cl', 'closed_lost', 400, { lost_reason: 'too_expensive' }),
    enq('pk', 'parked', 300, { revisit_on: '2099-01-01', status_note: 'on hold' }), enq('due', 'parked', 300, { revisit_on: today, status_note: 'RPS mentoring later this year' })
  ];
  const parts = ui(rows);
  assert.deepEqual(parts.visibleRows().map((r) => r.id), ['high', 'med', 'low', 'due'], 'High first; closed and future-parked hidden; the due parked row shown');
  const html = parts.tableHtml();
  assert.match(html, /<span class="rt-pill pp-pri pp-pri-high" title="£1,000 weighted × 1\.0 recent × 1\.25 quote = £1,250">High<\/span>/);
  assert.match(html, /<span class="pp-amber">revisit:<\/span> RPS mentoring later this year<\/div><span class="pp-due late">GPT · /);
  assert.match(html, /Closed 1 \(£400\) · Parked 2 \(£600; 1 due to revisit, shown in the table\) · not in any total · hidden: "Show closed \/ parked"/);
  assert.match(html, /<tfoot><tr><td><\/td><td>4 enquiries<\/td>/, 'totals row for the filtered rows');
  parts.state.ended = true;
  assert.equal(parts.visibleRows().length, 6, 'toggle shows closed / parked');
  assert.match(parts.tableHtml(), /Closed<\/span><\/div><div class="rt-sub pp-c2">Too expensive/);
  assert.doesNotMatch(parts.tableHtml(), /class="pp-row pp-hot[^"]*" data-pp-row="pk"/, 'no amber bar for parked');
});

test('UI filters + drawer: "All …" labels, removable chips; drawer sections per revenue type / stage', () => {
  const committed = enq('c', 'allocated', 125, { revenue_type: 'committed_work', delivery_due: '2026-12-03', invoice_by: '2026-12-11', enquiry_ref: 'ENQ-9023' });
  const parts = ui([committed, enq('n', 'quote', 2500, { enquiry_ref: 'ENQ-9001' })]);
  Object.assign(parts.state.f, { market: 'B2B', rtype: 'committed_work' });
  const bar = parts.filtersHtml();
  for (const all of ['All priorities', 'All stages', 'All markets', 'All revenue types', 'All reviews', 'All owners']) assert.ok(bar.includes(`>${all}</option>`), all);
  assert.doesNotMatch(bar, />any</, 'no bare "any"');
  assert.match(bar, /Show closed \/ parked/);
  assert.equal((bar.match(/class="pp-fchip"/g) || []).length, 2, 'two active filter chips');
  assert.match(bar, /data-pp-unf="market" title="Remove this filter">Market: B2B ×/);
  assert.match(bar, /data-pp-unf="rtype" title="Remove this filter">Revenue type: Committed work ×/);
  const d = parts.drawerHtml(committed, false);
  assert.match(d, /Edit ENQ-9023 · TEST c/);
  for (const w of ['committed', 'closed', 'parked', 'ended', 'paid']) assert.match(d, new RegExp(`<section data-when="${w}">`), `${w} section present (shown / hidden by syncDrawer)`);
  assert.match(d, /name="delivery_due" value="2026-12-03" data-orig="2026-12-03"/);
  assert.match(d, /<option value="delivered">Delivered · invoice to send<\/option><option value="invoiced">Invoiced · payment pending<\/option><option value="booked_paid">Paid<\/option>/, 'committed statuses; Paid needs a match');
  assert.match(d, /<option value="other">Other \(note\)<\/option>/);
  assert.match(d, /<input type="checkbox" name="touch"> Touched today/, '"Touched today" is off by default');
  const add = parts.drawerHtml({ owner: 'GPT' }, true);
  assert.match(add, /Add enquiry/);
  assert.match(add, /Name \/ organisation <span class="pp-req">\*<\/span>/, 'required fields marked');
  assert.equal(parts.savedText({ enquiry_ref: 'ENQ-0023', updated: true, changes: { stage: { from: 'allocated', to: 'delivered' }, last_touch_at: { from: 'a', to: 'b' } } }, committed), 'Saved ENQ-0023: Stage Allocated · delivery pending → Delivered · invoice to send.');
});

/**
 * QUESTION-2026-11-09 (v): "Can we hit the target? Realistic cover by month" + old-lead factor + dated-event enquiries.
 * Fixtures only (no real enquiries): the columns add up, still to find = still to sell − realistic total, the rolling
 * figure is the sum of the monthly shortfalls only, revalidate leads count at 0.25, dated-event enquiries sit under
 * Dated events capped by places, and undated enquiries are shown but never counted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { REVALIDATE_FACTOR, buildSalesGap, eventLikely, monthsFrom } from '../lib/strategy-sales-gap.mjs';
import { COVER_PARTS, datedEnquiries, eventHeadroom } from '../lib/strategy-sales-gap-cover.mjs';
import { pipelineByMonth, probsOf, quarterFeedOf, summarizeProspects, weightedOf } from '../lib/strategy-prospects.mjs';
import { eventRef } from '../api/aigeo/prospects.js';

const TODAY = '2026-11-09';
const LEAD = { day: { n: 120, q25_days: 19, median_days: 45, q75_days: 139 }, residential: { n: 17, q25_days: 31, median_days: 76, q75_days: 104 }, course: { n: 25, q25_days: 23, median_days: 36, q75_days: 63 } };
const FILL = { day: 0.559, residential: 0.563, course: 0.583, all: 0.563 };
const CONFIG = [{ stage: 'qualify', probability: 0.2 }, { stage: 'quote', probability: 0.4 }, { stage: 'scheduled', probability: 0.75 }, { stage: 'booked_paid', probability: 1 }];
const MACRO_URL = 'https://www.alanranger.com/photographic-workshops-near-me/abstract-and-macro-photography-workshop-coventry';
const MACRO_KEY = '2026-11-28|/photographic-workshops-near-me/abstract-and-macro-photography-workshop-coventry';
const EVENTS = [
  { eventKey: 'macro', date: '2026-11-28', title: 'Abstract and Macro Photography Workshop', type: 'day', cap: 4, booked: 0, left: 4, price: 75, url: MACRO_URL },
  { eventKey: 'lake', date: '2027-01-22', title: 'Lake District Photography Workshop', type: 'residential', cap: 4, booked: 2, left: 2, price: 1075, url: 'https://www.alanranger.com/x/lake-district' }
];
const row = (id, stage, value, cash, extra = {}) => ({ id, client_or_org: `TEST ${id}`, type: '1-2-1', stage, value_gbp: value, cash_month: cash, value_basis: 'quoted', review_status: 'recent', revenue_type: 'new_sale', owner: 'GPT', last_touch_at: '2026-11-08T10:00:00Z', ...extra });
const ROWS = [
  row('macro-enq', 'quote', 1000, '2026-11-01', { relates_to_event: MACRO_KEY }),
  row('private-event', 'qualify', 500, '2027-01-01', { relates_to_event: '2027-01-20|/jlr-workshop', type: 'corporate training' }),
  row('dec-121', 'quote', 500, '2026-12-01'),
  row('dec-old-lead', 'qualify', 1000, '2026-12-01', { review_status: 'revalidate' }),
  row('undated', 'quote', 2000, null),
  row('undated-event', 'quote', 300, null, { relates_to_event: MACRO_KEY }),
  row('judging', 'allocated', 125, '2026-12-01', { revenue_type: 'committed_work', type: 'commission' }),
  row('invoice', 'scheduled', 250, '2026-11-01', { revenue_type: 'receivable', type: 'other' })
];
const TARGETS = [100, 2694, 1776, 3655, 4277, 4602, 3464, 2634, 4130, 5391, 3000, 2000];
const txns = [{ txn_date: '2025-11-10', category_order: 8, amount: 600 }, { txn_date: '2025-12-10', category_order: 7, amount: 300 }];
const prospects = summarizeProspects({ rows: ROWS, config: CONFIG, history: [], today: TODAY, months: monthsFrom(TODAY, 3) });
const gap = () => buildSalesGap({ today: TODAY, txns, targets: TARGETS, events: EVENTS, fill: FILL, lead: LEAD, pipeline: prospects.by_month, pipeline_open: quarterFeedOf(prospects), prospects });
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, `${msg}: ${a} vs ${b}`);

test('columns add up: realistic total = the six cover lines; still to find = still to sell − realistic total; rolling = Σ months', () => {
  const c = gap().cover;
  for (const m of c.months) {
    near(m.total, sum(COVER_PARTS.map((k) => m[k])), `${m.label} realistic total`);
    near(m.still_to_find, Math.max(0, m.still_to_sell - m.total), `${m.label} still to find`);
    near(m.surplus, Math.max(0, m.total - m.still_to_sell), `${m.label} surplus`);
  }
  for (const k of ['still_to_sell', ...COVER_PARTS, 'total']) near(c.rolling[k], sum(c.months.map((m) => m[k])), `rolling ${k}`);
  near(c.months[0].cash_to_collect, 250, 'Nov cash to collect (receivable)');
  near(c.months[1].committed, 125, 'Dec committed work (full value)');
});

test('rolling still to find = the sum of the monthly shortfalls only: a January surplus never pays November', () => {
  const c = gap().cover;
  const [nov, dec, jan] = c.months;
  assert.ok(nov.still_to_find > 0 && dec.still_to_find > 0, 'Nov and Dec are short');
  assert.ok(jan.surplus > 0 && jan.still_to_find === 0, 'Jan is covered with a surplus');
  near(c.rolling.still_to_find, nov.still_to_find + dec.still_to_find, 'rolling = Nov + Dec shortfalls');
  assert.ok(c.rolling.still_to_find > c.rolling.still_to_sell - c.rolling.total + 0.5, 'not netted against the January surplus');
  near(c.rolling.surplus_not_carried, jan.surplus, 'the surplus is reported, not carried');
});

test('revalidate (old lead) × 0.25 in the weighted £, the pipeline by month (Remedy) and the realistic cover', () => {
  assert.equal(REVALIDATE_FACTOR, 0.25);
  const P = probsOf(CONFIG);
  assert.equal(weightedOf(ROWS[3], P), 1000 * 0.2 * 0.25);
  assert.equal(weightedOf(ROWS[2], P), 500 * 0.4, 'a recent lead is not reduced');
  assert.equal(pipelineByMonth(ROWS, P, '2026-11')['2026-12'].total, 200 + 50);
  const g = gap();
  near(g.months[1].pipeline_weighted, 250, 'Dec Remedy pipeline');
  near(g.remedy.rows[1].pipeline_weighted, 250, 'Remedy row');
  near(g.cover.months[1].pipeline, 250, 'realistic cover Dec pipeline');
  near(prospects.tiles.find((t) => t.stage === 'qualify').weighted, 1000 * 0.2 * 0.25 + 500 * 0.2, 'Prospects stage tile');
  assert.equal(prospects.pipeline.revalidate_factor, 0.25);
  assert.match(g.rules.join(' '), /old leads count at a quarter/);
  assert.equal(g.assumptions.find((a) => a.key === 'revalidate_factor').status, 'set 9 Nov, review later');
});

test('dated-event enquiries: under Dated events (not the non-dated pipeline), capped at the event\'s places left after likely', () => {
  const g = gap();
  assert.equal(prospects.by_month['2026-11']?.total || 0, 0, 'the Macro enquiry is not in the non-dated pipeline');
  assert.deepEqual(prospects.dated_event.map((r) => r.event_key).sort(), [MACRO_KEY, '2027-01-20|/jlr-workshop'], 'undated dated-event enquiry left out');
  const headroom = eventHeadroom(eventLikely(EVENTS[0], { today: TODAY, fill: FILL, lead: LEAD }, monthsFrom(TODAY, 3)));
  near(g.months[0].dated_event_gbp, headroom, 'Nov: capped at (places left − likely places) × price');
  assert.ok(headroom < 400, 'the £400 weighted enquiry is more than the event can take');
  near(g.dated_event.capped_gbp, 400 - headroom, 'the excess is reported as capped');
  near(g.months[2].dated_event_gbp, 100, 'a private event (not on sale) counts uncapped');
  assert.equal(g.dated_event.unmatched_count, 1);
  near(g.cover.months[0].dated_event, headroom, 'realistic cover Nov');
  assert.equal(g.cover.months[0].pipeline, 0, 'not double counted in the pipeline line');
  assert.ok(!g.remedy.rows.flatMap((r) => r.lever1.rows).some((r) => r.date === '2026-11-28'), 'lever 1 never re-sells the places the enquiry fills');
  near(g.months[0].still_to_find, Math.max(0, g.months[0].non_dated_needed - g.months[0].normal_adjusted - g.months[0].pipeline_weighted - g.months[0].committed_gbp - headroom), 'Remedy still to find takes the dated-event enquiries off');
  near(g.rolling.pipeline.dated_event, headroom + 100, 'quarter tile: dated-event enquiries in the rolling months');
});
test('dated-event key may name the PRODUCT page: matched to the event on sale that date (shared cap), never double-capped', () => {
  const evs = [{ key: 'macro', date: '2026-11-28', title: 'Abstract and Macro Photography Workshop Warwickshire - Nov', url: MACRO_URL, left: 4, likely: 1, price: 75 },
    { key: 'walk', date: '2026-12-12', title: 'Woodland Photography Walk', url: 'https://www.alanranger.com/x/woodland', left: 6, likely: 0, price: 30 },
    { key: 'lake', date: '2026-12-12', title: 'Lake District Photography Workshop', url: 'https://www.alanranger.com/x/lake', left: 2, likely: 0, price: 1075 }];
  const rows = [
    { event_key: '2026-11-28|/photo-workshops-uk/abstract-and-macro-photography-workshops', month: '2026-11', weighted: 150 },
    { event_key: MACRO_KEY, month: '2026-11', weighted: 150 },
    { event_key: '2026-12-12|/photo-workshops-uk/woodland-photography-walks', month: '2026-12', weighted: 40 },
    { event_key: '2026-12-12|/photo-workshops-uk/something-else', month: '2026-12', weighted: 10 }
  ];
  const d = datedEnquiries(evs, rows);
  near(d.by_event.macro, (4 - 1) * 75, 'product-page and event-page enquiries share the Macro cap (£225), not £225 each');
  near(d.by_month['2026-11'], 225, 'Nov counted');
  near(d.capped_gbp, 300 - 225, 'excess capped');
  near(d.by_event.walk, 40, 'two events that date: the one whose title matches the slug words');
  assert.equal(d.unmatched_count, 1, 'an ambiguous slug on a two-event date is not guessed');
});

test('undated potential is shown and never counted', () => {
  const g = gap();
  const P = probsOf(CONFIG);
  const undated = weightedOf(ROWS[4], P) + weightedOf(ROWS[5], P);
  near(g.cover.undated.gbp, undated, 'undated £ (both undated enquiries, weighted)');
  assert.equal(g.cover.undated.count, 2);
  assert.equal(g.cover.undated.counted, false);
  const counted = g.cover.rolling.dated_event + g.cover.rolling.pipeline;
  near(counted, prospects.dated_event.reduce((a, r) => a + r.weighted, 0) - g.dated_event.capped_gbp + 250, 'only enquiries with a month are counted');
});

test('UI: the table under the tiles (rows, amber shortfall, green covered, rolling = shortfalls), undated line, footnote; pipeline lines', () => {
  const g = gap();
  const ctx = { document: { addEventListener() {}, getElementById: () => null, querySelector: () => null }, console, Intl, Date, Math, Number, String, JSON, Promise };
  ctx.window = ctx;
  vm.runInNewContext(fs.readFileSync(new URL('../lib/strategy-sales-gap.js', import.meta.url), 'utf8'), ctx);
  const h = ctx.stSalesGapHtml({ sales_gap: g }).tiles;
  const t = h.slice(h.indexOf('id="sg-cover"'));
  assert.ok(h.indexOf('id="sg-cover"') > h.indexOf('data-sg-month="2027-01"'), 'under the four tiles');
  assert.match(t, /Can we hit the target\? Realistic cover by month/);
  assert.match(t, /<th>November<\/th><th>December<\/th><th>January<\/th><th>Rolling 3 months<\/th>/);
  for (const l of ['Still to sell', 'Dated events', 'Likely bookings \\(fill rate\\)', 'Enquiries about dated events', 'Non-dated', 'Normal sales \\(same month last year\\)', 'Prospects pipeline', 'Committed work', 'Cash to collect', 'Realistic total', 'Still to find']) assert.match(t, new RegExp(l));
  assert.match(t, /old &quot;revalidate&quot; leads count at a quarter/);
  const cv = (v) => (Math.abs(v) < 100 ? `£${Math.round(v)}` : `£${(Math.round(v / 100) / 10).toFixed(1)}k`).replace('.', '\\.');
  const [nov, dec, jan] = g.cover.months;
  assert.match(t, new RegExp(`<td class="sg-cfind">${cv(nov.still_to_find)}</td><td class="sg-cfind">${cv(dec.still_to_find)}</td><td class="sg-ccov">covered \\(\\+${cv(jan.surplus)}\\)</td><td class="sg-cfind">${cv(g.cover.rolling.still_to_find)}</td>`), 'amber shortfalls, green covered (+£x), rolling = Nov + Dec shortfalls');
  assert.match(t, /Undated potential <b>£\d[\d,]*<\/b> \(2 enquiries without an expected month, not counted\)/);
  assert.match(t, /&quot;Still to find&quot; for the rolling 3 months = Nov \+ Dec shortfalls only: January's surplus can't pay an earlier month's bills\./);
  assert.match(t, /Each enquiry gets an <b>expected cash month<\/b>/);
  assert.match(h, /Prospects pipeline:<\/b> £250 weighted, cash due this month · dated-event enquiries £0 · undated £\d/, 'Dec month tile line');
  assert.match(h, /Prospects pipeline:<\/b> £250 weighted by month · dated-event enquiries £\d+ · undated £\d/, 'quarter tile line');
  assert.match(ctx.stSalesGapHtml({ sales_gap: g }).remedy, /− dated-event enquiries £\d+/, 'Remedy names the dated-event enquiries');
});

test('API: relates_to_event normalised to "YYYY-MM-DD|/path" (full URL accepted); blank clears; bad input refused', () => {
  assert.equal(eventRef(`2026-11-28|${MACRO_URL}/?utm=x`), MACRO_KEY);
  assert.equal(eventRef('2027-01-20|/JLR-Workshop/'), '2027-01-20|/jlr-workshop');
  assert.equal(eventRef(''), null);
  assert.equal(eventRef(null), null);
  assert.throws(() => eventRef('28 Nov macro'), /relates_to_event must be/);
  assert.throws(() => eventRef('2026-11-28|'), /relates_to_event must be/);
  const sql = fs.readFileSync(new URL('../migrations/prospect_relates_to_event_20261109.sql', import.meta.url), 'utf8');
  assert.match(sql, /add column if not exists relates_to_event text/);
  assert.match(sql, /relates_to_event = r\.relates_to_event/);
  assert.match(sql, /grant execute on function public\.prospect_upsert\(jsonb\) to postgres, service_role/);
});

/**
 * QUESTION-2026-11-09 (dd): "How it's covered" bar (one calculation shared with the realistic cover table) + "Agreed &
 * prospects due this month" (labels only from the admin prospects API; the public summary keeps aggregates only).
 * Fixtures only: no real enquiries.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { buildSalesGap, monthsFrom } from '../lib/strategy-sales-gap.mjs';
import { BAR_SEGMENTS, coverageBar } from '../lib/strategy-sales-gap-cover.mjs';
import { quarterFeedOf, summarizeProspects } from '../lib/strategy-prospects.mjs';

const TODAY = '2026-11-09';
const LEAD = { day: { n: 120, q25_days: 19, median_days: 45, q75_days: 139 }, residential: { n: 17, q25_days: 31, median_days: 76, q75_days: 104 }, course: { n: 25, q25_days: 23, median_days: 36, q75_days: 63 } };
const FILL = { day: 0.559, residential: 0.563, course: 0.583, all: 0.563 };
const CONFIG = [{ stage: 'qualify', probability: 0.2 }, { stage: 'quote', probability: 0.4 }, { stage: 'scheduled', probability: 0.75 }, { stage: 'booked_paid', probability: 1 }];
const EVENTS = [{ eventKey: 'lake', date: '2027-01-22', title: 'Lake District Photography Workshop', type: 'residential', cap: 4, booked: 2, left: 2, price: 1075, url: 'https://www.alanranger.com/x/lake' }];
const row = (id, label, extra) => ({ id, enquiry_ref: `ENQ-${id}`, client_or_org: label, type: 'commission', stage: 'qualify', value_gbp: 0, value_basis: 'agreed', review_status: 'recent', revenue_type: 'new_sale', owner: 'GPT', ...extra });
const ROWS = [
  row('9001', 'FIXTURE Worktops studio', { revenue_type: 'committed_work', stage: 'allocated', value_gbp: 1250, cash_month: '2026-11-01' }),
  row('9002', 'FIXTURE paid link invoice', { revenue_type: 'receivable', stage: 'scheduled', value_gbp: 250, cash_month: '2026-11-01', type: 'other' }),
  row('9003', 'FIXTURE Worktops warehouse', { revenue_type: 'committed_work', stage: 'allocated', value_gbp: 1250, cash_month: '2026-12-01' }),
  row('9004', 'FIXTURE judging', { revenue_type: 'committed_work', stage: 'allocated', value_gbp: 125, cash_month: '2026-12-01', value_basis: 'quoted' }),
  row('9005', 'FIXTURE quote', { stage: 'quote', value_gbp: 500, cash_month: '2026-11-01', value_basis: 'quoted', type: '1-2-1' }),
  row('9006', 'FIXTURE old lead', { stage: 'qualify', value_gbp: 400, cash_month: '2026-11-01', value_basis: 'estimated', review_status: 'revalidate', type: 'mentoring' }),
  row('9007', 'FIXTURE undated', { stage: 'quote', value_gbp: 1000, cash_month: null, value_basis: 'quoted', type: '1-2-1' }),
  row('9008', 'FIXTURE lost', { stage: 'closed_lost', value_gbp: 900, cash_month: '2026-11-01', lost_reason: 'x' }),
  row('9009', 'FIXTURE partner', { revenue_type: 'partner_development', value_gbp: 0, cash_month: '2026-11-01' }),
  row('9010', 'FIXTURE parked', { stage: 'parked', value_gbp: 800, cash_month: '2026-11-01', revisit_on: '2027-01-10' })
];
const TARGETS = [100, 2694, 1776, 3655, 4277, 4602, 3464, 2634, 4130, 5391, 5755, 5191];
const txns = [{ txn_date: '2026-11-03', category_order: 3, amount: 250 }, { txn_date: '2025-11-10', category_order: 8, amount: 600 }, { txn_date: '2025-12-10', category_order: 7, amount: 300 }, { txn_date: '2026-01-10', category_order: 8, amount: 600 }];
const prospects = summarizeProspects({ rows: ROWS, config: CONFIG, history: [], today: TODAY, months: monthsFrom(TODAY, 3) });
const g = buildSalesGap({ today: TODAY, txns, targets: TARGETS, events: EVENTS, fill: FILL, lead: LEAD, pipeline: prospects.by_month, pipeline_open: quarterFeedOf(prospects), prospects });
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, `${msg}: ${a} vs ${b}`);

test('bar segments (widths + still to find) add up to still to sell, in each month and the quarter', () => {
  for (const m of [...g.cover.months, g.cover.rolling]) {
    const b = m.bar;
    near(sum(b.segments.map((s) => s.width)) + b.still_to_find, b.still_to_sell, `${m.label} widths + gap`);
    assert.deepEqual(b.segments.map((s) => s.key), ['events', 'event_enquiries', 'normal', 'agreed', 'prospects'], 'segment order');
  }
});

test('one calculation: the bar values are the realistic cover table lines (agreed = committed + cash to collect, full value)', () => {
  for (const m of g.cover.months) {
    const v = Object.fromEntries(m.bar.segments.map((s) => [s.key, s.gbp]));
    near(v.events, m.likely, `${m.label} events`);
    near(v.event_enquiries, m.dated_event, `${m.label} event enquiries`);
    near(v.normal, m.normal, `${m.label} normal`);
    near(v.agreed, m.committed + m.cash_to_collect, `${m.label} agreed work + invoice`);
    near(v.prospects, m.pipeline, `${m.label} prospects`);
    near(m.bar.still_to_find, m.still_to_find, `${m.label} still to find`);
  }
  near(g.cover.months[0].committed, 1250, 'Nov committed work at full value');
  near(g.cover.months[1].committed, 1375, 'Dec committed (1,250 + 125), not weighted');
  near(g.cover.months[0].pipeline, 500 * 0.4 + 400 * 0.2 * 0.25, 'Nov prospects weighted, the old lead × 0.25');
  near(g.remedy.rows[0].committed_gbp, 1250, 'Remedy treats committed work the same way (full value)');
  assert.ok(BAR_SEGMENTS.length === 5);
});

test('covered month: no gap segment, "Covered (+£x)"; quarter still to find = the sum of the shortfalls only', () => {
  const jan = g.cover.months[2].bar;
  assert.equal(jan.covered, true);
  assert.ok(jan.surplus > 0);
  near(sum(jan.segments.map((s) => s.width)), jan.still_to_sell, 'a covered month fills the bar exactly');
  const q = g.cover.rolling.bar;
  near(q.still_to_find, sum(g.cover.months.map((m) => m.still_to_find)), 'quarter = Σ monthly shortfalls');
  near(q.surplus_not_carried, jan.surplus, 'January surplus not carried');
  assert.deepEqual(q.shortfall_months, g.cover.months.filter((m) => m.still_to_find > 0.5).map((m) => m.label));
  const b = coverageBar({ still_to_sell: 1000, likely: 600, dated_event: 0, normal: 300, committed: 0, cash_to_collect: 0, pipeline: 0, still_to_find: 100, surplus: 0 });
  assert.deepEqual(b.segments.map((s) => s.width), [600, 0, 300, 0, 0]);
});

function browser() {
  const ctx = { document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] }, console, Intl, Date, Math, Number, String, JSON, Promise, Object };
  ctx.window = ctx;
  vm.runInNewContext(fs.readFileSync(new URL('../lib/strategy-sales-gap.js', import.meta.url), 'utf8'), ctx);
  return ctx;
}

test('tiles: "How it\'s covered" bar + key under the headline bar in all 4 tiles; headline bar unchanged', () => {
  const h = browser().stSalesGapHtml({ sales_gap: g }).tiles;
  assert.equal((h.match(/data-sg-cover>/g) || []).length, 4, 'quarter + 3 months');
  const nov = h.slice(h.indexOf('data-sg-month="2026-11"'), h.indexOf('data-sg-month="2026-12"'));
  assert.match(nov, /<div class="sg-bar">[\s\S]*?<\/div><div class="sg-cov" data-sg-cover><div class="sg-covt">How it's covered<\/div>/, 'directly under the headline bar');
  assert.match(nov, /sg-s-ev[\s\S]*sg-s-no[\s\S]*sg-s-ag[\s\S]*sg-s-pr[\s\S]*sg-s-gap/);
  assert.match(nov, /Normal non-dated £[\d.]+k?<\/span>.*Agreed work \+ invoice £1\.5k<\/span>.*Prospects £0\.2k<\/span>.*Still to find £/, 'key names and values every non-zero segment (no events this November in the fixture)');
  const jan = h.slice(h.indexOf('data-sg-month="2027-01"'));
  assert.match(jan, /<span class="sg-ccov">Covered \(\+£[\d.]+k?\)<\/span>/);
  assert.doesNotMatch(jan.slice(0, jan.indexOf('Events people book')), /sg-s-gap/, 'no gap segment when covered');
  const q = h.slice(h.indexOf('sg-card sg-q'), h.indexOf('data-sg-month'));
  assert.match(q, /Still to find £[\d.]+k? \(Nov\+Dec\)/, 'quarter key names the months short');
  assert.match(h, /<div class="sg-bar"><span class="sg-b1"/, 'headline bar kept');
});

test('"Agreed & prospects": agreed first then weighted, chips, "£75 → £15", max 5 + more, quarter months + undated box', () => {
  const w = browser();
  const A = w.stSalesGapAgreed;
  Object.assign(A.state, { rows: ROWS.map((r) => ({ ...r })), config: CONFIG, factor: 0.25, error: null });
  const nov = A.agreedInner({ keys: ['2026-11'], quarter: false, bar: g.cover.months[0].bar });
  assert.match(nov, /Agreed &amp; prospects due this month<\/b> · still to find <b class="sg-amber">/);
  const order = [...nov.matchAll(/data-sg-label>([^<]+)</g)].map((x) => x[1]);
  assert.deepEqual(order, ['FIXTURE Worktops studio', 'FIXTURE paid link invoice', 'FIXTURE quote', 'FIXTURE old lead'], 'agreed first (by £), then weighted; lost, parked, partner and undated left out');
  assert.match(nov, /FIXTURE Worktops studio<\/span><span class="sg-chip sg-chip-a">Agreed<\/span><span class="sg-agv">£1,250<\/span>/);
  assert.match(nov, /paid link invoice<\/span><span class="sg-chip sg-chip-a">To collect<\/span><span class="sg-agv">£250<\/span>/);
  assert.match(nov, /FIXTURE quote<\/span><span class="sg-chip sg-chip-p">Quote<\/span><span class="sg-agv">£500 → £200<\/span>/);
  assert.match(nov, /FIXTURE old lead<\/span><span class="sg-chip sg-chip-p">Qualify<\/span><span class="sg-agv">£400 → £20<\/span>/, 'revalidate × 0.25');
  const dec = A.agreedInner({ keys: ['2026-12'], quarter: false, bar: g.cover.months[1].bar });
  assert.match(dec, /judging<\/span><span class="sg-chip sg-chip-a">Committed<\/span>/, 'committed work without an agreed value basis reads Committed');
  const jan = A.agreedInner({ keys: ['2027-01'], quarter: false, bar: g.cover.months[2].bar });
  assert.match(jan, /<span class="sg-ccov">covered \(\+£[\d.]+k?\)<\/span>/);
  assert.match(jan, /None with this month yet\./);
  const q = A.agreedInner({ keys: ['2026-11', '2026-12', '2027-01'], quarter: true, bar: g.cover.rolling.bar, undated: g.cover.undated });
  assert.equal((q.match(/data-sg-label/g) || []).length, 5, 'max 5');
  assert.match(q, /\+1 more → Prospects/);
  assert.match(q, /£1,250 · Nov/);
  assert.match(q, /£1,250 · Dec/);
  assert.match(q, /Not yet in a month<\/b> <span class="rt-sub">\(GPT \+ Alan qualifying\)<\/span>: 1 enquiry · £400 weighted/);
});

test('labels come ONLY from the admin prospects API: the public summary (prospects + sales gap) has no enquiry labels, names or refs', () => {
  const pub = JSON.stringify({ prospects, sales_gap: g });
  for (const r of ROWS) {
    assert.ok(!pub.includes(r.client_or_org), `no label "${r.client_or_org}"`);
    assert.ok(!pub.includes(r.enquiry_ref), `no ref ${r.enquiry_ref}`);
  }
  assert.ok(!/FIXTURE/.test(pub));
  const view = fs.readFileSync(new URL('../lib/strategy-sales-gap.js', import.meta.url), 'utf8');
  assert.match(view, /fetch\('\/api\/aigeo\/prospects', \{ headers: \{ 'x-arp-admin-key': k \} \}\)/, 'the list is fetched with the admin key');
  const html = browser().stSalesGapHtml({ sales_gap: g }).tiles;
  assert.ok(!/FIXTURE/.test(html) && /admin key needed to list enquiries/.test(html), 'without the admin key no label is rendered');
});

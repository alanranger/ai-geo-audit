/**
 * Sales gap UI: Strategy renders the server model (tiles, Remedy plan, 4 quarter cards); Marketing has no duplicate
 * sales-gap tiles, only the one-line link with the same rolling figures.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { buildSalesGap } from '../lib/strategy-sales-gap.mjs';

const LEAD = { day: { n: 120, q25_days: 19, median_days: 45, q75_days: 139 }, residential: { n: 17, q25_days: 31, median_days: 76, q75_days: 104 }, course: { n: 25, q25_days: 23, median_days: 36, q75_days: 63 } };
const g = buildSalesGap({
  today: '2026-11-09', targets: [4332, 2694, 1776, 3655, 4277, 4602, 3464, 2634, 4130, 5391, 5755, 5191],
  txns: [{ txn_date: '2026-10-05', category_order: 2, amount: 3000 }, { txn_date: '2026-11-03', category_order: 3, amount: 1075 }, { txn_date: '2025-11-10', category_order: 8, amount: 600 }],
  events: [{ eventKey: 'lake', date: '2027-01-22', title: 'Lake District Photography Workshop', type: 'residential', cap: 4, booked: 2, left: 2, price: 1075, booked_gbp: 2150 }],
  fill: { day: 0.559, residential: 0.563, course: 0.583, all: 0.563 }, lead: LEAD,
  quarters: [['q1', 'Q1 · Oct–Dec 2026', '2026-10-01', '2026-12-31'], ['q2', 'Q2 · Jan–Mar 2027', '2027-01-01', '2027-03-31'], ['q3', 'Q3 · Apr–Jun 2027', '2027-04-01', '2027-06-30'], ['q4', 'Q4 · Jul–Sep 2027', '2027-07-01', '2027-09-30']].map(([key, label, start_date, end_date]) => ({ key, label, start_date, end_date }))
});

function browser() {
  const ctx = { document: { addEventListener() {}, getElementById: () => null, querySelector: () => null }, setTimeout, console, Intl, Date, Math, Number, String, JSON, Promise };
  ctx.window = ctx;
  for (const f of ['marketing-overview-tiles.js', 'strategy-sales-gap.js']) vm.runInNewContext(fs.readFileSync(new URL(`../lib/${f}`, import.meta.url), 'utf8'), ctx);
  return ctx;
}

test('Strategy: quarter + 3 month tiles, Remedy plan (3 months + total), 4 quarter cards, Rules', () => {
  const w = browser();
  const h = w.stSalesGapHtml({ sales_gap: g });
  assert.equal((h.tiles.match(/class="sg-card/g) || []).length, 4);
  assert.match(h.tiles, /November[\s\S]*December[\s\S]*January/);
  assert.match(h.tiles, /Non-dated needed \(likely\)/);
  assert.match(h.tiles, /Show the working[\s\S]*November: working ▾/, 'per-event working is under Rules (QUESTION (o))');
  assert.match(h.tiles, /Rules ▾/);
  assert.deepEqual((h.remedy.match(/<tr><td class="left"><b>(\w+)<\/b>/g) || []).map((x) => x.replace(/.*<b>|<\/b>/g, '')), ['Nov', 'Dec', 'Jan'], 'rolling 3 months only');
  assert.match(h.remedy, /sg-tot/);
  assert.equal((h.quarters.match(/sg-qc/g) || []).length, 4);
  assert.match(h.quarters, /no events on sale yet/);
  assert.match(h.quarters, /Reconciles with the months[\s\S]*✓/);
  assert.match(w.stSalesGapHtml({}).tiles, /Sales gap unavailable/);
});

test('Strategy quarter tile v2: dated events table + total, non-dated needed by month, pipeline line, details fold, no verdict box', () => {
  const w = browser();
  const h = w.stSalesGapHtml({ sales_gap: g }).tiles;
  const q = h.slice(h.indexOf('sg-card sg-q'), h.indexOf('data-sg-month'));
  assert.match(q, /Quarter · 9 Nov → 31 Jan/);
  assert.match(q, /still to sell/);
  const live = w.stSalesGapHtml({ sales_gap: { ...g, rolling: { ...g.rolling, still_to_sell: 15028, likely: 8389 } } }).tiles;
  assert.match(live, /sg-big">£15\.0k <span class="sg-u">still to sell[\s\S]*£8\.4k likely dated[\s\S]*£6\.6k non-dated</, 'header figure + bar labels as in the mock-up');
  assert.match(q, /Dated events[\s\S]*Category[\s\S]*Events[\s\S]*Unsold places[\s\S]*If all sold[\s\S]*Fill rate[\s\S]*Likely £/);
  assert.match(q, /Courses[\s\S]*One-day workshops[\s\S]*Residential[\s\S]*sg-qtot[\s\S]*Total/);
  assert.match(q, /Non-dated needed[\s\S]*Nov[\s\S]*Dec[\s\S]*Jan[\s\S]*Total[\s\S]*Needed/);
  assert.match(q, /From gift vouchers, Pick n Mix, 1-2-1s, mentoring, Academy, commissions, prints &amp; royalties\./);
  assert.match(q, /Prospects pipeline:<\/b> £0 weighted by month · dated-event enquiries £0 · undated £0/, 'QUESTION (v): weighted by month · dated-event enquiries · undated');
  assert.match(q, /<summary>details<\/summary>[\s\S]*Booked \/ capacity[\s\S]*Avg people per event[\s\S]*Normal non-dated \(same months last year\)[\s\S]*Still to find after normal and pipeline[\s\S]*data-sg-rules/);
  assert.doesNotMatch(q, /sg-v|Stock on sale now|Likely dated bookings \(fill rate\)/, 'old lines and the yellow verdict box are retired');
  assert.match(h, /id="sg-rules"/);
  assert.match(w.stSalesGapHtml({ sales_gap: { ...g, rolling: { ...g.rolling, pipeline: { error: 'x' } } } }).tiles, /Prospects pipeline:<\/b> unavailable/);
});

test('Marketing: no duplicate sales-gap tiles; one link line with the same rolling figures; Repeat / Academy moved', () => {
  const w = browser();
  const html = w.mkOverviewTiles.gridHtml({ d: {}, s: { sales_gap: g, insights: { rows: {} } }, error: null, health: { state: 'loading' } });
  assert.match(html, /Sales gap by month → Strategy/);
  assert.doesNotMatch(html, /mko-title">(Sales still needed|Dated places|Non-dated sales needed|Repeat clients|Academy progression)/);
  const k = (v) => `£${(Math.round(v / 100) / 10).toLocaleString('en-GB')}k`;
  assert.ok(html.includes(k(g.rolling.still_to_sell)), 'the same still-to-sell figure as Strategy');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSalesTab, workingDaysElapsed, inWorkingWeekTwo } from '../lib/ceo-weekly/sales-tab.js';
import { assemblePipeline, fillLabel, pipelineName, attachSaleOnlyCourses } from '../lib/ceo-weekly/pipeline.js';
import {
  tileTone, buildTriggers, watchedPageTrigger, weekSalesSummary, saleLabel, dayLabel
} from '../lib/ceo-weekly/front-page.js';
import { renderCeoWeeklyHtml } from '../lib/ceo-weekly/email.js';

// Sales 2026 tab cells as uploaded 2 Nov 2026 (weights are the tab's own, row 2).
const TARGETS = {
  year: 2026,
  monthly_target: [4404.14, 3552.97, 2342.33, 4820.7, 5640.35, 6069.85, 4569.04, 3473.7, 5446.77, 7109.52, 5850.22, 5276.4],
  working_days: [23, 21, 21, 22, 23, 20, 23, 22, 21, 23, 21, 22],
  weighting: [0.0752125, 0.0606764, 0.0400015, 0.0823264, 0.0963240, 0.1036589, 0.0780286, 0.0593228, 0.0930182, 0.1214140, 0.0999082, 0.0901086],
  category_targets: { 1: 666.67, 2: 1666.67, 3: 833.33, 4: 100, 5: -100, 6: 80, 7: 800, 8: 83, 9: -100, 10: 100, 11: 500, 12: 250 },
  category_labels: { 1: '1. Courses/masterclasses', 2: '2. Workshops Non Residential', 3: '3. Workshops Residential', 7: '7. 1-2-1', 11: '11 Commissions', 12: '12. Academy', 6: '6. Mentoring', 10: '10. Prints & Royalties' }
};

test('Sales tab: category YTD target = J × 12 × Σ weighting to this month (courses −£3,839, −53%)', () => {
  const s = buildSalesTab({ targets: TARGETS, monthRows: [{ month: 10, category_order: 1, revenue_amount: 3440 }], gpRates: { 1: 0.9 }, asOfYmd: '2026-11-02' });
  const c = s.categories.find((x) => x.label === 'Courses/masterclasses');
  assert.equal(c.ytd_var, -3839);
  assert.equal(c.ytd_pct, -53);
  assert.equal(s.month_target, 5850);
  assert.equal(s.working_days_left, 20);
  assert.equal(s.per_day_needed, 293);
  assert.equal(s.on_pace_visible, false);
});

test('Sales tab: "on pace" appears from working week 2', () => {
  assert.equal(workingDaysElapsed('2026-11-09'), 6);
  assert.equal(inWorkingWeekTwo('2026-11-06'), false);
  assert.equal(inWorkingWeekTwo('2026-11-09'), true);
});

test('tile colour rule: ≥100% green · 90–99% amber · <90% red · grey when it cannot be judged', () => {
  assert.equal(tileTone(333, 333), 'green');
  assert.equal(tileTone(316, 333), 'amber');
  assert.equal(tileTone(126, 147), 'red');
  assert.equal(tileTone(null, 3), 'grey');
  assert.equal(tileTone(1, 115, { judge: false }), 'grey');
});

test('pipeline labels and names follow the mockup', () => {
  assert.equal(fillLabel(0, 6), 'Empty');
  assert.equal(fillLabel(1, 3), 'Low');
  assert.equal(fillLabel(2, 4), 'OK');
  assert.equal(fillLabel(1, null), 'Booked');
  assert.equal(pipelineName('Camera Courses For Beginners - 3-week beginners', 'course'), 'Beginners course (3 wks)');
  assert.equal(pipelineName('Fairy Glen Betws-y-Coed Photography Workshop - Wales', 'day'), 'Fairy Glen');
  assert.equal(pipelineName('Hartland Quay, Devon Seascape Photography Workshop', 'residential'), 'Devon residential');
});

const DIARY = [
  { date: '2026-11-07', kind: 'workshop', type: 'day', title: 'Peak District Photography - Autumn Workshop - Padley Gorge', url: '/p', cap: 6 },
  { date: '2026-11-28', kind: 'workshop', type: 'day', title: 'Abstract and Macro Photography Workshop', url: '/m', cap: 4 }
];

test('15g.1: a JLR Lightroom sale with no Courses-Classes row joins the next scheduled Lightroom run (capacity "?")', () => {
  const p = assemblePipeline({
    diary: DIARY,
    feeds: { workshops: [] },
    workshops: [{ id: 1, event_start: '2026-11-07', theme_location: 'Peak District Photography Workshops Padley Gorge', client_name: 'Ken D', paid: 127.5, balance: 0 }],
    courses: [],
    schedule: [{ title: 'Lightroom Classic Photo Editing Classes - Week 1 of 3 -12-11', start_date: '2026-11-12', kind: 'lesson' }],
    saleTxns: [{ txn_date: '2026-10-30', amount: 100, event_label: 'Lightoom', canonical_product: 'Lightroom Courses for Beginners', is_jlr: true, client_name: 'JLR' }],
    today: '2026-11-02',
    capFor: () => 6
  });
  const w0 = p.windows[0];
  const lr = w0.rows.find((r) => r.name === 'Lightroom course');
  assert.equal(lr.booked, 1);
  assert.equal(lr.cap, null);
  assert.equal(lr.label, 'Booked');
  assert.equal(w0.people, 2);
  assert.equal(w0.empty, 1);
  assert.equal(Math.round(w0.taken), 228);
});

test('sale-only matching ignores courses tracked on the Courses tab and runs > 45 days after the sale', () => {
  const rows = [{ name: 'Lightroom course', date: '2026-11-12', source: 'schedule', who: [], booked: 0, taken: 0, cap: null }];
  const att = attachSaleOnlyCourses(rows, [{ txn_date: '2026-07-01', amount: 100, event_label: 'Lightroom', is_jlr: true }], []);
  assert.equal(att.length, 0);
});

test('card C triggers: gift vouchers (Nov, last year < half the year before) and the watched page YoY slide', () => {
  const academy = { on_trial: 2, lost_7d: 6, converted_7d: 0, trial_ends: ['2026-11-08', '2026-11-16'] };
  const t = buildTriggers({ asOfYmd: '2026-11-02', voucherByYear: { 2024: 1100, 2025: 100 }, voucherTarget: 83, academy, watched: [] });
  assert.deepEqual(t.map((x) => x.key), ['gift_vouchers_christmas', 'academy_trial_nudge']);
  assert.match(t[0].why, /Nov–Dec 2024 £1,100 · Nov–Dec 2025 £100 · voucher target £83\/mo/);
  assert.match(t[1].why, /0 of the last 6 trials converted \(7d\) · trials end 8 Nov and 16 Nov/);
  const monthly = [
    { mon: '2025-10', clicks: 1621, pos: 6.3 }, { mon: '2026-03', clicks: 950, pos: 10.6 },
    { mon: '2026-04', clicks: 724, pos: 12.4 }, { mon: '2026-10', clicks: 141, pos: 18.4 }
  ];
  const w = watchedPageTrigger({ key: 'k', yoyDropShare: 0.5, note: 'feeds Academy trials' }, monthly, '2026-10');
  assert.match(w.why, /^Oct clicks 1,621 \(2025\) → 141 \(2026\) · position 6 → 18/);
});

test('card B sales list: grouped by label, £ desc, ties in sheet category order', () => {
  const s = weekSalesSummary([
    { amount: 50, event_label: 'Peak District 1 Nov', category_order: 2 },
    { amount: 150, event_label: 'Peak District 1 Nov', category_order: 2 },
    { amount: 100, event_label: 'Digital Gift Card', category_order: 8 },
    { amount: 100, event_label: 'Lightoom', category_order: 1 }
  ]);
  assert.equal(s.count, 4);
  assert.deepEqual(s.list, ['Peak District 1 Nov £200', 'Lightroom £100', 'gift card £100']);
  assert.equal(saleLabel({ event_label: '4 x 1hr Zoom', category_order: 7 }), '4×1hr Zoom');
  assert.equal(dayLabel('2026-11-20'), 'Fri 20 Nov');
});

test('rendered brief: new section order, no retired blocks', () => {
  const html = renderCeoWeeklyHtml({
    generated_at: '2026-11-02T14:42:00Z', strategy: { error: 'x' }, section_g: { error: 'x' },
    front: { tiles: [{ value: '1', label: 'x', sub: 'y', section: 1, tone: 'grey' }] }
  });
  const order = ['HEADLINES', '1 · Operations', '2 · Revenue &amp; GP', '3 · Strategy', '4 · SEO &amp; AI visibility', '5 · System health'];
  const at = order.map((s) => html.indexOf(s));
  assert.ok(at.every((i, k) => i >= 0 && (k === 0 || i > at[k - 1])), `order ${at}`);
  for (const retired of ['EXECUTIVE SUMMARY', 'BIGGEST WINS', 'DO THIS WEEK', 'DEEPER ANALYSIS', 'Upcoming events', 'Batsford: AM and PM', 'no sales in 14 days', 'A · The website', 'G · Profit levers', 'Traditional SEO: ']) {
    assert.equal(html.includes(retired), false, retired);
  }
});

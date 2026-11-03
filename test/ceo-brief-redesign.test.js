import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSalesTab, workingDaysElapsed, inWorkingWeekTwo } from '../lib/ceo-weekly/sales-tab.js';
import { assemblePipeline, fillLabel, pipelineName, attachSaleOnlyCourses } from '../lib/ceo-weekly/pipeline.js';
import {
  tileTone, buildTriggers, watchedPageTrigger, weekSalesSummary, saleLabel, dayLabel
} from '../lib/ceo-weekly/front-page.js';
import { renderCeoWeeklyHtml } from '../lib/ceo-weekly/email.js';
import { backlinksComparable, seoHealthComparable } from '../lib/ceo-weekly/comparability.js';
import { assessBriefGate } from '../lib/ceo-weekly/brief-gate.js';
import { websiteSubtitle, backlinksSubtitle, seoHealthSubtitle, openFailsText } from '../lib/ceo-weekly/subtitles.js';
import { weeksRunning, lastmodFromSitemap, courseWeekItems } from '../lib/ceo-weekly/front-page.js';
import { returningClients } from '../lib/strategy-summary.mjs';
import { houseDates } from '../lib/ceo-weekly/strategyScorecard.js';

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

test('a course sale is not added again when the same client is on the Courses tab for an upcoming run (date booked mistyped)', () => {
  const rows = [{ source: 'schedule', name: 'Lightroom course', date: '2026-11-12', who: [], booked: 0, taken: 0, cap: null }];
  const courses = [{ from_date: '2026-11-12', date_booked: '2026-11-26', event_name: '3WK Lightroom Course', client_name: 'Pat Example', paid: 150 }];
  const txns = [{ txn_date: '2026-10-30', client_name: 'Pat Example', amount: 100, event_label: 'Lightoom', is_jlr: true }];
  const matched = [];
  assert.equal(attachSaleOnlyCourses(rows, txns, courses, matched).length, 0);
  assert.equal(rows[0].booked, 0);
  const items = courseWeekItems({ sale_only_attached: [], sale_matched_courses: matched }, [], '2026-10-26', '2026-11-01');
  assert.deepEqual(items, [{ name: 'Lightroom course', date: '2026-11-12', jlr: true, taken: 150, workshop: false }]);
});

test('card C triggers: gift vouchers (Nov, last year < half the year before) and the watched page YoY slide', () => {
  const academy = { on_trial: 2, lost_7d: 6, converted_7d: 0, trial_ends: ['2026-11-08', '2026-11-16'] };
  const t = buildTriggers({ asOfYmd: '2026-11-02', voucherByYear: { 2024: 1100, 2025: 100 }, voucherTarget: 100, academy, watched: [] });
  assert.deepEqual(t.map((x) => x.key), ['gift_vouchers_christmas', 'academy_trial_nudge']);
  assert.match(t[0].why, /Nov–Dec 2024 £1,100 · Nov–Dec 2025 £100 · voucher target £100 this month/);
  assert.match(t[1].why, /0 of the last 6 trials converted \(7d\) · trials end 8 Nov and 16 Nov/);
  assert.equal(buildTriggers({ asOfYmd: '2026-11-02', voucherByYear: {}, academy: { ...academy, on_trial: 3, trial_ends: ['2026-11-08', '2026-11-16', '2026-11-17'] }, watched: [] })[0].why
    .match(/trials end (.*)$/)[1], '8 Nov, 16 Nov and 17 Nov');
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
    front: { tiles: [{ value: '1', label: 'x', sub: 'y', section: 1, tone: 'grey' }] },
    pipeline: {
      windows: [{ key: 'w0', head: 'Next 30 days', rows: [], people: 0, events: 0, taken: 0, due: 0 }],
      totals: { events: 0, people: 0, taken: 0, due: 0 }, flags: []
    },
    sales_tab: buildSalesTab({ targets: TARGETS, monthRows: [], gpRates: {}, asOfYmd: '2026-11-02' }),
    system_health: [{ state: 'ok', text: 'Figures checked before sending' }]
  });
  assert.ok(html.includes("PIPELINE · WHAT'S BOOKED AHEAD") && html.includes('YOUR TARGETS') && html.includes('Figures checked before sending'));
  const order = ['HEADLINES', '1 · Operations', '2 · Revenue &amp; GP', '3 · Strategy', '4 · SEO &amp; AI visibility', '5 · System health'];
  const at = order.map((s) => html.indexOf(s));
  assert.ok(at.every((i, k) => i >= 0 && (k === 0 || i > at[k - 1])), `order ${at}`);
  assert.equal((html.match(/NEW ·/g) || []).length, 0, 'mockup-only "NEW ·" badges');
  for (const retired of ['EXECUTIVE SUMMARY', 'BIGGEST WINS', 'DO THIS WEEK', 'DEEPER ANALYSIS', 'Upcoming events', 'Batsford: AM and PM', 'no sales in 14 days', 'Push these 3 this week', 'A · The website', 'G · Profit levers', 'Traditional SEO: ']) {
    assert.equal(html.includes(retired), false, retired);
  }
});

// ---- task 17 ----
test('17.14b: booked >= places is "Full" (over-subscribed is fine)', () => {
  assert.equal(fillLabel(5, 4), 'Full');
  assert.equal(fillLabel(4, 4), 'Full');
});

test('17.13: Nov target column = J × 12 × Nov weighting and sums to the seasonal £5,850', () => {
  const s = buildSalesTab({ targets: TARGETS, monthRows: [], gpRates: {}, asOfYmd: '2026-11-02' });
  assert.equal(s.categories.reduce((a, c) => a + c.target_month, 0), 5850);
  assert.equal(s.categories.find((c) => c.label === 'Courses/masterclasses').target_month, 799);
});

test('17.5/6: a changed basis withholds the delta and the gate labels it; same-basis implausible swing holds', () => {
  const rebuilt = backlinksComparable({ basis: { filters_version: 'v1', ingest: 'full', last_full_at: '2026-11-02T00:08Z' }, referring_domains: 422, backlinks: 2005 }, { referring_domains: 3032, backlinks: 4756 });
  assert.equal(rebuilt.ok, false);
  assert.match(rebuilt.reason, /rebuilt 2 Nov/);
  const tag = 'dfs_domain_backlink_rows:v1:live-full';
  const same = backlinksComparable({ basis: { tag }, referring_domains: 422, backlinks: 2005 }, { referring_domains: 3032, backlinks: 4756, index_basis: { tag } });
  assert.equal(same.implausible, true);
  assert.equal(seoHealthComparable({ score: 61, evaluated_urls: 478 }, { score: 100 }).ok, false);
  const base = { current: null, previous: null, rankingRows: [], shownFindings: [], steps: [] };
  const labelled = assessBriefGate({ ...base, blocks: { backlinks: { comparable: rebuilt }, seo_health: { comparable: { ok: true } } } }, { maxDialMoveShare: 1, maxTop10DropShare: 1, maxGoogleOwnerShare: 1, requiredSteps: [] });
  assert.equal(labelled.checks.find((c) => c.id === 'backlinks_swing').ok, true);
  assert.match(labelled.checks.find((c) => c.id === 'backlinks_swing').detail, /withheld and labelled/);
  const held = assessBriefGate({ ...base, blocks: { backlinks: { comparable: same }, seo_health: { comparable: { ok: true } } } }, { maxDialMoveShare: 1, maxTop10DropShare: 1, maxGoogleOwnerShare: 1, requiredSteps: [] });
  assert.equal(held.checks.find((c) => c.id === 'backlinks_swing').ok, false);
});

test('17.7/8: subtitles come from the figures; every hygiene fail is listed', () => {
  assert.equal(websiteSubtitle({ google_organic: { wow: { label: '▼ 16.5%' } }, direct: { wow: { label: '▲ 6.1%' } } }), 'Google organic ▼ 16.5% · direct ▲ 6.1% (last 28 days vs prior 28).');
  assert.match(backlinksSubtitle({ referring_domains: 422, wow: { referring_domains: { withheld: true, reason: 'index rebuilt' } } }), /week-on-week not shown: index rebuilt/);
  assert.equal(seoHealthSubtitle({ score: 61, hygiene: { fail: 2, warn: 16 } }), 'Health 61/100 · 2 hygiene fails, 16 warn.');
  assert.equal(openFailsText({ fail_rules: ['URL slug word count (3–6)', 'Thin content guardrail'] }), 'URL slug word count (3–6) · Thin content guardrail');
});

test('17.11: returning clients = last-12-month sales from clients first seen before the window; pace vs target', () => {
  const txns = [
    { client_name: 'A', txn_date: '2024-03-01', amount: 100 },
    { client_name: 'A', txn_date: '2026-06-01', amount: 300 },
    { client_name: 'B', txn_date: '2026-05-01', amount: 500 },
    { client_name: 'C', txn_date: '2025-01-10', amount: 50 },
    { client_name: 'C', txn_date: '2026-07-01', amount: 200, is_jlr: true }
  ];
  const r = returningClients(txns, new Date('2026-11-02T12:00:00Z'));
  assert.equal(r.r12, 300);
  assert.equal(r.yoy_ready, false);
  assert.equal(r.ytd, 300);
  assert.ok(r.pace > 350 && r.pace < 360);
});

test('17e: weeks running; Q2 sitemap lastmod; 17.3 house dates', () => {
  assert.equal(weeksRunning(null, '2026-11-09'), 1);
  assert.equal(weeksRunning({ first_seen_week: '2026-10-26', last_seen_week: '2026-11-02' }, '2026-11-09'), 3);
  assert.equal(weeksRunning({ first_seen_week: '2026-10-05', last_seen_week: '2026-10-12' }, '2026-11-09'), 1);
  const xml = '<url><loc>https://www.alanranger.com/free-online-photography-course</loc><changefreq>daily</changefreq><priority>0.75</priority><lastmod>2026-10-28</lastmod></url>';
  assert.equal(lastmodFromSitemap(xml, 'free-online-photography-course'), '2026-10-28');
  assert.equal(houseDates('since 2026-10-07 · 8/11 events ran'), 'since 7 Oct · 8/11 events ran');
});

// ---- QUESTION 2026-11-03 ----
test('backlinks basis tag: same tag compares; a different tag gives "—"', async () => {
  const { basisTag } = await import('../lib/ceo-weekly/backlink-basis.js');
  const tag = basisTag({ filters_version: 'v1', last_ingest_action: 'full' });
  assert.equal(tag, 'dfs_domain_backlink_rows:v1:live-full');
  const same = backlinksComparable({ basis: { tag }, referring_domains: 430, backlinks: 2010 }, { referring_domains: 422, backlinks: 2005, index_basis: { tag } });
  assert.equal(same.ok, true);
  const other = basisTag({ filters_version: 'v2', last_ingest_action: 'full' });
  const changed = backlinksComparable({ basis: { tag: other }, referring_domains: 430, backlinks: 2010 }, { referring_domains: 422, backlinks: 2005, index_basis: { tag } });
  assert.equal(changed.ok, false);
  assert.match(changed.reason, /basis changed/);
});

test('Sales tab: vouchers / Pick n Mix are cash in vs Inc target, transfers on their own grey line; totals reconcile', () => {
  const rows = [
    { month: 10, category_order: 8, revenue_amount: 1165 }, { month: 10, category_order: 9, revenue_amount: -745 },
    { month: 10, category_order: 4, revenue_amount: 286 }, { month: 10, category_order: 5, revenue_amount: -1020 }
  ];
  const s = buildSalesTab({ targets: TARGETS, monthRows: rows, gpRates: {}, asOfYmd: '2026-11-02' });
  const gv = s.categories.find((c) => c.label === 'Gift Vouchers (cash in)');
  assert.equal(gv.target_month, 100);
  assert.ok(gv.target_month > 0);
  const transfers = s.categories.filter((c) => c.transfer);
  assert.equal(transfers.length, 2);
  assert.ok(transfers.every((t) => t.ytd_pct == null && t.target_month < 0));
  assert.equal(s.categories.reduce((a, c) => a + c.target_month, 0), 5850);
  assert.equal(s.ytd_actual, 1165 - 745 + 286 - 1020);
  const html = renderCeoWeeklyHtml({ generated_at: '2026-11-02T14:42:00Z', strategy: { error: 'x' }, section_g: { error: 'x' }, sales_tab: s });
  assert.match(html, /redeemed into event categories \(bookkeeping transfer\)/);
  assert.doesNotMatch(html, /in − out/);
});

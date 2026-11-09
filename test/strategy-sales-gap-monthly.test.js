/**
 * Sales gap monthly tiles v2 (QUESTION-2026-11-09 (o)) + Strategy items 11 / 12 / 14 of (q): category rows add up to
 * the month totals, the non-dated figure matches the quarter tile, the per-event working moves to Rules (still in the
 * API), retired-from-promotion events stay in stock but are never recommended, and Q1 names October's shortfall.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { buildSalesGap, monthPipeline } from '../lib/strategy-sales-gap.mjs';
import { markRetired, withRetiredOverrides } from '../lib/strategy-promotion-flags.mjs';

const TODAY = '2026-11-09';
const LEAD = { day: { n: 120, q25_days: 19, median_days: 45, q75_days: 139 }, residential: { n: 17, q25_days: 31, median_days: 76, q75_days: 104 }, course: { n: 25, q25_days: 23, median_days: 36, q75_days: 63 } };
const FILL = { day: 0.559, residential: 0.563, course: 0.583, all: 0.563 };
const TARGETS = [4332, 2694, 1776, 3655, 4277, 4602, 3464, 2634, 4130, 5391, 5755, 5191];
const QUARTERS = [['q1', 'Q1 · Oct–Dec 2026', '2026-10-01', '2026-12-31'], ['q2', 'Q2 · Jan–Mar 2027', '2027-01-01', '2027-03-31'], ['q3', 'Q3 · Apr–Jun 2027', '2027-04-01', '2027-06-30'], ['q4', 'Q4 · Jul–Sep 2027', '2027-07-01', '2027-09-30']]
  .map(([key, label, start_date, end_date]) => ({ key, label, start_date, end_date }));
const BEGINNERS_URL = 'https://www.alanranger.com/beginners-photography-lessons/camera-courses-for-beginners-coventry-wc34j';
const EVENTS = [
  { eventKey: 'lake', date: '2027-01-22', title: 'Lake District Photography Workshop', type: 'residential', cap: 4, booked: 2, left: 2, price: 1075, booked_gbp: 2150 },
  { eventKey: 'macro', date: '2026-11-28', title: 'Abstract and Macro Photography Workshop', type: 'day', cap: 4, booked: 0, left: 4, price: 75 },
  { eventKey: 'walk', date: '2026-12-12', title: 'Woodland Photography Walk', type: 'walk', cap: 8, booked: 2, left: 6, price: 30 },
  { eventKey: 'ken', date: '2027-03-22', title: 'Long Exposure - Kenilworth 22/03', cap: 4, booked: 2, left: 2, price: 50 },
  { eventKey: 'beg', date: '2026-12-15', title: 'Camera Courses For Beginners - Week 1 of 3', type: 'course', cap: 4, booked: 1, left: 3, price: 150, url: BEGINNERS_URL },
  { eventKey: 'beg2', date: '2027-01-13', title: 'Camera Courses For Beginners - Week 1 of 3 - Jan', type: 'course', cap: 4, booked: 0, left: 4, price: 150 }
];
const txns = [{ txn_date: '2026-10-05', category_order: 2, amount: 3000 }, { txn_date: '2026-11-03', category_order: 3, amount: 250 }, { txn_date: '2025-11-10', category_order: 8, amount: 600 }, { txn_date: '2025-12-10', category_order: 7, amount: 300 }];
const FLAG = { event_key: `2026-12-15|/beginners-photography-lessons/camera-courses-for-beginners-coventry-wc34j`, event_date: '2026-12-15', event_title: 'Camera Courses For Beginners - Week 1 of 3', reason: 'Alan dropped December beginners promotion', set_by: 'Alan' };
const gap = (events, extra = {}) => buildSalesGap({ today: TODAY, txns, targets: TARGETS, events, fill: FILL, lead: LEAD, quarters: QUARTERS, ...extra });
const retiredEvents = () => {
  const rows = EVENTS.map((e) => ({ ...e }));
  assert.equal(markRetired(rows, [FLAG]), 1, 'the flag key = start date | page path (eventKeyOf)');
  return rows;
};
const sum = (rows, f) => rows.reduce((a, r) => a + r[f], 0);

function browser() {
  const ctx = { document: { addEventListener() {}, getElementById: () => null, querySelector: () => null }, setTimeout, console, Intl, Date, Math, Number, String, JSON, Promise };
  ctx.window = ctx;
  vm.runInNewContext(fs.readFileSync(new URL('../lib/strategy-sales-gap.js', import.meta.url), 'utf8'), ctx);
  return ctx;
}

test('monthly tiles: category rows sum to each month\'s totals (events / places / if all sold / likely)', () => {
  const g = gap(EVENTS);
  for (const m of g.months) {
    const c = m.categories;
    assert.deepEqual(c.rows.map((r) => r.label), ['Courses', 'One-day workshops', 'Residential']);
    assert.equal(sum(c.rows, 'events'), c.total.events);
    assert.equal(c.total.events, m.prime.events, `${m.label}: events = the prime-window list`);
    assert.equal(sum(c.rows, 'places'), m.prime.places);
    assert.ok(Math.abs(sum(c.rows, 'gbp') - m.prime.gbp) < 0.01);
    assert.ok(Math.abs(sum(c.rows, 'likely') - m.likely) < 0.01, `${m.label}: Likely £ column = the month's likely (all events on sale)`);
    assert.ok(Math.abs(c.total.likely - m.likely) < 0.01);
    assert.ok(c.adds_up);
    assert.deepEqual(c.rows.map((r) => r.fill), [FILL.course, FILL.day, FILL.residential]);
    assert.equal(c.total.fill, FILL.all);
  }
  const nov = g.months[0];
  for (const r of nov.categories.rows) {
    const ws = nov.working.filter((w) => w.type === r.key || (r.key === 'day' && !['course', 'residential'].includes(w.type)));
    assert.ok(Math.abs(r.likely - ws.reduce((a, w) => a + w.this_month_gbp, 0)) <= ws.length * 0.5 + 0.01, `${r.label}: Likely £ = the per-event working (this_month_gbp)`);
  }
});

test('monthly tiles: non-dated needed matches the quarter tile\'s Nov / Dec / Jan row', () => {
  const g = gap(EVENTS);
  g.months.forEach((m, i) => assert.equal(m.non_dated_needed, g.rolling.non_dated.months[i].gbp, m.label));
  const w = browser();
  const h = w.stSalesGapHtml({ sales_gap: g }).tiles;
  const k1 = (v) => `£${(Math.round(v / 100) / 10).toFixed(1)}k`;
  for (const m of g.months) {
    const tile = h.slice(h.indexOf(`data-sg-month="${m.key}"`), h.indexOf('</details></div>', h.indexOf(`data-sg-month="${m.key}"`)));
    assert.ok(tile.includes(`<div class="sg-mnd"><span>Non-dated needed</span><b>${k1(m.non_dated_needed)}</b></div>`), m.label);
  }
});

test('monthly tile v2 face: table + total, non-dated, pipeline line, simple details; working moved to Rules (still in the API)', () => {
  const g = gap(EVENTS);
  const w = browser();
  const h = w.stSalesGapHtml({ sales_gap: g }).tiles;
  const nov = h.slice(h.indexOf('data-sg-month="2026-11"'), h.indexOf('data-sg-month="2026-12"'));
  assert.match(nov, /November[\s\S]*21 days left/);
  assert.match(nov, /sg-big">£5\.5k <span class="sg-u">of £5,755 still to sell · £250 sold</);
  assert.match(nov, /sg-bar[\s\S]*£5\.3k non-dated/);
  const live = browser().stSalesGapHtml({ sales_gap: { ...g, months: [{ ...g.months[0], still_to_sell: 5505, likely: 1806, non_dated_needed: 3699 }, ...g.months.slice(1)] } }).tiles;
  assert.match(live.slice(live.indexOf('data-sg-month="2026-11"')), /^[^]*?sg-bar"><span class="sg-b1" style="width:33%">£1\.8k likely dated<\/span><span class="sg-b2" style="width:67%">£3\.7k non-dated</, 'bar labels as in the mock-up');
  assert.match(nov, /Events people book this month <span class="sg-u">\(prime buying window\)[\s\S]*Category[\s\S]*Events[\s\S]*Places[\s\S]*If all sold[\s\S]*Fill rate[\s\S]*Likely £/);
  assert.match(nov, /Courses[\s\S]*One-day workshops[\s\S]*Residential[\s\S]*sg-qtot[\s\S]*Total/);
  assert.match(nov, /From gift vouchers, Pick n Mix, 1-2-1s, mentoring, Academy, commissions, prints &amp; royalties\./);
  assert.match(nov, /Prospects pipeline:<\/b> £0 weighted, cash due this month/);
  assert.match(nov, /<summary>details<\/summary>[\s\S]*Events to push this month[\s\S]*Booked ahead for this month's events[\s\S]*Normal non-dated sales, same month last year[\s\S]*Still to find after normal and pipeline/);
  assert.doesNotMatch(nov, /sg-v|sg-from|damping|outside the prime window|events &amp; working/, 'verdict box, "from … +N more" and the working are off the tile');
  const dec = h.slice(h.indexOf('data-sg-month="2026-12"'), h.indexOf('data-sg-month="2027-01"'));
  assert.match(dec, /sg-big">£[\d.]+k <span class="sg-u">still to sell</, 'future months: no "of target · sold"');
  const rules = h.slice(h.indexOf('id="sg-rules"'));
  assert.match(rules, /Show the working[\s\S]*November: working[\s\S]*damping[\s\S]*On-sale stock outside the prime window/);
  assert.ok(g.months.every((m) => m.working.length && m.outside && m.working[0].split), 'the working stays in the strategy-summary API');
  assert.match(w.stSalesGapHtml({ sales_gap: { ...g, months: g.months.map((m) => ({ ...m, pipeline_month: { error: 'x' } })) } }).tiles, /Prospects pipeline:<\/b> unavailable/);
});

test('(s) monthly "If all sold": ⓘ tooltip on the header (hover / tap) + the same text as the Total cell title; quarter tile unchanged', () => {
  const g = gap(EVENTS);
  const stock = `£${(Math.round(g.rolling.stock.gbp / 100) / 10).toFixed(1)}k`;
  const TIP = `Full-price value of the unsold places on the events people normally book this month. The same event can be in its buying window in more than one month, so these figures overlap and don't add up to the quarter's ${stock} stock.`;
  const w = browser();
  const h = w.stSalesGapHtml({ sales_gap: g }).tiles;
  const q = h.slice(h.indexOf('sg-card sg-q'), h.indexOf('data-sg-month'));
  assert.doesNotMatch(q, /data-sg-tip|title="/, 'quarter tile: no tooltip (its If all sold is the true total)');
  assert.equal((h.match(/data-sg-tip /g) || []).length, 3, 'one ⓘ per monthly tile');
  for (const m of g.months) {
    const tile = h.slice(h.indexOf(`data-sg-month="${m.key}"`), h.indexOf('</table>', h.indexOf(`data-sg-month="${m.key}"`)));
    assert.ok(tile.includes(`<th>If all sold <span class="sg-tip" data-sg-tip tabindex="0" role="button" aria-label="What If all sold means" aria-expanded="false">ⓘ<span class="sg-tipb" role="tooltip">${TIP}</span></span></th>`), `${m.label}: header ⓘ with the exact text`);
    assert.ok(tile.includes(`<tr class="sg-qtot"><td class="left">Total</td><td>${m.categories.total.events}</td><td>${m.categories.total.places}</td><td title="${TIP}">`), `${m.label}: Total "If all sold" cell title`);
    assert.equal((tile.match(/title="/g) || []).length, 1, `${m.label}: only the Total cell carries the title`);
  }
  assert.match(h, /\.sg-tip:hover \.sg-tipb, \.sg-tip:focus-visible \.sg-tipb, \.sg-tip\.sg-open \.sg-tipb \{ display: block; \}/, 'hover, keyboard focus and tap (sg-open)');
  const live = browser().stSalesGapHtml({ sales_gap: { ...g, rolling: { ...g.rolling, stock: { ...g.rolling.stock, gbp: 55028 } } } }).tiles;
  assert.match(live, /don't add up to the quarter's £55\.0k stock\./, 'the quarter stock figure from the live model (£55.0k today)');
});

test('(s) tap toggles the tooltip open / closed; a click elsewhere closes it', () => {
  const listeners = [];
  const tip = { cls: new Set(), attrs: {}, classList: null, setAttribute(k, v) { this.attrs[k] = v; } };
  tip.classList = { toggle: (c) => (tip.cls.has(c) ? (tip.cls.delete(c), false) : (tip.cls.add(c), true)), remove: (c) => tip.cls.delete(c) };
  const ctx = { document: { addEventListener: (t, f) => listeners.push(f), getElementById: () => null, querySelectorAll: () => (tip.cls.has('sg-open') ? [tip] : []) }, console, Intl, Date, Math, Number, String, JSON, Promise };
  ctx.window = ctx;
  vm.runInNewContext(fs.readFileSync(new URL('../lib/strategy-sales-gap.js', import.meta.url), 'utf8'), ctx);
  const click = (target) => listeners.forEach((f) => f({ target: { closest: (sel) => (sel === '[data-sg-tip]' ? target : null) }, preventDefault() {} }));
  click(tip);
  assert.ok(tip.cls.has('sg-open'));
  assert.equal(tip.attrs['aria-expanded'], 'true');
  click(tip);
  assert.ok(!tip.cls.has('sg-open'), 'second tap closes');
  click(tip);
  click(null);
  assert.ok(!tip.cls.has('sg-open'), 'a tap elsewhere closes');
  assert.equal(tip.attrs['aria-expanded'], 'false');
});

test('monthly pipeline line reads pipeline_by_month; missing fields are £0; a failed read is an error', () => {
  assert.deepEqual(monthPipeline(undefined, null), { weighted: 0, dated: 0, undated: 0, overdue: 0 });
  assert.deepEqual(monthPipeline({ total: 530, cats: {} }, { total: 1410 }), { weighted: 530, dated: 0, undated: 0, overdue: 0 });
  assert.deepEqual(monthPipeline({ total: 1 }, { error: 'boom' }), { error: 'boom' });
  const g = gap(EVENTS, { pipeline: { '2026-12': { total: 880, cats: {} } } });
  assert.deepEqual(g.months.map((m) => m.pipeline_month.weighted), [0, 880, 0]);
});

test('item 11: a retired-from-promotion event is excluded from lever 1 and "Events to push" but stays in stock', () => {
  const plain = gap(EVENTS);
  const g = gap(retiredEvents(), { promotion: { flags: [FLAG], matched: 1, error: null } });
  const lever1 = (x) => x.remedy.rows.flatMap((r) => r.lever1.rows).map((r) => r.date);
  assert.ok(lever1(plain).includes('2026-12-15'), 'without the flag lever 1 recommends it');
  assert.ok(!lever1(g).includes('2026-12-15'), 'retired: never recommended');
  assert.ok(lever1(g).includes('2027-01-13'), 'the January beginners course is not retired');
  const pushed = g.months.flatMap((m) => m.push.groups.flatMap((x) => x.list)).map((e) => e.date);
  assert.ok(!pushed.includes('2026-12-15'));
  assert.ok(g.months.some((m) => m.push.retired.some((e) => e.date === '2026-12-15')), 'listed as not pushed');
  for (const [a, b] of plain.months.map((m, i) => [m, g.months[i]])) {
    assert.deepEqual(b.categories, a.categories, `${a.label}: stock, places, if all sold and likely unchanged`);
    assert.equal(b.likely, a.likely);
    assert.equal(b.prime.events, a.prime.events);
  }
  assert.deepEqual(g.rolling.stock, plain.rolling.stock, 'still in the quarter stock');
  assert.ok(g.months.flatMap((m) => m.prime.list).some((e) => e.date === '2026-12-15' && e.retired_from_promotion), 'still on sale, marked');
  assert.deepEqual(g.remedy.retired.map((e) => e.date), ['2026-12-15']);
  assert.equal(g.promotion.flags[0].event_key, FLAG.event_key);
  const html = browser().stSalesGapHtml({ sales_gap: g }).remedy;
  assert.match(html, /Retired from promotion \(Alan\), not recommended: Camera Courses For Beginners 15 Dec\. Still in stock and on sale\./);
});

test('item 11: campaign overrides read a retired event as "don\'t promote" (offer fields kept)', () => {
  const o = withRetiredOverrides({ [FLAG.event_key]: { event_key: FLAG.event_key, promote_mode: 'weekly', offer_note: '£20 off' }, other: { promote_mode: 'normal' } }, [FLAG]);
  assert.equal(o[FLAG.event_key].promote_mode, 'dont_promote');
  assert.equal(o[FLAG.event_key].offer_note, '£20 off');
  assert.equal(o.other.promote_mode, 'normal');
  assert.equal(withRetiredOverrides({}, [FLAG])[FLAG.event_key].promote_mode, 'dont_promote', 'no override row yet');
  const sql = fs.readFileSync(new URL('../migrations/strategy_event_promotion_flags_20261109.sql', import.meta.url), 'utf8');
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public\.strategy_event_promotion_flags from anon, authenticated/);
  assert.match(sql, /2026-12-01\|\/beginners-photography-lessons\/camera-courses-for-beginners-coventry-wc34j/);
});

test('item 12: heading "Rolling 3 months"; quarter cards keep calendar quarters', () => {
  const g = gap(EVENTS);
  const h = browser().stSalesGapHtml({ sales_gap: g });
  assert.match(h.tiles, /<h3>Sales gap · Rolling 3 months: where the money has to come from/);
  assert.doesNotMatch(h.tiles, /Sales gap this quarter/);
  assert.deepEqual(g.quarters.map((q) => [q.start, q.end]), QUARTERS.map((q) => [q.start_date, q.end_date]));
  assert.deepEqual(g.quarters.map((q) => q.period.name), ['Q1 Oct–Dec', 'Q2 Jan–Mar', 'Q3 Apr–Jun', 'Q4 Jul–Sep']);
});

test('item 14: Q1 "incl. October shortfall" vs "Nov + Dec"; the Remedy plan does not carry October forward; targets unchanged', () => {
  const g = gap(EVENTS);
  const q1 = g.quarters[0];
  const oct = TARGETS[9] - 3000;
  assert.equal(q1.period.shortfall, oct);
  assert.deepEqual(q1.period.shortfall_months, ['October']);
  assert.deepEqual(q1.period.forward_months, ['Nov', 'Dec']);
  assert.equal(q1.period.forward_still, g.months[0].still_to_sell + g.months[1].still_to_sell);
  assert.ok(Math.abs(q1.still_to_sell - q1.period.shortfall - q1.period.forward_still) < 0.01, 'Q1 still to sell = October shortfall + Nov + Dec');
  assert.equal(q1.target, TARGETS[9] + TARGETS[10] + TARGETS[11], 'no target change');
  assert.deepEqual(g.remedy.not_carried, { quarter: 'Q1 Oct–Dec', months: ['October'], gbp: oct });
  const h = browser().stSalesGapHtml({ sales_gap: g });
  assert.match(h.quarters, /Still to sell · Q1 Oct–Dec incl\. October shortfall £2\.4k/);
  assert.match(h.quarters, /Nov \+ Dec still to sell <span class="rt-sub">\(forward plan\)<\/span>/);
  assert.match(h.remedy, /October's shortfall \(£2\.4k, in the Q1 Oct–Dec card\) is not carried into this forward plan/);
  assert.ok(g.quarters.slice(1).every((q) => q.period.forward_still == null), 'future quarters: no split');
});

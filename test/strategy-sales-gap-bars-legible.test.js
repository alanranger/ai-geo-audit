/**
 * QUESTION-2026-11-09 (ee): every bar on all 4 tiles is 28px with 14px bold values (dark on blue / green / purple, white
 * with a shadow on the striped prospects segment); "still to find" is bold 14px amber, centred on a faint amber tint
 * with the dashed border, and never truncated (outside the bar's right end when the segment is under 40px); other narrow
 * segments show no text; the coverage key is 12px #c3c9d4.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { buildSalesGap, monthsFrom } from '../lib/strategy-sales-gap.mjs';
import { quarterFeedOf, summarizeProspects } from '../lib/strategy-prospects.mjs';

const TODAY = '2026-11-09';
const LEAD = { day: { n: 120, q25_days: 19, median_days: 45, q75_days: 139 }, residential: { n: 17, q25_days: 31, median_days: 76, q75_days: 104 }, course: { n: 25, q25_days: 23, median_days: 36, q75_days: 63 } };
const FILL = { day: 0.559, residential: 0.563, course: 0.583, all: 0.563 };
const prospects = summarizeProspects({ rows: [], config: [], history: [], today: TODAY, months: monthsFrom(TODAY, 3) });
const g = buildSalesGap({ today: TODAY, txns: [{ txn_date: '2025-11-10', category_order: 8, amount: 600 }], targets: Array(12).fill(3000), events: [{ eventKey: 'lake', date: '2027-01-22', title: 'Lake District Photography Workshop', type: 'residential', cap: 4, booked: 2, left: 2, price: 1075 }], fill: FILL, lead: LEAD, pipeline: prospects.by_month, pipeline_open: quarterFeedOf(prospects), prospects });

function browser() {
  const ctx = { document: { addEventListener() {}, getElementById: () => null, querySelector: () => null }, console, Intl, Date, Math, Number, String, JSON, Promise, Object };
  ctx.window = ctx;
  vm.runInNewContext(fs.readFileSync(new URL('../lib/strategy-sales-gap.js', import.meta.url), 'utf8'), ctx);
  return ctx;
}
/** Every declaration block for a selector (a selector may appear in more than one rule). */
const css = (h, sel) => [...h.matchAll(new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`, 'g'))].map((m) => m[1]).join(' ');

test('styles: both bars 28px, 14px bold dark values; prospects white + shadow; still to find amber, centred, tinted, dashed; key 12px #c3c9d4', () => {
  const h = browser().stSalesGapHtml({ sales_gap: g }).tiles;
  for (const sel of ['.sg-bar', '.sg-covbar']) {
    const r = css(h, sel);
    assert.match(r, /height: 28px/, `${sel} 28px`);
    assert.match(r, /font-size: 14px; font-weight: 700; line-height: 28px; color: #0b0e14/, `${sel} 14px bold dark`);
  }
  assert.match(css(h, '.sg-s-pr'), /color: #fff; text-shadow: 0 1px 2px rgba\(0, 0, 0, 0\.75\)/);
  const gap = css(h, '.sg-covbar .sg-s-gap, .sg-gapout');
  assert.match(gap, /background: rgba\(240, 180, 41, 0\.12\); border: 1\.5px dashed #f0b429; color: #f0b429; font-size: 14px; font-weight: 700; text-align: center/);
  assert.match(css(h, '.sg-covkey'), /font-size: 12px; color: #c3c9d4/);
});

test('markup: every segment carries its value; still to find has an outside label (hidden until it is needed)', () => {
  const h = browser().stSalesGapHtml({ sales_gap: g }).tiles;
  assert.equal((h.match(/<div class="sg-covrow"><div class="sg-covbar">/g) || []).length, 4, 'all 4 tiles');
  const nov = h.slice(h.indexOf('data-sg-month="2026-11"'), h.indexOf('data-sg-month="2026-12"'));
  const find = `£${(Math.round(g.cover.months[0].still_to_find / 100) / 10).toFixed(1)}k`;
  assert.ok(nov.includes(`data-full="${find}">${find}</span></div><span class="sg-gapout" title="Still to find ${find}" hidden>${find}</span>`), 'gap value inside + the hidden outside label');
  assert.match(nov, /<span class="sg-b1" style="width:\d+%" data-full="£[\d.]+k likely dated" data-short="£[\d.]+k">/);
});

/** A fake segment: text width = 8px per character; clientWidth = the segment's width. */
function seg(width, full, short) {
  const el = { dataset: { full, short }, clientWidth: width, _t: '' };
  Object.defineProperty(el, 'textContent', { get() { return this._t; }, set(v) { this._t = v; } });
  Object.defineProperty(el, 'scrollWidth', { get() { return Math.max(this.clientWidth, this._t.length * 8); } });
  return el;
}
test('narrow segments: full label, else the £ alone, else no text (never a cut-off value)', () => {
  const { fitText } = browser().stSalesGapFit;
  const wide = seg(200, '£8.3k likely dated', '£8.3k');
  fitText(wide);
  assert.equal(wide.textContent, '£8.3k likely dated');
  const mid = seg(60, '£1.7k likely dated', '£1.7k');
  fitText(mid);
  assert.equal(mid.textContent, '£1.7k');
  const tiny = seg(20, '£15', '£15');
  fitText(tiny);
  assert.equal(tiny.textContent, '', 'no text inside the bar; the key line gives the value');
});

test('still to find: inside and centred when the segment is ≥ 40px and fits; otherwise just outside the bar (never truncated)', () => {
  const { fitGap } = browser().stSalesGapFit;
  const row = (width) => {
    const gap = seg(width, '£0.7k', '£0.7k');
    const out = { hidden: true };
    return { gap, out, querySelector: (s) => (s === '.sg-s-gap' ? gap : out) };
  };
  const wide = row(80);
  fitGap(wide);
  assert.deepEqual([wide.gap.textContent, wide.out.hidden], ['£0.7k', true]);
  const narrow = row(38);
  fitGap(narrow);
  assert.deepEqual([narrow.gap.textContent, narrow.out.hidden], ['', false], 'under 40px: the value moves outside the bar');
});

/**
 * Correction 2 (8 Nov 2026): the quarter plan's long paragraphs sit behind an ⓘ, and each initiative shows exactly
 * title + chip · Target / Actual / Gap · Next → Marketing; everything else is inside its closed "details" expander.
 * The Q1 / Q2 KPI boxes stay.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function render(d) {
  const win = { addEventListener() {} };
  const doc = { addEventListener() {}, getElementById: () => ({}), createElement: () => ({}), head: { appendChild() {} } };
  const ctx = { window: win, document: doc, console, Date, Math, Number, String, JSON, Set, Map, Intl };
  win.window = win;
  vm.runInNewContext(fs.readFileSync(new URL('../lib/strategy-quarter-plan.js', import.meta.url), 'utf8'), ctx);
  return win.stQuarterPlanHtml(d);
}
const GIFTS = {
  key: 'q1-gifts', kind: 'initiative', title: 'Christmas gifts', summary: 'A long description that used to be visible on the card.', owner: 'GPT', owner_detail: 'GPT (gift story)',
  status: { label: 'Needs review', rag: 'grey' }, revenue: { target: 2100, actual: 0, actual_complete: false, unknown: ['Gift 1-to-1 sales'], gap: 2100, window: { end: '2026-12-31' }, owner: 'GPT' },
  next: { source: 'plan', day: '2026-11-17', text: 'FB/IG draft: A photography gift without guessing the equipment' },
  measure: { kind: 'gift', target_total: 2100, window: { start: '2026-11-01', end: '2026-12-31' }, target_lines: [{ label: 'Gift voucher issue receipts', amount: 1100, actual: 0 }], stretch: { label: 'Stretch', lines: [{ amount: 1500 }] }, baselines: [{ label: 'Context', values: [{ year: 2025, amount: 900 }], note: 'last year' }], approved: { by: 'Alan', at: '2026-11-08T12:00:00Z' } },
  campaigns: [], deliveries: [], actions: [], assets: []
};
const WORK = { ...GIFTS, key: 'q1-work', title: 'Near-term workshops', summary: 'Workshop text.', revenue: { target: null, owner: 'GPT (targeting)' }, measure: { kind: 'dated', lines: [] }, next: { source: 'manual', day: '2026-11-16', text: 'Review' } };
const PLAN = { quarter_plan: { as_of: '2026-11-08', quarters: [{ key: 'q1', label: 'Q1 · Oct–Dec 2026', state: 'current', display: 'full', start_date: '2026-10-01', end_date: '2026-12-31', theme: 'Fill dates', initiative_keys: ['q1-gifts', 'q1-work'], kpis: [{ key: 'sales', label: 'Sales still needed', value: '£10.7k' }], programme_key: null, housekeeping_key: null }], initiatives: { 'q1-gifts': GIFTS, 'q1-work': WORK } }, actions: [] };

test('quarter plan: no visible intro / footer paragraph (behind ⓘ); KPI boxes kept', () => {
  const html = render(PLAN);
  assert.doesNotMatch(html, /class="qp-intro"|class="qp-foot"/);
  assert.match(html, /<h3>Quarter plan <span class="qp-info" title="Objective → initiative[^"]*RAG = against a dated target/);
  assert.match(html, /class="qp-kpis"><div class="qp-kpi"[^>]*><div class="qp-kl">Sales still needed/);
});

test('initiative: exactly title + chip · Target / Actual / Gap · Next → Marketing visible; description, stretch, baselines, approval inside the closed details', () => {
  const html = render(PLAN);
  const gifts = html.slice(html.indexOf('id="qp-ini-q1-gifts"'), html.indexOf('id="qp-ini-q1-work"'));
  const visible = gifts.slice(0, gifts.indexOf('<details class="qp-links"'));
  assert.equal((visible.match(/class="qp-l"/g) || []).length, 2);
  assert.match(visible, /Target <b>£2,100<\/b> · Actual <b>≥ £0<\/b> · Gap <b>≤ £2,100<\/b>/);
  assert.match(visible, /Next: FB\/IG draft: A photography gift without guessing the equipment · <span[^>]*>Tue 17 Nov<\/span> <a [^>]*data-goto-marketing[^>]*>→ Marketing<\/a>/);
  assert.doesNotMatch(visible, /long description|Stretch|Context only|approved by/);
  const det = gifts.slice(gifts.indexOf('<details class="qp-links"'));
  assert.match(det, /^<details class="qp-links" data-ini="q1-gifts">/, 'closed by default');
  assert.match(det, /long description[\s\S]*Approved base target £2,100[\s\S]*approved by Alan[\s\S]*Stretch: £1,500[\s\S]*Context only/);
  const work = html.slice(html.indexOf('id="qp-ini-q1-work"'));
  assert.match(work, /Target — · Actual — · Gap — <span class="qp-ref">· owner GPT \(targeting\)<\/span>/);
  assert.match(work, /Next: Review · <span[^>]*>Mon 16 Nov<\/span> <span class="qp-ref">\(manual\)<\/span>/);
});

test('item 14 tail: the Quarter plan sales box names the months it covers ("Nov + Dec"), apart from the Q1 card incl. October shortfall', () => {
  const kpis = [{ key: 'sales', label: 'Sales still needed', value: '£10.7k', sub: 'to 31 Dec · Nov £5.5k left + Dec £5.2k' }];
  const html = render({ ...PLAN, quarter_plan: { ...PLAN.quarter_plan, quarters: [{ ...PLAN.quarter_plan.quarters[0], kpis }] } });
  assert.match(html, /<div class="qp-kl">Sales still needed · Nov \+ Dec<\/div><div class="qp-kv">£10\.7k<\/div>/);
  const future = render({ ...PLAN, quarter_plan: { ...PLAN.quarter_plan, quarters: [{ ...PLAN.quarter_plan.quarters[0], kpis: [{ key: 'sales', label: 'Sales target Jan–Mar', value: '£20k', sub: 'to 31 Mar · Jan £6k + Feb £7k + Mar £7k' }] }] } });
  assert.match(future, /<div class="qp-kl">Sales target Jan–Mar<\/div>/, 'only the current quarter\'s "still needed" box is relabelled');
});

test('item 13 (browser guard): "Next" never says "draft" when the status says scheduled or approved', () => {
  const gifts = { ...GIFTS, next: { ...GIFTS.next, status: { code: 'scheduled', label: 'Scheduled on platform', icon: '🕒' }, status_line: '🕒 Scheduled on platform · Facebook Tue 17 Nov 6:30pm' } };
  const html = render({ ...PLAN, quarter_plan: { ...PLAN.quarter_plan, initiatives: { ...PLAN.quarter_plan.initiatives, 'q1-gifts': gifts } } });
  assert.match(html, /Next: FB\/IG: A photography gift without guessing the equipment · <span[^>]*>🕒 Scheduled on platform/);
  assert.doesNotMatch(html, /FB\/IG draft: A photography gift/);
});

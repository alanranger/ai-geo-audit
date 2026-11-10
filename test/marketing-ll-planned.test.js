/**
 * QUESTION-2026-11-10 light-and-logic-not-on-hold: Light & Logic editions (and their promotion placeholders) are
 * PLANNED — content to prepare (Alan, 10 Nov), not on hold. GPT's step record starts "PLANNED"; every view shows
 * "Planned — content to prepare" and counts it as planned / draft, never scheduled; no "On hold" text anywhere.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { HOLDS, PLANNED_LABEL, isPlannedRecord } from '../lib/marketing/delivery-status.mjs';
import { fallbackStatus } from '../lib/strategy-delivery-status.mjs';

const BRIEF = 'PLANNED — content to prepare with Alan. Monthly edition on the 15th. Alan clarified 10 November: previous hold applied to drafting only, not the schedule.';
const PROMO = 'PLANNED PLACEHOLDER — content and publishing time to agree with Alan when preparing the monthly edition.';
const ctxOf = (win) => vm.createContext({ window: win, document: { getElementById: () => null, addEventListener: () => {}, createElement: () => ({}), head: { appendChild: () => {}, insertAdjacentHTML: () => {} }, dispatchEvent: () => {}, querySelector: () => null }, localStorage: win.localStorage, CustomEvent: class {}, Intl, Date, Number, String, Map, Set, JSON, Math, Promise, Array, Object, RegExp, console, encodeURIComponent, setTimeout, MutationObserver: class { observe() {} } });
function load(files) {
  const win = { localStorage: { getItem: () => null, setItem: () => {} } };
  const c = ctxOf(win);
  for (const f of files) vm.runInContext(fs.readFileSync(new URL(f, import.meta.url), 'utf8'), c);
  return win;
}

test('server: no hold; GPT\'s PLANNED record = "Planned — content to prepare" (in preparation, never scheduled)', () => {
  assert.deepEqual(HOLDS, []);
  assert.ok(isPlannedRecord({ brief: BRIEF }) && isPlannedRecord({ brief: PROMO }) && !isPlannedRecord({ brief: 'DRAFT — Alan review required' }));
  const s = fallbackStatus({ key: 'gpt-ll-newsletter-2026-11-15', day: '2026-11-15', brief: BRIEF, draft: true });
  assert.deepEqual([s.code, s.label, s.when], ['in_preparation', PLANNED_LABEL, 'Planned Sun 15 Nov']);
});

test('List + grids: the edition and its promotion placeholder read "Planned — content to prepare"; no "On hold" text', () => {
  const win = load(['../lib/marketing-schedule-model.js', '../lib/marketing-delivery.js', '../lib/marketing-schedule-list.js']);
  const steps = [
    { key: 'gpt-ll-newsletter-2026-11-15', channel: 'LinkedIn', step: 'Light & Logic newsletter (LinkedIn) · November edition', day: '2026-11-15', scheduled_day: '2026-11-15', brief: BRIEF, state: { status: 'pending' } },
    { key: 'gpt-ll-promotion-2026-11-15', channel: 'Facebook + Instagram', step: 'Light & Logic · November edition social promotion', day: '2026-11-15', scheduled_day: '2026-11-15', brief: PROMO, state: { status: 'pending' } }
  ];
  const items = win.mkDeliveryItems({ meter: { deliveries: [], step_tags: {} } }, { campaign: { weeks: [{ week: '2026-11-09', steps }], ticks: {}, campaigns: [] } });
  assert.ok(items.filter((x) => /gpt-ll-/.test(x.key)).every((x) => x.planned_record === true));
  const m = win.mkScheduleModel.build({ items, today: '2026-11-10' });
  const L = win.mkScheduleList;
  const env = { board: { placements: [], emails: [], tasks: [], holds: [] }, promotions: [] };
  env.status = (x) => L.statusOf(x, env);
  const ll = m.items.filter((x) => /gpt-ll-/.test(x.step_key || ''));
  assert.equal(ll.length, 2);
  assert.ok(ll.every((x) => env.status(x).label === PLANNED_LABEL && env.status(x).code === 'in_preparation'), 'planned, not scheduled');
  const html = L.listHtml(m, { range: { from: '2026-11-09', to: '2026-11-15' }, channel: 'all' }, env);
  assert.equal((html.match(/Planned — content to prepare/g) || []).length, 2);
  assert.ok(!/On hold|on hold/.test(html), 'no "On hold" text');
  assert.equal((html.match(/LinkedIn · Light &amp; Logic newsletter · GPT prepares, Alan approves/g) || []).length, 1, 'only the edition row is the LinkedIn newsletter');
  assert.match(html, /Light &amp; Logic · November edition social promotion<\/b><small>Facebook · Instagram · Story/, 'the promotion placeholder is a Facebook + Instagram post row');
});

test('Campaign steps: "Planned — content to prepare" · owner GPT, no tick; counted as planned (not to do, not scheduled)', () => {
  const win = load(['../lib/strategy-board.js']);
  const step = { key: 'gpt-ll-newsletter-2026-11-15', channel: 'LinkedIn', step: 'Light & Logic newsletter (LinkedIn) · November edition', day: '2026-11-15', scheduled_day: '2026-11-15', brief: BRIEF, featured: [], covers: [], state: { status: 'pending', resolved: false } };
  const data = { campaign: { weeks: [{ week: '2026-11-09', steps: [step] }], carried: { late: [], older: [] }, ticks: {}, campaigns: [], sends: {}, step_status: {}, rules: { email: { day: 'Thu' }, facebook_instagram: { days: ['Tue'] }, linkedin: { days: ['Wed'] } } },
    delivery_status: { by_key: {}, holds: [] }, actions: [] };
  const h = { dataset: {}, innerHTML: '' };
  win.mountMarketingCampaign(h, data);
  assert.match(h.innerHTML, /st-chip-wrap"[^>]*>Planned — content to prepare<\/span><div class="st-chip-by">owner GPT/);
  assert.ok(!/st-mo-tick|On hold/.test(h.innerHTML));
  const n = win.stStepViews().counts;
  assert.deepEqual([n.planned, n.to_do, n.scheduled, n.on_hold], [1, 0, 0, 0]);
  assert.match(h.innerHTML, /1 planned \(content to prepare\)/);
});

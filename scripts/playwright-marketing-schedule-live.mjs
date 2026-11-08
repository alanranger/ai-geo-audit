/**
 * Live test of the Marketing schedule (after deploy). Nothing is written: every non-GET to strategy-ticks /
 * strategy-campaigns is intercepted in the browser, its body recorded and a fake OK returned (dry run).
 *   node scripts/playwright-marketing-schedule-live.mjs
 * Checks: Days ⇄ Weeks toggle and side panel at 1600 / 1280; Done / Skip / Move from the side panel send the same
 * request body as the old campaign-steps table (columns derived with the endpoint's own patchFor / patchedRows);
 * the w/c 9 Nov email count; a browser-only duplicate fixture on the Norfolk 8 Nov pair. People are blurred.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { patchFor, patchedRows } from '../api/aigeo/strategy-ticks.js';

const BASE = process.env.DASH_BASE || 'https://ai-geo-audit.vercel.app';
const OUT = path.resolve('outputs');
const key = fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).find((l) => l.startsWith('ARP_ADMIN_KEY=')).slice(14).replace(/^"|"$/g, '').trim();
const BLUR = '#mk-review-table td:first-child, #mk-cust-body, .mk-detail, #mk-cleanup table td.left, #mk-query table td:first-child, #mk-client-health table td:first-child, #mk-exp-review, #mk-snap-review { filter: blur(6px) !important; }';
const STEPS = {
  done: 'step|2026-11-02|LinkedIn|2026-11-04',
  skip: 'step|2026-11-02|Outlook personal notes|2026-11-02',
  move: 'step|2026-11-02|Facebook + Instagram|2026-11-03'
};
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const errors = [];
const writes = [];
let source = 'none';

async function dryRun(page) {
  for (const pattern of ['**/api/aigeo/strategy-ticks*', '**/api/aigeo/strategy-campaigns*']) {
    await page.route(pattern, (route) => {
      const req = route.request();
      if (req.method() === 'GET') return route.continue();
      writes.push({ source, url: new URL(req.url()).pathname, method: req.method(), body: JSON.parse(req.postData() || '{}') });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, written: 0, set_by: 'DRY RUN (not saved)', stage_history: [] }) });
    });
  }
}

async function openTab(browser, width, extra) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  page.on('pageerror', (e) => errors.push(`${width}: ${e.message}`));
  await page.addInitScript((k) => sessionStorage.setItem('arp_admin_key', k), key);
  await dryRun(page);
  if (extra) await extra(page);
  await page.goto(`${BASE}/audit-dashboard.html#marketing`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#mk-schedule .mks-grid', { timeout: 120000 });
  await page.waitForSelector('#mk-campaign-host #st-campaign-table', { state: 'attached', timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(4000);
  await page.addStyleTag({ content: BLUR });
  return page;
}

async function viewsAndShots(page, width) {
  const v = await page.evaluate(() => [...document.querySelectorAll('script[src*="marketing-schedule"]')].map((s) => s.getAttribute('src')));
  check(`${width}: deployed schedule scripts`, v.length === 2 && v.every((s) => s.includes('sched-20261108a')), v.join(' '));
  const sched = page.locator('#mk-schedule');
  await sched.screenshot({ path: `${OUT}/marketing-schedule-days-live-${width}px-20261108.png` });
  await page.click('#mk-schedule [data-mks-view="weeks"]');
  check(`${width}: toggle Days → Weeks`, await page.waitForSelector('#mk-schedule .mks-weeks', { timeout: 10000 }).catch(() => null));
  await sched.screenshot({ path: `${OUT}/marketing-schedule-weeks-live-${width}px-20261108.png` });
  const n9 = await page.locator('#mk-schedule tr', { has: page.locator('[data-mks-week="2026-11-09"]') }).locator('.mks-n').textContent().catch(() => '');
  await page.click('#mk-schedule [data-mks-view="days"]');
  check(`${width}: toggle Weeks → Days`, await page.waitForSelector('#mk-schedule .mks-days', { timeout: 10000 }).catch(() => null));
  await page.locator('#mk-schedule .mks-card[data-mks-item]').first().click();
  check(`${width}: card opens the side panel`, await page.waitForSelector('#mks-panel:not([hidden]) .mks-pitem', { timeout: 10000 }).catch(() => null));
  await page.screenshot({ path: `${OUT}/marketing-schedule-panel-live-${width}px-20261108.png` });
  await page.click('#mks-panel [data-mks-close]');
  check(`${width}: panel closes`, await page.$('#mks-panel[hidden]'));
  await page.locator('section[data-panel="marketing"]').screenshot({ path: `${OUT}/marketing-tab-live-${width}px-20261108.png` });
  return Number(n9);
}

/* ---------- Done / Skip / Move: side panel vs the old campaign-steps table, same request ---------- */

async function act(page, scope, kind, stepKey) {
  const k = stepKey.replace(/"/g, '\\"');
  if (kind === 'done') return page.locator(`${scope} .st-step-done[data-key="${k}"]`).first().click();
  if (kind === 'skip') {
    const btn = page.locator(`${scope} .st-skip-save[data-key="${k}"]`).first();
    await btn.locator('xpath=..').locator('summary').click();
    await btn.locator('xpath=..').locator('.st-skip-reason').fill('dry run: not saved');
    return btn.click();
  }
  return page.locator(`${scope} .st-move[data-key="${k}"]`).first().evaluate((el) => { el.value = '2026-11-10'; el.dispatchEvent(new Event('change', { bubbles: true })); });
}
async function openLate(page, row) {
  const rowSel = { done: 'LinkedIn', skip: 'Outlook', move: 'Facebook' }[row];
  await page.locator('#mk-schedule tr', { hasText: rowSel }).locator('.mks-card.s-late[data-mks-items]').first().click();
  await page.waitForSelector('#mks-panel:not([hidden])', { timeout: 10000 });
}
/** Waits for the intercepted request, then for the repaint that follows it (the next control must be the new one). */
async function waitWrite(n) {
  for (let i = 0; i < 40 && writes.length < n; i += 1) await new Promise((r) => setTimeout(r, 250));
  await new Promise((r) => setTimeout(r, 1500));
}
async function panelActions(page) {
  source = 'side panel';
  for (const kind of ['done', 'skip', 'move']) {
    await openLate(page, kind);
    const before = writes.length;
    await act(page, '#mks-panel', kind, STEPS[kind]);
    await waitWrite(before + 1);
    await page.click('#mks-panel [data-mks-close]').catch(() => {});
  }
}
async function tableActions(page) {
  source = 'old campaign-steps table';
  await page.click('#mk-fold-results > summary');
  await page.waitForSelector('#st-campaign-table', { timeout: 30000 });
  for (const kind of ['done', 'skip', 'move']) {
    const before = writes.length;
    await act(page, '#mk-campaign-host', kind, STEPS[kind]);
    await waitWrite(before + 1);
  }
}
const columnsOf = (body) => Object.keys(patchedRows(body.keys.slice(0, 'moved_to' in body || 'status' in body ? 1 : body.keys.length), new Map(), patchFor(body, 'T').patch, { propertyUrl: body.propertyUrl, by: 'x', now: 'T' })[0]).sort();
function compareWrites() {
  const by = (src) => writes.filter((w) => w.source === src);
  const [panel, table] = [by('side panel'), by('old campaign-steps table')];
  check('dry run: 3 requests from the panel, 3 from the old table', panel.length === 3 && table.length === 3, `${panel.length} / ${table.length}`);
  const lines = [];
  ['done', 'skip', 'move'].forEach((kind, i) => {
    const [a, b] = [panel[i], table[i]];
    let same = false;
    try { assert.deepEqual(a?.body, b?.body); same = !!a && a.url === b.url && a.method === b.method; } catch { same = false; }
    check(`${kind}: side panel request = old table request`, same, a ? `${a.method} ${a.url} ${JSON.stringify({ ...a.body, propertyUrl: undefined })}` : 'none');
    if (a) lines.push(`${kind}: ${a.method} ${a.url} body ${JSON.stringify({ ...a.body, propertyUrl: undefined })} → columns ${columnsOf(a.body).join(', ')}`);
  });
  check('only strategy_campaign_ticks requests (no stage / campaign / marketing writes)', writes.every((w) => w.url === '/api/aigeo/strategy-ticks' && w.method === 'PATCH'), [...new Set(writes.map((w) => `${w.method} ${w.url}`))].join(', '));
  return lines;
}

/* ---------- duplicate: browser-only fixture on the live page (the overview response edited in the browser) ---------- */

const NORFOLK_EVENT = 'event|2026-11-20|/photographic-workshops-near-me/norfolk-photography-workshop';
async function injectDuplicate(page) {
  await page.route('**/api/aigeo/marketing?action=overview*', async (route) => {
    const res = await route.fetch();
    const j = await res.json();
    const ev = j.meter.deliveries.find((x) => x.key === NORFOLK_EVENT);
    if (ev) Object.assign(ev, { cancelled: false, release: null, bucket: 'provisional', stage: 'review_snapshot', amount: 314, send_day: '2026-11-08', send_at: null, snapshot: { ...(ev.snapshot || {}), export_id: 'fixture', list_name: 'ARP | Norfolk150 (browser-only fixture)', review: true, amount: 314 } });
    j.meter.warnings.unshift({ level: 'amber', key: NORFOLK_EVENT, pair: [NORFOLK_EVENT, 'theme|norfolk-workshops-8nov'], text: 'Possible duplicate reservation (BROWSER-ONLY FIXTURE, not live data)', action: 'Fixture for the screenshot only.' });
    await route.fulfill({ response: res, json: j });
  });
}
async function duplicateFixture(browser) {
  const page = await openTab(browser, 1600, injectDuplicate);
  await page.evaluate(() => {
    const h = document.querySelector('#mk-schedule h3');
    if (h) h.insertAdjacentHTML('beforeend', ' <span style="color:#f87171;font-size:13px">BROWSER-ONLY FIXTURE: Norfolk event record un-cancelled in this page only (no data written)</span>');
  });
  const dups = await page.$$eval('#mk-schedule .mks-days .mks-card.dup', (els) => els.map((e) => e.getAttribute('title')));
  const need = await page.textContent('#mk-schedule .mks-need li').catch(() => '');
  check('fixture: amber outline on both Norfolk 8 Nov cards', dups.length === 2 && dups.some((t) => /Norfolk Photography Workshop/.test(t)) && dups.some((t) => /Norfolk, Macro/.test(t)), dups.join(' | '));
  check('fixture: first Needs-you line names the pair', /may be the same email \(314 \/ 311 people\)/.test(need), need.trim());
  await page.locator('#mk-schedule').screenshot({ path: `${OUT}/marketing-schedule-duplicate-FIXTURE-live-1600px-20261108.png` });
  await page.close();
}

/* ---------- d7bb6677: cancelled (released) + one combined consent-gap warning ---------- */

async function sendBudget(page) {
  await page.click('#mk-fold-rules > summary');
  const budget = await page.textContent('#mk-budget');
  const warn = await page.$$eval('#mk-delivery .mkd-warn div', (els) => els.map((e) => e.textContent));
  const gaps = warn.filter((t) => /pre-send check doesn't cover/.test(t));
  check('d7bb6677: send budget shows "cancelled (released)"', /cancelled \(released\)/.test(budget), `${(budget.match(/cancelled \(released\)/g) || []).length} rows`);
  check('d7bb6677: one combined consent-gap warning', gaps.length === 1 && /^⚠ \d+ emails are scheduled more than 30 minutes ahead/.test(gaps[0].trim()), gaps.map((g) => g.trim().slice(0, 70)).join(' | '));
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const desk = await openTab(browser, 1600);
const n9 = await viewsAndShots(desk, 1600);
await sendBudget(desk);
await panelActions(desk);
await desk.close();
const old = await openTab(browser, 1600);
await tableActions(old);
await old.close();
const narrow = await openTab(browser, 1280);
const n9b = await viewsAndShots(narrow, 1280);
await narrow.close();
await duplicateFixture(browser);
await browser.close();

const lines = compareWrites();
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
fs.writeFileSync(`${OUT}/_schedule-live-result.json`, JSON.stringify({ n9: [n9, n9b], lines, results }, null, 1));
console.log(`w/c 9 Nov email count on the page: ${n9} (1600) / ${n9b} (1280)`);
lines.forEach((l) => console.log(l));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);

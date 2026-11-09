/**
 * Marketing schedule "Rows: Channels | Dates" toggle on live data at 1700px:
 *   node scripts/playwright-verify-swap-axis.mjs          local lib/marketing-schedule*.js (before deploy)
 *   LOCAL=0 node scripts/playwright-verify-swap-axis.mjs  deployed files
 * Checks: all 4 layouts render; the same cards per time unit in both arrangements; clicking a card opens the same
 * panel; the choice survives a reload; viewing writes nothing (non-GETs refused, DB counts + newest timestamps).
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
const BASE = 'https://ai-geo-audit.vercel.app';
const LOCAL = process.env.LOCAL !== '0';
const MODE = LOCAL ? 'local' : 'live';
const OUT = path.resolve('outputs');
const BLUR = '#mk-review-table td:first-child, #mk-cust-body, .mk-detail, #mk-cleanup table td.left, #mk-query table td:first-child, #mk-client-health table td:first-child, #mk-exp-review, #mk-snap-review { filter: blur(6px) !important; }';
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const blocked = [];
const errors = [];

async function dbState() {
  const out = {};
  for (const [t, c] of Object.entries({ strategy_campaign_steps: 'last_seen_at', strategy_campaign_ticks: 'updated_at', strategy_campaigns: 'updated_at', marketing_social_placements: 'set_at' })) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true });
    const { data } = await sb.from(t).select(c).not(c, 'is', null).order(c, { ascending: false }).limit(1);
    Object.assign(out, { [`${t}.rows`]: count, [`${t}.max`]: data?.[0]?.[c] || null });
  }
  return out;
}
async function ready(page) {
  await page.waitForFunction(() => document.querySelector('#mk-schedule .mks-grid') && document.querySelector('#mks-facts-check') && !/Loading the week plan/.test(document.querySelector('#mk-schedule').textContent), null, { timeout: 180000 });
  await page.waitForTimeout(2500);
}
const cardIds = (page) => page.$$eval('#mk-schedule .mks-body [data-mks-item], #mk-schedule .mks-body [data-mks-items]', (els) => els.map((e) => e.dataset.mksItem || e.dataset.mksItems).sort());
async function layout(page, mode, axis) {
  await page.click(`#mk-schedule [data-mks-view="${mode}"]`);
  await page.click(`#mk-schedule [data-mks-axis="${axis}"]`);
  await page.waitForTimeout(600);
  const ids = await cardIds(page);
  const table = await page.$eval('#mk-schedule .mks-body table', (t) => t.className);
  await page.locator('#mk-schedule').screenshot({ path: `${OUT}/swap-axis-${mode}-rows-${axis}-${MODE}-1700px-20261109.png` });
  return { ids, table };
}
async function panelOf(page) {
  const first = page.locator('#mk-schedule .mks-body [data-mks-item*="gpt-"]').first();
  const id = await first.getAttribute('data-mks-item');
  await first.click();
  await page.waitForSelector('#mks-panel:not([hidden]) .mks-pitem', { timeout: 15000 });
  const head = await page.textContent('#mks-panel .mks-ph');
  await page.click('#mks-panel [data-mks-close]');
  return { id, head };
}

const before = await dbState();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); }, ENV.ARP_ADMIN_KEY);
await page.route('**/api/**', (r) => {
  if (r.request().method() === 'GET') return r.fallback();
  blocked.push(`${r.request().method()} ${new URL(r.request().url()).pathname}`);
  return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' });
});
if (LOCAL) for (const f of ['marketing-schedule.js', 'marketing-schedule-model.js']) await page.route(`**/lib/${f}*`, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`lib/${f}`, 'utf8') }));
await page.goto(`${BASE}/audit-dashboard.html#marketing`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => { for (const k of ['mks-axis-days', 'mks-axis-weeks', 'mks-view']) localStorage.removeItem(k); });
await page.reload({ waitUntil: 'domcontentloaded' });
await ready(page);
await page.addStyleTag({ content: BLUR });
const defaults = await page.$eval('#mk-schedule .mks-body table', (t) => t.className);
check('default unchanged: Days with channel rows', /mks-days\b/.test(defaults), defaults);
const L = {};
for (const [mode, axis] of [['days', 'channels'], ['days', 'dates'], ['weeks', 'dates'], ['weeks', 'channels']]) L[`${mode}-${axis}`] = await layout(page, mode, axis);
check('all 4 layouts render', L['days-channels'].table.includes('mks-days') && L['days-dates'].table.includes('mks-days-dates') && L['weeks-dates'].table.includes('mks-weeks') && L['weeks-channels'].table.includes('mks-weeks-ch'), Object.entries(L).map(([k, v]) => `${k}: ${v.table}`).join(' | '));
check('Days: same cards in both arrangements', JSON.stringify(L['days-channels'].ids) === JSON.stringify(L['days-dates'].ids), `${L['days-channels'].ids.length} / ${L['days-dates'].ids.length} cards`);
check('Weeks: same cards in both arrangements', JSON.stringify(L['weeks-dates'].ids) === JSON.stringify(L['weeks-channels'].ids), `${L['weeks-dates'].ids.length} / ${L['weeks-channels'].ids.length} cards`);
const pWC = await panelOf(page);
await page.click('#mk-schedule [data-mks-axis="dates"]');
await page.waitForTimeout(500);
await page.locator(`#mk-schedule [data-mks-item="${pWC.id}"]`).first().click();
await page.waitForSelector('#mks-panel:not([hidden]) .mks-pitem', { timeout: 15000 });
const headWD = await page.textContent('#mks-panel .mks-ph');
await page.click('#mks-panel [data-mks-close]');
check('clicking the same card opens the same panel in both arrangements', headWD === pWC.head, `${pWC.id} → ${pWC.head.trim().slice(0, 60)}`);
await page.click('#mk-schedule [data-mks-axis="channels"]');
await page.reload({ waitUntil: 'domcontentloaded' });
await ready(page);
const after1 = await page.$eval('#mk-schedule .mks-body table', (t) => t.className);
check('the choice survives a reload (Weeks + Rows = Channels)', after1.includes('mks-weeks-ch'), after1);
await browser.close();
const after = await dbState();
const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
check('viewing writes nothing', !changed.length, changed.join(', '));
check('non-GETs refused', true, `${blocked.length} refused`);
check('no page errors', !errors.length, errors.slice(0, 2).join(' | '));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);

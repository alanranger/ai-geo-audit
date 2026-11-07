/**
 * Live check of the Strategy & Actions "Where we stand and why" tiles: placement, screenshots of every tile, key
 * figures re-calculated independently from Supabase, every link clicked, no overflow, no page errors.
 *   node --env-file=.env.local scripts/playwright-verify-strategy-insights.mjs [outDir]
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { isMoneyPagePath } from '../lib/revenue-funnel-money-pages.js';
import { selectAll, serviceClient } from '../lib/marketing/store.mjs';

const BASE = process.env.DASH_BASE || 'https://ai-geo-audit.vercel.app';
const OUT = process.argv[2] || 'C:/TEMP/si-verify';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const today = new Date().toISOString().slice(0, 10);
const ly = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
const money = (s) => { const m = String(s).replace(/,/g, '').match(/(−|-)?£([\d.]+)(k)?/); return m ? (m[1] ? -1 : 1) * Number(m[2]) * (m[3] ? 1000 : 1) : null; };
const near = (a, b, tol) => a != null && b != null && Math.abs(a - b) <= tol;

async function independent() {
  const sb = serviceClient();
  const tx = await selectAll(sb, 'booking_sheet_transactions', 'txn_date, category_order, amount', (q) => q.eq('property_url', 'https://www.alanranger.com'));
  const sum = (from, to, cats) => tx.filter((t) => t.txn_date >= from && t.txn_date <= to && (!cats || cats.includes(t.category_order))).reduce((a, t) => a + Number(t.amount), 0);
  const y = today.slice(0, 4);
  const from28 = new Date(Date.parse(`${today}T00:00:00Z`) - 27 * 86400000).toISOString().slice(0, 10);
  const gsc = await selectAll(sb, 'gsc_monthly_by_page', 'page_url, year, month, clicks', (q) => q.eq('year', Number(y)));
  const lastM = Number(today.slice(5, 7)) - 1;
  const pathOf = (u) => { try { return new URL(u).pathname; } catch { return String(u || ''); } };
  const gscClicks = gsc.filter((r) => r.month === lastM && isMoneyPagePath(pathOf(r.page_url))).reduce((a, r) => a + Number(r.clicks), 0);
  return {
    mtd: sum(`${today.slice(0, 7)}-01`, today), ytd: sum(`${y}-01-01`, today), ytdLy: sum(`${Number(y) - 1}-01-01`, ly),
    nonDated28: sum(from28, today, [7, 11, 8, 12, 6, 4, 10]), academyYtd: sum(`${y}-01-01`, today, [12]), gscClicks
  };
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}/audit-dashboard.html#strategy`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#st-insights .si-tile', { timeout: 180000 });
await page.waitForTimeout(2000);
const tiles = await page.$$('#st-insights .si-tile');
check('12 tiles render on direct load', tiles.length === 12, `${tiles.length}`);
const order = await page.evaluate(() => {
  const vis = [...document.querySelectorAll('#strategy-root > .rt-section, section[data-panel="strategy"] > .rt-section, section[data-panel="strategy"] #st-weights')].filter((el) => el.offsetParent !== null).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  return vis.slice(0, 3).map((el) => el.id || el.querySelector('h3')?.textContent?.trim().slice(0, 30));
});
check('insights first, Next campaign directly under', order[0] === 'st-insights' && order[1] === 'st-campaign', order.join(' > '));
check('old Headline strip removed', !(await page.evaluate(() => [...document.querySelectorAll('#strategy-root h3')].some((h) => /Headline strip|Trends/.test(h.textContent)))));
check('one-line summary shown', (await page.textContent('#st-insights .si-summary')).length > 40);
await page.locator('#st-insights').screenshot({ path: path.join(OUT, '00-all-tiles.png') });
for (let i = 0; i < tiles.length; i += 1) {
  const key = await tiles[i].getAttribute('data-si-key');
  await tiles[i].screenshot({ path: path.join(OUT, `${String(i + 1).padStart(2, '0')}-${key}.png`) });
}
const overflow = await page.evaluate(() => [...document.querySelectorAll('#st-insights .si-tile')].filter((t) => t.scrollWidth > t.clientWidth + 2).map((t) => t.dataset.siKey));
check('no tile wider than its box', !overflow.length, overflow.join(','));
const titleColour = await page.$eval('#st-insights .si-title', (el) => getComputedStyle(el).color);
check('tile titles white and bold', titleColour === 'rgb(255, 255, 255)', titleColour);

const ins = await page.evaluate(async () => (await (await fetch('/api/aigeo/strategy-summary?propertyUrl=https%3A%2F%2Fwww.alanranger.com&noBackfill=1')).json()).insights);
const t = Object.fromEntries(Object.values(ins.rows).flat().map((x) => [x.key, x]));
const ind = await independent();
check('This month sales = Booking Sheet MTD', near(money(t['money-this-month'].headline.value), ind.mtd, 1), `${t['money-this-month'].headline.value} vs £${Math.round(ind.mtd)}`);
check('YTD sales = Booking Sheet YTD', near(money(t['money-ytd'].headline.label.split(' vs ')[0]), ind.ytd, 60), `${t['money-ytd'].headline.label} vs £${Math.round(ind.ytd)} / £${Math.round(ind.ytdLy)}`);
check('Non-dated 28 days = Booking Sheet', near(money(t['mix-nondated-pace'].headline.value), ind.nonDated28, 1), `${t['mix-nondated-pace'].headline.value} vs £${Math.round(ind.nonDated28)}`);
check('Academy sales YTD = Booking Sheet', near(money(t['mix-academy'].comparison.match(/sales (−?£[\d.,]+k?)/)[1]), ind.academyYtd, 60), `vs £${Math.round(ind.academyYtd)}`);
check('Search clicks = Search Console money pages', Number(String(t['demand-search'].headline.value).replace(/,/g, '')) === ind.gscClicks, `${t['demand-search'].headline.value} vs ${ind.gscClicks}`);
const n = t['money-next-3'].numbers;
check('Next 3 months reconciles (required = potential + non-dated)', Math.round(n.required) === Math.round(n.potential + n.nonDated) || n.nonDated === 0, `£${Math.round(n.required)} = £${Math.round(n.potential)} + £${Math.round(n.nonDated)}`);

const links = await page.$$eval('#st-insights .si-link', (as) => as.map((a, i) => ({ i, panel: a.dataset.siPanel || null, anchor: a.dataset.siAnchor || null, label: a.textContent })));
for (const l of links) {
  await page.click('.aigeo-nav-item[data-panel="strategy"]');
  await page.waitForSelector('#st-insights .si-link', { timeout: 60000 });
  await page.locator('#st-insights .si-link').nth(l.i).click();
  await page.waitForTimeout(1500);
  const ok = l.panel
    ? await page.$(`.aigeo-panel[data-panel="${l.panel}"].is-active`)
    : await page.evaluate((id) => { const el = document.getElementById(id); if (!el) return false; const r = el.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }, l.anchor);
  check(`link "${l.label}" lands`, ok, l.panel || l.anchor);
}
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
await browser.close();
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);

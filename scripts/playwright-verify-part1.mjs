/**
 * Live check for the 7 Nov combined fixes, Part 1 (Strategy + Marketing figures). Screenshots at desktop (1600 px)
 * and pane width (800 px) stay local in C:/TEMP/p1-verify. Counts only are printed.
 *   node scripts/playwright-verify-part1.mjs
 */
import fs from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.DASH_BASE || 'https://ai-geo-audit.vercel.app';
const key = fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).find((l) => l.startsWith('ARP_ADMIN_KEY=')).slice(14).replace(/^"|"$/g, '').trim();
const out = 'C:/TEMP/p1-verify';
fs.mkdirSync(out, { recursive: true });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });

const only = process.argv.includes('--marketing');
for (const width of [1600, 800]) {
  const page = await browser.newPage({ viewport: { width, height: 1100 } });
  if (only) { await marketingChecks(page, width); await page.close(); continue; }
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((k) => sessionStorage.setItem('arp_admin_key', k), key);
  await page.goto(`${BASE}/audit-dashboard.html#strategy`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-si-key="money-this-month"]', { timeout: 180000 }).catch(() => {});
  const t1 = await page.textContent('[data-si-key="money-this-month"]').catch(() => '');
  check(`${width}px money tile 1 leads with the sales target, no "% of GP target"`, /% of the £[\d,]+ sales target/.test(t1) && !/of GP target/.test(t1), t1.match(/sales · [^G]+/)?.[0]?.trim());
  const t2 = await page.textContent('[data-si-key="money-next-3"]').catch(() => '');
  check(`${width}px money tile 2 keeps £9k potential + forecast and adds the forecast-only line`, /If only the forecast sells: £[\d.]+k must come from non-dated sales/.test(t2) && /potential/i.test(t2));
  const ret = await page.textContent('[data-si-key="mix-returning"]').catch(() => '');
  check(`${width}px clients who come back: every client counted once`, /\d+ of \d+ non-JLR clients since 2024/.test(ret) && /milestone/.test(ret), ret.match(/\d+ of \d+ non-JLR clients/)?.[0]);
  const runs = await page.textContent('[data-si-key="demand-runs"]').catch(() => '');
  check(`${width}px events tile labels the denominator`, /Ran % of held/.test(runs) && /ran ÷ \(listed − withdrawn\)/.test(runs));
  const search = await page.textContent('[data-si-key="demand-search"]').catch(() => '');
  check(`${width}px search tile names its own data date`, /Search Console data through/.test(search));
  const pnm = await page.textContent('[data-si-key="mix-pick-n-mix"]').catch(() => '');
  check(`${width}px Pick n Mix next chance lists qualifying courses by last night`, /Beginners · starts/.test(pnm) && /Last night/.test(pnm));
  const strat = await page.textContent('#strategy-root').catch(() => '');
  check(`${width}px pillar uses current Pick n Mix terms`, /from £50 a month/.test(strat) && !/£600 \/ £50pm/.test(strat));
  check(`${width}px plan sheet shows WAITING, not done or overdue`, /WAITING/.test(strat));
  check(`${width}px no Norfolk offer shown with 15 Dec`, !/15 Dec[^]{0,40}NORFOLK|NORFOLK150[^]{0,60}15 Dec/.test(strat));
  await page.locator('#st-insights').screenshot({ path: `${out}/strategy-tiles-${width}.png` }).catch(() => {});
  await marketingChecks(page, width);
  check(`${width}px no page errors`, !errors.length, errors.slice(0, 2).join(' | '));
  await page.close();
}
await browser.close();
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);

async function marketingChecks(page, width) {
  await page.addInitScript((k) => sessionStorage.setItem('arp_admin_key', k), key);
  await page.goto(`${BASE}/audit-dashboard.html?tab=m${width}#marketing`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#mk-seg-table', { timeout: 180000 }).catch(() => {});
  const segs = await page.textContent('#mk-seg-table').catch(() => '');
  check(`${width}px segments show version and as-of`, /v1/.test(segs) && /as of/.test(segs));
  const row = page.locator('#mk-seg-table tr', { hasText: 'Beginners booked, no Lightroom' });
  const segCount = (await row.locator('td').nth(2).textContent().catch(() => '')).match(/[\d,]+/)?.[0];
  await row.locator('[data-mk-openq]').click().catch(() => {});
  await page.waitForFunction(() => /in beginners/.test(document.getElementById('mq-english')?.textContent || '') && !document.querySelector('#mq-results .rt-loading'), null, { timeout: 90000 }).catch(() => {});
  const qCount = (await page.textContent('.mq-head').catch(() => '')).match(/([\d,]+)\s*people/)?.[1];
  check(`${width}px "Open in Customers" gives the segment's own count (one evaluator)`, qCount && qCount === segCount, `segment ${segCount} · query ${qCount}`);
  await page.locator('#mk-segments').screenshot({ path: `${out}/segments-${width}.png` }).catch(() => {});
}

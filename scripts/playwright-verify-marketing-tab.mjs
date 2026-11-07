/**
 * Live check of the Marketing & Campaigns tab (no personal data printed; screenshots stay local in C:/TEMP).
 *   node scripts/playwright-verify-marketing-tab.mjs [--sync]
 */
import fs from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.DASH_BASE || 'https://ai-geo-audit.vercel.app';
const key = fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).find((l) => l.startsWith('ARP_ADMIN_KEY=')).slice(14).replace(/^"|"$/g, '').trim();
const out = 'C:/TEMP/mk-verify';
fs.mkdirSync(out, { recursive: true });
const results = [];
const check = (name, ok, note = '') => { results.push({ name, ok: !!ok, note }); };

const noKey = await fetch(`${BASE}/api/aigeo/marketing?action=overview`);
check('route refuses without admin key', noKey.status === 401, `status ${noKey.status}`);
const csv = await fetch(`${BASE}/api/aigeo/marketing?action=export-csv&export_id=x`);
check('CSV route refuses without admin key', csv.status === 401, `status ${csv.status}`);
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript((k) => sessionStorage.setItem('arp_admin_key', k), key);
await page.goto(`${BASE}/audit-dashboard.html#marketing`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#mk-segments', { timeout: 120000 }).catch(() => {});
const ids = ['mk-budget', 'mk-campaign-host', 'mk-segments', 'mk-exports', 'mk-customers', 'mk-engagement', 'mk-sources', 'mk-settings'];
for (const id of ids) check(`section #${id} on direct load`, await page.$(`#${id}`));
await page.waitForSelector('#st-campaign-table', { timeout: 60000 }).catch(() => {});
check('Campaign steps table on Marketing tab', await page.$('#mk-campaign-host #st-campaign-table'));
check('send line uses billing-cycle meter', /Billing cycle|no Squarespace meter/.test(await page.textContent('#mk-campaign-host').catch(() => '')));
check('segments listed', (await page.$$('#mk-seg-table tbody tr')).length >= 8);
check('import block shown', /list import is blocked/i.test(await page.textContent('#mk-segments')));
await page.screenshot({ path: `${out}/1-marketing-top.png` });

await page.selectOption('#mk-cust-seg', 'beginners-no-lightroom-local');
await page.click('[data-mk="cust-search"]');
await page.waitForSelector('#mk-cust-table tbody tr', { timeout: 60000 }).catch(() => {});
const rows = await page.$$('#mk-cust-table tbody tr[data-mk-person]');
check('customer list loads for a segment', rows.length > 0, `${rows.length} rows`);
if (rows.length) {
  await rows[0].click();
  await page.waitForSelector('.mk-detail', { timeout: 60000 }).catch(() => {});
  check('customer detail opens', await page.$('.mk-detail'));
}
await page.locator('#mk-segments').screenshot({ path: `${out}/2-segments.png` });

const overflow = await page.evaluate(() => [...document.querySelectorAll('section[data-panel="marketing"] .rt-section')].filter((s) => s.scrollWidth > s.clientWidth + 2).map((s) => s.id));
check('no section wider than the page', !overflow.length, overflow.join(','));

if (process.argv.includes('--sync')) {
  await page.click('[data-mk="sync"]');
  await page.waitForSelector('#mk-modal', { timeout: 10000 }).catch(() => {});
  check('sync progress window appears', await page.$('#mk-modal'));
  await page.screenshot({ path: `${out}/3-sync-progress.png` });
  await page.waitForSelector('#mk-modal', { state: 'detached', timeout: 240000 }).catch(() => {});
  await page.waitForSelector('#mk-sources', { timeout: 120000 });
  const txt = await page.textContent('#mk-sources');
  check('sync finished, steps show OK', (txt.match(/\bOK\b/g) || []).length >= 4, '');
  await page.locator('#mk-sources').screenshot({ path: `${out}/4-sources.png` });
}

await page.click('.aigeo-nav-item[data-panel="strategy"]');
await page.waitForSelector('#st-campaign', { timeout: 120000 }).catch(() => {});
check('Strategy shows Next campaign link', /Next campaign/.test(await page.textContent('#st-campaign').catch(() => '')));
check('Strategy no longer has the steps table', !(await page.$('#strategy-root #st-campaign-table')));
await page.click('#st-campaign [data-goto-marketing]').catch(() => {});
await page.waitForTimeout(1500);
check('link opens Marketing tab', await page.$('.aigeo-panel[data-panel="marketing"].is-active'));

await page.goto(`${BASE}/audit-dashboard.html#strategy`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#st-campaign', { timeout: 120000 }).catch(() => {});
check('Strategy direct load still works', /Next campaign/.test(await page.textContent('#st-campaign').catch(() => '')));
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
await browser.close();
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);

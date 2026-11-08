/**
 * Live check (Claude 8 Nov 2026, spend double count): Client A's detail split in Marketing → Customers and the
 * duplicate rows in the timeline. Screenshot stays local (shows a name): C:/TEMP/spend-dedupe.
 *   node scripts/playwright-verify-spend-dedupe.mjs <email prefix>
 */
import fs from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.DASH_BASE || 'https://ai-geo-audit.vercel.app';
const key = fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).find((l) => l.startsWith('ARP_ADMIN_KEY=')).slice(14).replace(/^"|"$/g, '').trim();
const prefix = process.argv[2];
const out = 'C:/TEMP/spend-dedupe';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); }, key);
await page.goto(`${BASE}/audit-dashboard.html?tab=marketing#marketing`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#mq-table', { timeout: 180000 });
await page.fill('#mq-q', prefix);
await page.click('[data-q-act="run"]');
await page.waitForSelector('#mq-results .rt-loading', { state: 'detached', timeout: 90000 }).catch(() => {});
await page.waitForTimeout(500);
await page.locator('#mq-table tbody tr').first().click();
await page.waitForSelector('#mq-detail .mq-split', { timeout: 90000 });
const split = (await page.textContent('#mq-detail .mq-split')).replace(/\s+/g, ' ');
const dups = await page.$$eval('#mq-detail .mq-tl tbody tr', (trs) => trs.filter((t) => /duplicate — not added/.test(t.textContent)).map((t) => t.children[2].textContent.replace(/^.*?(— £\d+ is the same sale as [^(]+).*$/, '$1').trim()));
await page.locator('#mq-detail').screenshot({ path: `${out}/client-a-detail.png` });
console.log(JSON.stringify({ split, duplicates_in_timeline: dups, errors: errors.slice(0, 3) }, null, 1));
await browser.close();

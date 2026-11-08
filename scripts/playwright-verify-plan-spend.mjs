/**
 * Live check: Pick n Mix plan spend + order history for the two example plan clients (picked from pnm_plans inside
 * this script; nothing identifying is printed). Screenshots stay local in C:/TEMP/pnm-verify.
 *   node --env-file=.env.local scripts/playwright-verify-plan-spend.mjs
 */
import fs from 'node:fs';
import { chromium } from 'playwright';
import { selectAll, serviceClient } from '../lib/marketing/store.mjs';

const BASE = process.env.DASH_BASE || 'https://ai-geo-audit.vercel.app';
const key = fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).find((l) => l.startsWith('ARP_ADMIN_KEY=')).slice(14).replace(/^"|"$/g, '').trim();
const out = 'C:/TEMP/pnm-verify';
fs.mkdirSync(out, { recursive: true });
const plans = await selectAll(serviceClient(), 'pnm_plans', 'email, source_file');
const byEmail = new Map();
for (const p of plans) if (p.email) byEmail.set(p.email, [...(byEmail.get(p.email) || []), p]);
const ranked = [...byEmail.entries()];
const A = ranked.filter(([, ps]) => ps.some((p) => p.source_file.startsWith('2025/'))).sort((x, y) => y[1].length - x[1].length)[0][0];
const B = ranked.filter(([e]) => e !== A).sort((x, y) => y[1].length - x[1].length)[0][0];
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
await page.addInitScript((k) => sessionStorage.setItem('arp_admin_key', k), key);
await page.goto(`${BASE}/audit-dashboard.html?pnm=1#marketing`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#mq-table', { timeout: 180000 }).catch(() => {});
for (const [label, email] of [['A', A], ['B', B]]) {
  await page.fill('#mq-q', email);
  await page.click('[data-q-act="run"]');
  await page.waitForFunction(() => /Page 1 of 1/.test(document.getElementById('mq-pageinfo')?.textContent || ''), null, { timeout: 60000 }).catch(() => {});
  const rows = await page.$$('#mq-table tbody tr[data-q-person]');
  check(`client ${label}: one row in the customer table`, rows.length === 1, `${rows.length} row(s)`);
  if (!rows.length) continue;
  await rows[0].click();
  await page.waitForSelector('#mq-detail .mq-split', { timeout: 60000 }).catch(() => {});
  const det = await page.textContent('#mq-detail').catch(() => '');
  check(`client ${label}: spend split orders · Booking Sheet · plan payments · total`, /Orders £[\d,]+ · Booking Sheet £[\d,]+ · Plan payments £[\d,]+ · Total £[\d,]+/.test(det), (det.match(/Total £[\d,]+/) || [])[0]);
  check(`client ${label}: plan payments and plans in the order history`, /Plan payment/.test(det) && /Pick n Mix plan/.test(det));
  check(`client ${label}: plan-funded £0 orders labelled`, /paid from Pick n Mix plan/.test(det));
  const amounts = await page.$$eval('#mq-detail .mq-tl tbody tr', (trs) => trs.filter((tr) => /Purchase|Plan payment/.test(tr.textContent)).map((tr) => tr.cells[3]?.textContent.trim()));
  check(`client ${label}: £ on every purchase line`, amounts.length > 0 && amounts.every((a) => /£/.test(a)), `${amounts.length} lines`);
  await page.locator('#mq-detail').screenshot({ path: `${out}/client-${label}-history.png` });
}
await page.fill('#mq-q', '');
await page.selectOption('#mq-preset', 'email');
await page.waitForTimeout(4000);
const ths = await page.$$eval('#mq-table thead th', (els) => els.map((e) => e.textContent));
check('Known net £ in the Email activity preset', ths.some((t) => /Known net £/.test(t)));
await browser.close();
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);

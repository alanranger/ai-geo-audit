/**
 * Marketing cold-load timing (fresh browser context, 1700px): time to the first Waiting row, the first List row and
 * all tiles settled, plus the main API calls. Read-only (every non-GET refused, except the customer search's reads).
 *   node scripts/playwright-marketing-load-time.mjs live     deployed files
 *   node scripts/playwright-marketing-load-time.mjs local    local lib/marketing-tab.js + lib/marketing-waiting.js
 * Runs RUNS cold loads (default 2) and reports each + the median.
 */
import fs from 'node:fs';
import { chromium } from 'playwright';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
const MODE = process.argv[2] || 'live';
const RUNS = Number(process.env.RUNS || 2);
const LOCAL = ['marketing-tab.js', 'marketing-waiting.js', 'marketing-overview-tiles.js'];
const API = [['overview', /action=overview/], ['strategy-summary', /strategy-summary/], ['decisions', /marketing-decisions/], ['results', /marketing-results/], ['delivery-status', /action=delivery-status/], ['social', /\/api\/aigeo\/social\?/], ['client-health', /client-health/], ['query-fields', /query-fields/]];

async function once(browser, i) {
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
  const page = await ctx.newPage();
  await page.addInitScript((k) => sessionStorage.setItem('arp_admin_key', k), ENV.ARP_ADMIN_KEY);
  await page.route('**/api/**', (r) => (r.request().method() === 'GET' ? r.fallback() : r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' })));
  if (MODE === 'local') for (const f of LOCAL) await page.route(`**/lib/${f}*`, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`lib/${f}`, 'utf8') }));
  const calls = {};
  const t0 = Date.now();
  page.on('response', (r) => { const hit = API.find(([, re]) => re.test(r.url())); if (hit && !calls[hit[0]]) calls[hit[0]] = Math.round((Date.now() - t0) / 100) / 10; });
  await page.goto('https://ai-geo-audit.vercel.app/audit-dashboard.html#marketing', { waitUntil: 'domcontentloaded' });
  const at = async (fn) => { await page.waitForFunction(fn, null, { timeout: 180000 }).catch(() => null); return Math.round((Date.now() - t0) / 100) / 10; };
  const firstShell = await at(() => document.querySelector('#mk-waiting'));
  const waiting = await at(() => /^\d+$/.test(document.querySelector('#mk-waiting .mkw-n')?.textContent.trim() || ''));
  const listRow = await at(() => document.querySelector('#mk-schedule .mkl-row, #mk-schedule .mks-card'));
  const tiles = await at(() => { const t = document.querySelector('#mk-overview-tiles'); return t && t.querySelector('.mko-tile') && !/Loading|loading…/i.test(t.innerText); });
  const social = await at(() => { const t = document.querySelector('#mk-social'); return t && t.querySelector('.mksoc-g') && !/Loading/i.test(t.innerText); });
  const fullList = await at(() => /LinkedIn/.test(document.querySelector('#mk-schedule .mks-body')?.textContent || '') && !document.querySelector('#mk-planned.mkw-loading'));
  const errorsShown = await page.evaluate(() => [...document.querySelectorAll('#marketing-root .rt-error')].filter((e) => e.checkVisibility()).map((e) => e.textContent.trim().slice(0, 80)));
  if (i === 0) await page.screenshot({ path: `outputs/load-${MODE}-at-done-1700px-20261109.png` });
  await ctx.close();
  return { firstShell, waiting, listRow, tiles, social, fullList, calls, errorsShown };
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const runs = [];
for (let i = 0; i < RUNS; i += 1) runs.push(await once(browser, i));
await browser.close();
const med = (k) => { const v = runs.map((r) => r[k]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
for (const [i, r] of runs.entries()) console.log(`run ${i + 1}: shell ${r.firstShell}s · first Waiting row ${r.waiting}s · first List row ${r.listRow}s · overview tiles settled ${r.tiles}s · social tiles ${r.social}s · full List ${r.fullList}s · API ${JSON.stringify(r.calls)} · visible errors ${r.errorsShown.length ? r.errorsShown.join(' | ') : 'none'}`);
console.log(`MEDIAN (${MODE}): first Waiting row ${med('waiting')}s · first List row ${med('listRow')}s · all tiles ${Math.max(med('tiles'), med('social'))}s · full List ${med('fullList')}s`);
fs.writeFileSync(`outputs/_load-${MODE}.json`, JSON.stringify(runs, null, 1));

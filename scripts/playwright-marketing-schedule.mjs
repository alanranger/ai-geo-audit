/**
 * Marketing & Campaigns → Schedule (Days / Weeks): screenshots + checks against the live dashboard.
 *   node scripts/playwright-marketing-schedule.mjs --tag=before            live as deployed
 *   node scripts/playwright-marketing-schedule.mjs --tag=local --local     live data, this folder's lib/ files swapped in
 * Read-only: no Done / Skip / Move is clicked. People's names / emails are blurred before any screenshot.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.DASH_BASE || 'https://ai-geo-audit.vercel.app';
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const TAG = arg('tag', 'run');
const LOCAL = process.argv.includes('--local');
const OUT = path.resolve('outputs');
const key = fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).find((l) => l.startsWith('ARP_ADMIN_KEY=')).slice(14).replace(/^"|"$/g, '').trim();
const LOCAL_FILES = ['marketing-tab.js', 'marketing-delivery.js', 'marketing-schedule-model.js', 'marketing-schedule.js', 'strategy-board.js'];
const NEW_TAGS = '<script src="/lib/marketing-schedule-model.js?v=sched-local"></script>\n  <script src="/lib/marketing-schedule.js?v=sched-local"></script>';
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });

const BLUR = `#mk-review-table td:first-child, #mk-cust-body, .mk-detail, #mk-cleanup table td.left, #mk-query table td:first-child, #mk-client-health table td:first-child, #mk-exp-review, #mk-snap-review { filter: blur(6px) !important; }`;

async function localRoutes(page) {
  await page.route('**/audit-dashboard.html*', async (route) => {
    const res = await route.fetch();
    let html = await res.text();
    html = html.replace(/(<script src="\/lib\/marketing-tab\.js\?v=[^"]*"><\/script>)/, `$1\n  ${NEW_TAGS}`);
    await route.fulfill({ response: res, body: html, headers: { ...res.headers(), 'content-type': 'text/html; charset=utf-8' } });
  });
  for (const f of LOCAL_FILES) {
    await page.route(`**/lib/${f}*`, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join('lib', f), 'utf8') }));
  }
}

async function openTab(width) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  page.on('pageerror', (e) => errors.push(`${width}: ${e.message}`));
  await page.addInitScript((k) => sessionStorage.setItem('arp_admin_key', k), key);
  if (LOCAL) await localRoutes(page);
  await page.goto(`${BASE}/audit-dashboard.html#marketing`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#mk-segments, #mk-audiences', { timeout: 120000 }).catch(() => {});
  const ready = LOCAL ? '#mk-schedule .mks-grid' : '#mk-campaign-host #st-campaign-table';
  await page.waitForSelector(ready, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(4000);
  await page.addStyleTag({ content: BLUR });
  return page;
}

async function shotsBefore(page, width) {
  await page.locator('section[data-panel="marketing"]').screenshot({ path: `${OUT}/marketing-tab-before-${width}px-20261108.png` });
  await page.screenshot({ path: `${OUT}/marketing-tab-before-top-${width}px-20261108.png` });
}

/** Layout + controls, read-only: nothing is ticked, skipped or moved. */
async function structureChecks(page, width) {
  const s = await page.evaluate(() => ({
    folds: [...document.querySelectorAll('details.mks-fold')].map((d) => [d.id, d.open]),
    moved: document.querySelectorAll('p[data-mks-moved]').length,
    listed: document.querySelectorAll('#mk-rules-moved li').length,
    hosts: ['mk-campaign-host', 'mk-segments', 'mk-exports', 'mk-customers', 'mk-budget', 'mk-delivery'].map((id) => [id, document.getElementById(id)?.closest('details.mks-fold')?.id || 'top']),
    visible: ['mk-overview-tiles', 'mk-schedule', 'mk-query', 'mk-cleanup'].every((id) => document.getElementById(id) && !document.getElementById(id).closest('details.mks-fold'))
  }));
  check(`${width}: 3 folds, all closed`, s.folds.length === 3 && s.folds.every(([, o]) => !o), JSON.stringify(s.folds));
  check(`${width}: old sections inside the folds`, s.hosts.every(([, f]) => f !== 'top'), s.hosts.map((h) => h.join('→')).join(' '));
  check(`${width}: tiles, schedule, customer search, clean-up stay visible`, s.visible);
  check(`${width}: long paragraphs behind ⓘ and listed in Rules`, s.moved > 0 && s.moved === s.listed, `${s.moved} moved, ${s.listed} listed`);
  await page.click('#mk-schedule [data-mks-view="weeks"]');
  const w9 = await page.textContent('#mk-schedule [data-mks-week="2026-11-09"]').catch(() => '');
  const n9 = await page.locator('#mk-schedule tr', { has: page.locator('[data-mks-week="2026-11-09"]') }).locator('.mks-n').textContent().catch(() => '');
  check(`${width}: w/c 9 Nov email count`, Number(n9) === 6, `${w9.trim()} → ${n9}`);
  await page.click('#mk-schedule [data-mks-view="days"]');
  const late = page.locator('#mk-schedule .mks-card.s-late[data-mks-items]').first();
  if (await late.count()) {
    await late.click();
    const ctl = await page.evaluate(() => ['.st-skip-save', '.st-move', '.st-step-done', '.st-mo-tick'].map((q) => document.querySelectorAll(`#mks-panel ${q}`).length));
    check(`${width}: late card panel has the board's Done / Skip / Move controls`, ctl[0] > 0 && ctl[1] > 0 && ctl[2] + ctl[3] > 0, `skip ${ctl[0]} · move ${ctl[1]} · done ${ctl[2]} · tick ${ctl[3]}`);
    await page.screenshot({ path: `${OUT}/marketing-schedule-panel-late-${TAG}-${width}px-20261108.png` });
    await page.click('#mks-panel [data-mks-close]').catch(() => {});
  }
  await page.click('#mk-overview-tiles [data-mko-go="budget"]').catch(() => {});
  await page.waitForTimeout(800);
  check(`${width}: tile 8 link opens Rules & data sources`, await page.evaluate(() => document.getElementById('mk-fold-rules')?.open));
  await page.locator('#mk-fold-rules').screenshot({ path: `${OUT}/marketing-schedule-rules-fold-${TAG}-${width}px-20261108.png` });
  await page.evaluate(() => { document.getElementById('mk-fold-rules').open = false; window.scrollTo(0, 0); });
}

async function shotsLocal(page, width) {
  const sched = page.locator('#mk-schedule');
  await sched.screenshot({ path: `${OUT}/marketing-schedule-days-${TAG}-${width}px-20261108.png` });
  await page.click('#mk-schedule [data-mks-view="weeks"]');
  await page.waitForSelector('#mk-schedule .mks-weeks', { timeout: 10000 }).catch(() => {});
  await sched.screenshot({ path: `${OUT}/marketing-schedule-weeks-${TAG}-${width}px-20261108.png` });
  check(`${width}: toggle to Weeks`, await page.$('#mk-schedule .mks-weeks'));
  await page.click('#mk-schedule [data-mks-view="days"]');
  await page.waitForSelector('#mk-schedule .mks-days', { timeout: 10000 }).catch(() => {});
  check(`${width}: toggle back to Days`, await page.$('#mk-schedule .mks-days'));
  const card = page.locator('#mk-schedule .mks-card[data-mks-item]').first();
  if (await card.count()) {
    await card.click();
    await page.waitForSelector('#mks-panel:not([hidden])', { timeout: 10000 }).catch(() => {});
    check(`${width}: side panel opens`, await page.$('#mks-panel:not([hidden])'));
    await page.screenshot({ path: `${OUT}/marketing-schedule-panel-${TAG}-${width}px-20261108.png` });
    await page.click('#mks-panel [data-mks-close]').catch(() => {});
  }
  await structureChecks(page, width);
  const overflow = await page.evaluate(() => [...document.querySelectorAll('section[data-panel="marketing"] .rt-section')].filter((s) => s.scrollWidth > s.clientWidth + 2).map((s) => s.id));
  check(`${width}: no section wider than the page`, !overflow.length, overflow.join(','));
  await page.locator('section[data-panel="marketing"]').screenshot({ path: `${OUT}/marketing-tab-${TAG}-${width}px-20261108.png` });
}

const errors = [];
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
for (const width of [1600, 1280]) {
  const page = await openTab(width);
  if (LOCAL) await shotsLocal(page, width);
  else await shotsBefore(page, width);
  await page.close();
}
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
await browser.close();
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);

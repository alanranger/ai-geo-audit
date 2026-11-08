/**
 * Item 1 (final fix round): the 9 Nov Norfolk LinkedIn panel shows only the public caption as "Final caption", and
 * readiness blocks on internal marker phrases. Live data at 1700px:
 *   LOCAL=0 node scripts/playwright-verify-captions.mjs     deployed files (before)
 *   node scripts/playwright-verify-captions.mjs             local social files + local /api/aigeo/social-standard (after)
 * Read-only: every non-GET is refused; DB row counts + newest timestamps compared.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { markersIn } from '../lib/social-standard/caption.mjs';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ARP_ADMIN_KEY']) process.env[k] = ENV[k];
const BASE = 'https://ai-geo-audit.vercel.app';
const LOCAL = process.env.LOCAL !== '0';
const MODE = LOCAL ? 'after-local' : 'before-live';
const OUT = path.resolve('outputs');
const STEP = 'gpt-event-2026-11-09-norfolk-li';
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const blocked = [];

async function dbState() {
  const out = {};
  for (const [t, c] of Object.entries({ marketing_social_placements: 'set_at', strategy_campaign_steps: 'last_seen_at', strategy_campaign_ticks: 'updated_at' })) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true });
    const { data } = await sb.from(t).select(c).not(c, 'is', null).order(c, { ascending: false }).limit(1);
    Object.assign(out, { [`${t}.rows`]: count, [`${t}.max`]: data?.[0]?.[c] || null });
  }
  return out;
}
async function localSocial(query) {
  const { default: handler } = await import('../api/aigeo/social-standard.js');
  let out = null;
  const res = { status() { return this; }, setHeader() {}, json(j) { out = j; return this; } };
  await handler({ method: 'GET', query, headers: { 'x-arp-admin-key': ENV.ARP_ADMIN_KEY } }, res);
  return out;
}
async function routes(page) {
  const files = { 'marketing-schedule.js': 'lib/marketing-schedule.js', 'schedule-social.js': 'lib/social-standard/schedule-social.js', 'social-panel.js': 'lib/social-standard/social-panel.js' };
  for (const [name, file] of Object.entries(files)) await page.route(`**/lib/**/${name}*`, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(file, 'utf8') }));
  await page.route('**/api/aigeo/social-standard*', async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(await localSocial(Object.fromEntries(new URL(r.request().url()).searchParams))) }));
}

const before = await dbState();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
await page.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); localStorage.setItem('mks-view', 'weeks'); }, ENV.ARP_ADMIN_KEY);
await page.route('**/api/**', (r) => {
  if (r.request().method() === 'GET') return r.fallback();
  blocked.push(`${r.request().method()} ${new URL(r.request().url()).pathname}`);
  return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' });
});
if (LOCAL) await routes(page);
await page.goto(`${BASE}/audit-dashboard.html#marketing`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#mks-facts-check') && document.querySelector('#mk-schedule .mks-weeks'), null, { timeout: 180000 });
await page.waitForTimeout(4000);
await page.locator(`#mk-schedule [data-mks-item*="${STEP}"]`).first().click();
await page.waitForSelector('#mks-panel:not([hidden]) .sps', { timeout: 20000 });
const cap = await page.$eval('#mks-panel .sps', (el) => {
  const h = [...el.querySelectorAll('h5')].find((x) => /Final caption/.test(x.textContent));
  return h?.nextElementSibling?.textContent || '';
});
const ready = await page.$$eval('#mks-panel .sps-ready li', (els) => els.map((e) => `${e.classList.contains('ok') ? 'OK' : 'NO'} ${e.textContent.replace(/\s+/g, ' ').trim()}`));
console.log('FINAL CAPTION', MODE, JSON.stringify(cap.slice(0, 600)));
console.log('READINESS', MODE, JSON.stringify(ready));
check('Final caption has no internal marker phrase', !markersIn(cap).length, markersIn(cap).join(', ') || 'none');
check('Readiness lists the caption marker check and the booking-URL check', ready.some((r) => /internal/i.test(r)) && ready.some((r) => /booking URL/i.test(r)), ready.join(' | '));
await page.locator('#mks-panel .sps h5', { hasText: 'Readiness' }).scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/item1-norfolk-li-${MODE}-1700px-20261108.png` });
await page.locator('#mks-panel .sps h5', { hasText: 'Final caption' }).scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/item1-norfolk-li-caption-${MODE}-1700px-20261108.png` });
if (LOCAL) {
  await page.click('#mks-panel [data-mks-close]');
  const opened = await page.evaluate((k) => window.mkOpenSocialReview && window.mkOpenSocialReview(k), STEP);
  await page.waitForSelector('#mks-panel:not([hidden]) .sps-review', { timeout: 10000 }).catch(() => {});
  const order = await page.$eval('#mks-panel', (el) => { const t = el.innerText; return { caption: t.indexOf('Public caption'), image: t.indexOf('Rendered image'), brief: t.indexOf('Production brief'), collapsed: !!el.querySelector('details.mks-more:not([open])') }; }).catch(() => ({}));
  check('window.mkOpenSocialReview: caption, then image, brief collapsed below', opened === true && order.caption >= 0 && order.caption < order.image && order.image < order.brief && order.collapsed, JSON.stringify(order));
  await page.screenshot({ path: `${OUT}/item1-norfolk-li-review-first-${MODE}-1700px-20261108.png` });
}
await browser.close();
const after = await dbState();
const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
check('viewing writes nothing', !changed.length, changed.join(', '));
check('non-GETs refused', true, `${blocked.length} refused`);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);

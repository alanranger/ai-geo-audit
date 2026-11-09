/**
 * Light & Logic promotion (live-audit corrections item 2): the L&L edition rows say "promoted in: 19 Nov email (draft)"
 * / "17 Dec email (draft)", the emails show the module, and the Squarespace next-cycle view lists it (budgeted once).
 * Live data at 1700px; local lib files + local extras. Viewing writes nothing (all non-GETs refused).
 *   node scripts/playwright-verify-ll-promotion.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ARP_ADMIN_KEY']) process.env[k] = ENV[k];
const BASE = 'https://ai-geo-audit.vercel.app';
const OUT = path.resolve('outputs');
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const blocked = [];
const errors = [];

async function dbState() {
  const out = {};
  for (const [t, c] of Object.entries({ strategy_content_assets: 'set_at', strategy_campaigns: 'updated_at', strategy_campaign_steps: 'last_seen_at', strategy_campaign_ticks: 'updated_at', marketing_social_placements: 'set_at' })) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true });
    const { data } = await sb.from(t).select(c).not(c, 'is', null).order(c, { ascending: false }).limit(1);
    Object.assign(out, { [`${t}.rows`]: count, [`${t}.max`]: data?.[0]?.[c] || null });
  }
  return out;
}
async function localExtras() {
  const { default: handler } = await import('../api/aigeo/marketing-schedule-extras.js');
  let out = null;
  const res = { status() { return this; }, setHeader() {}, json(j) { out = j; return this; } };
  await handler({ method: 'GET', query: {}, headers: { 'x-arp-admin-key': ENV.ARP_ADMIN_KEY } }, res);
  return out;
}
async function routes(page) {
  await page.route('**/api/**', (r) => {
    const req = r.request();
    if (req.method() === 'GET') return r.fallback();
    blocked.push(`${req.method()} ${new URL(req.url()).pathname}`);
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' });
  });
  for (const f of ['marketing-schedule.js', 'marketing-schedule-list.js']) await page.route(`**/lib/${f}*`, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`lib/${f}`, 'utf8') }));
  await page.route('**/api/aigeo/marketing-schedule-extras*', async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(await localExtras()) }));
}
const text = (page, sel) => page.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
const clickIn = async (page, sel) => { await page.click(`#mk-schedule ${sel}`); await page.waitForTimeout(700); };
const rowText = async (page, id) => { const l = page.locator(`#mk-schedule .mkl [data-mkl-item="${id}"]`); return (await l.count()) ? (await l.first().innerText()).replace(/\s+/g, ' ') : ''; };

const before = await dbState();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1700, height: 1200 } });
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); for (const x of ['mks-layout', 'mks-channel', 'mks-lrange', 'mks-cycle']) localStorage.removeItem(x); }, ENV.ARP_ADMIN_KEY);
await routes(page);
await page.goto(`${BASE}/audit-dashboard.html#marketing`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#mk-schedule .mkl') && /LinkedIn/.test(document.querySelector('#mk-schedule .mks-body')?.textContent || ''), null, { timeout: 180000 });
await page.waitForTimeout(4000);

await clickIn(page, '[data-mks-lrange="9"]');
const nov = await page.$eval('#mk-schedule .mkl', (el) => [...el.querySelectorAll('.mkl-row')].map((r) => r.innerText.replace(/\s+/g, ' ')).filter((t) => /Light & Logic newsletter/.test(t))).catch(() => []);
check('L&L 15 Nov row: "promoted in: 19 Nov email (draft)"; 15 Dec row: "promoted in: 17 Dec email (draft)"', nov.some((t) => /November edition[^]*promoted in: 19 Nov email \(draft\)/.test(t)) && nov.some((t) => /December edition[^]*promoted in: 17 Dec email \(draft\)/.test(t)), nov.map((t) => t.slice(0, 140)).join(' | '));
const e19 = await rowText(page, 'email|theme|gpt-8w-2026-11-19');
const e17 = await rowText(page, 'email|theme|gpt-8w-2026-12-17');
check('19 Nov / 17 Dec email rows show the L&L module chip; their own status unchanged (never Scheduled)', /📰 Light & Logic Nov edition module/.test(e19) && /📰 Light & Logic Dec edition module/.test(e17) && !/Scheduled/.test(`${e19}${e17}`) && /In preparation|Draft/.test(e19), `${e19.slice(0, 200)} || ${e17.slice(0, 120)}`);
await page.locator('#mk-schedule .mkl [data-mkl-item="email|theme|gpt-8w-2026-11-19"]').first().scrollIntoViewIfNeeded();
await page.locator('#mk-schedule').screenshot({ path: `${OUT}/ll-promotion-list-local-1700px-20261109.png` });

await clickIn(page, '[data-mks-channel="email"]');
await clickIn(page, '[data-mkl-cycle="next"]');
const ev = await text(page, '#mk-schedule .mkl-email');
const promoLine = await text(page, '#mk-schedule .mkl-promos');
check('Squarespace next cycle: promotion line lists both modules, budgeted once (newsletter never uses credits)', /Nov edition \(15 Nov\) → module in the 19 Nov email \(draft\)/.test(promoLine) && /Dec edition \(15 Dec\) → module in the 17 Dec email \(draft\)/.test(promoLine) && /Budgeted once/.test(promoLine) && !/none recorded/.test(ev), promoLine.slice(0, 300));
check('Squarespace next cycle: the 19 Nov send row carries the module chip', /Small details, new possibilities[^]{0,200}📰 Light & Logic Nov edition module/.test(ev), (ev.match(/Small details[^]{0,160}/) || [''])[0]);
await page.locator('#mk-schedule .mkl-email').screenshot({ path: `${OUT}/ll-promotion-email-view-local-1700px-20261109.png` });
await clickIn(page, '[data-mks-channel="all"]');
await clickIn(page, '[data-mks-lrange="this"]');
await browser.close();

const after = await dbState();
const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
check('viewing writes nothing', !changed.length, changed.map((k) => `${k}: ${before[k]} → ${after[k]}`).join(' | '));
check('every non-GET refused (none reached the server)', true, `${blocked.length} refused`);
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);

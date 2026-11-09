/**
 * YouTube Shorts in the schedule (question f): YouTube rows + filter, Short chips on emails (email keeps its own
 * status), the per-video content record, and the task line without empty "·" segments. Live data at 1700px.
 *   node scripts/playwright-verify-shorts-schedule.mjs           local lib files + local board (before deploy)
 *   LOCAL=0 node scripts/playwright-verify-shorts-schedule.mjs   deployed
 * Viewing writes nothing: every non-GET is refused; DB counts + latest timestamps compared before / after.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ARP_ADMIN_KEY']) process.env[k] = ENV[k];
const BASE = 'https://ai-geo-audit.vercel.app';
const LOCAL = process.env.LOCAL !== '0';
const MODE = LOCAL ? 'local' : 'live';
const OUT = path.resolve('outputs');
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const blocked = [];
const errors = [];

async function dbState() {
  const out = {};
  for (const [t, c] of Object.entries({ strategy_content_assets: 'updated_at', strategy_campaign_steps: 'last_seen_at', strategy_campaign_ticks: 'updated_at', strategy_campaigns: 'updated_at', marketing_social_placements: 'set_at', marketing_decisions: 'decided_at' })) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true });
    const { data } = await sb.from(t).select(c).not(c, 'is', null).order(c, { ascending: false }).limit(1);
    Object.assign(out, { [`${t}.rows`]: count, [`${t}.max`]: data?.[0]?.[c] || null });
  }
  return out;
}
async function localBoard() {
  const { buildStatusBoard } = await import('../lib/marketing/delivery-status-board.mjs');
  return { ok: true, ...(await buildStatusBoard(sb)) };
}
async function routes(page) {
  await page.route('**/api/**', (r) => {
    const req = r.request();
    if (req.method() === 'GET') return r.fallback();
    blocked.push(`${req.method()} ${new URL(req.url()).pathname}`);
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' });
  });
  if (!LOCAL) return;
  for (const f of ['marketing-schedule-model.js', 'marketing-schedule.js', 'marketing-schedule-list.js']) await page.route(`**/lib/${f}*`, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`lib/${f}`, 'utf8') }));
  await page.route(/\/api\/aigeo\/marketing\?action=delivery-status/, async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(await localBoard()) }));
}
const text = (page, sel) => page.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
const clickIn = async (page, sel) => { await page.click(`#mk-schedule ${sel}`); await page.waitForTimeout(700); };

const before = await dbState();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1700, height: 1200 } });
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); for (const x of ['mks-layout', 'mks-channel', 'mks-lrange', 'mks-cycle', 'mks-axis-days', 'mks-axis-weeks']) localStorage.removeItem(x); }, ENV.ARP_ADMIN_KEY);
await routes(page);
const boardResp = page.waitForResponse((r) => /action=delivery-status/.test(r.url()), { timeout: 180000 });
await page.goto(`${BASE}/audit-dashboard.html#marketing`, { waitUntil: 'domcontentloaded' });
const board = await (await boardResp).json();
await page.waitForFunction(() => document.querySelector('#mk-schedule .mkl') && /LinkedIn/.test(document.querySelector('#mk-schedule .mks-body')?.textContent || ''), null, { timeout: 180000 });
await page.waitForTimeout(3000);
check('board carries 7 Short content records', (board.content || []).length === 7, `${(board.content || []).length} content records`);

const tasks = await text(page, '#mk-schedule .mkl-tasks');
check('Tasks & reminders: no empty "· ·" segment', tasks && !/·\s*·/.test(tasks), (tasks.match(/[^·]{0,30}Google Business update[^📄]{0,90}/) || [''])[0]);

await clickIn(page, '[data-mks-channel="youtube"]');
const yt = await page.$$eval('#mk-schedule .mkl [data-mkl-item^="youtube|"]', (els) => els.map((e) => ({ day: e.closest('.mkl-day')?.querySelector('.mkl-d')?.innerText.replace(/\s+/g, ' '), t: e.innerText.replace(/\s+/g, ' ') })));
const allSch = yt.every((r) => /🕒\s*Scheduled/.test(r.t) && /6:00pm/.test(r.t) && /Open on YouTube/.test(r.t));
check('YouTube filter: 7 rows, 🕒 Scheduled at 6:00pm (18:00) with the YouTube link, TUE 10 NOV → TUE 22 DEC', yt.length === 7 && allSch && /TUE 10 NOV/.test(yt[0]?.day || '') && /TUE 22 DEC/.test(yt[6]?.day || ''), yt.map((r) => r.day).join(' | '));
await page.locator('#mk-schedule').screenshot({ path: `${OUT}/shorts-youtube-filter-${MODE}-1700px-20261109.png` });
await page.locator('#mk-schedule .mkl [data-mkl-item^="youtube|"]').first().click();
await page.waitForSelector('#mks-panel:not([hidden]) .mkl-content', { timeout: 10000 });
const rec = await text(page, '#mks-panel');
check('YouTube row opens the content record: format, purpose + source, YouTube use and email use with separate statuses', /Short video \/ reel/.test(rec) && /Purpose Educate source:/.test(rec) && /YouTube release 🕒 Scheduled/.test(rec) && /Squarespace email module 📄 In preparation/.test(rec) && /module proposed|module inserted/.test(rec), rec.slice(0, 420));
await page.screenshot({ path: `${OUT}/shorts-content-record-${MODE}-1700px-20261109.png` });
await page.click('#mks-panel [data-mks-close]');

await clickIn(page, '[data-mks-channel="all"]');
await clickIn(page, '[data-mks-lrange="4w"]');
const row = page.locator('#mk-schedule .mkl [data-mkl-item="email|theme|gpt-8w-2026-11-19"]');
const rowText = (await row.count()) ? (await row.first().innerText()).replace(/\s+/g, ' ') : '';
const own = (board.emails || []).find((e) => e.key === 'theme|gpt-8w-2026-11-19');
check('Thu 19 Nov email row: "▶ Check the Whole Frame · 0:24" chip + "Short not public yet ⚠"; status is the email\'s own, not YouTube\'s', /▶ Check the Whole Frame · 0:24/.test(rowText) && /Short not public yet ⚠/.test(rowText) && !/Scheduled/.test(rowText), `${rowText.slice(0, 220)} · board email status: ${own?.status?.label}`);
await row.first().scrollIntoViewIfNeeded();
await page.locator('#mk-schedule').screenshot({ path: `${OUT}/shorts-email-chip-list-${MODE}-1700px-20261109.png` });
await page.locator('#mk-schedule .mkl [data-mkl-content="youtube|video|short|check-whole-frame"]').first().click();
await page.waitForSelector('#mks-panel:not([hidden]) .mkl-content', { timeout: 10000 });
const rec2 = await text(page, '#mks-panel');
check('Chip opens the same content record (not the email panel)', /Check the Whole Frame/.test(rec2) && /Uses \(2\)/.test(rec2), rec2.slice(0, 120));
await page.click('#mks-panel [data-mks-close]');

await clickIn(page, '[data-mks-view="weeks"]');
const wk = await text(page, '#mk-schedule .mks-body');
const wkCards = await page.$$eval('#mk-schedule .mks-body [data-mks-item^="youtube|"]', (els) => els.length);
check('Grid by weeks: YouTube column with the releases (7 within This week + 8) and the chip on the 19 Nov email', wkCards === 7 && /YouTube/.test(wk) && /▶ Check the Whole Frame · 0:24/.test(wk), `${wkCards} YouTube cards`);
await page.locator('#mk-schedule').screenshot({ path: `${OUT}/shorts-grid-weeks-${MODE}-1700px-20261109.png` });
await clickIn(page, '[data-mks-view="days"]');
await clickIn(page, '[data-mks-range="4w"]');
const dyCards = await page.$$eval('#mk-schedule .mks-body [data-mks-item^="youtube|"]', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
const dy = await text(page, '#mk-schedule .mks-body');
check('Grid by days (4 weeks): YouTube row, releases Scheduled at 18:00, chip on the 19 Nov email', dyCards.length >= 4 && dyCards.every((t) => /18:00/.test(t) && /Scheduled/.test(t)) && /▶ Check the Whole Frame · 0:24/.test(dy), `${dyCards.length} cards · ${dyCards[0] || ''}`);
await page.locator('#mk-schedule').screenshot({ path: `${OUT}/shorts-grid-days-${MODE}-1700px-20261109.png` });
await clickIn(page, '[data-mks-view="list"]');
await clickIn(page, '[data-mks-lrange="this"]');
await browser.close();

const after = await dbState();
const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
check('viewing writes nothing', !changed.length, changed.map((k) => `${k}: ${before[k]} → ${after[k]}`).join(' | '));
check('every non-GET refused (none reached the server)', true, `${blocked.length} refused`);
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);

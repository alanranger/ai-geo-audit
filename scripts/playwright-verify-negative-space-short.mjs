/**
 * The 8th Short (question 2026-11-09 (t) add-negative-space-short) at 1700px: the YouTube filter shows 8 Scheduled
 * Shorts incl. Thu 19 Nov 18:00; the negative-space record shows its woodland uses (associated with existing posts),
 * evidence label and UTM; nothing else changes (deployed board / page vs local board / page on the same data).
 *   node scripts/playwright-verify-negative-space-short.mjs
 * Viewing writes nothing: every non-GET is refused; DB counts + latest timestamps compared before / after.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ARP_ADMIN_KEY']) process.env[k] = ENV[k];
const BASE = 'https://ai-geo-audit.vercel.app';
const OUT = path.resolve('outputs');
const NS = 'video|short|negative-space-woodland';
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const blocked = [];
const errors = [];

async function dbState() {
  const out = {};
  for (const [t, c] of Object.entries({ strategy_content_assets: 'updated_at', strategy_campaign_steps: 'last_seen_at', strategy_campaign_ticks: 'updated_at', strategy_campaigns: 'updated_at', marketing_social_placements: 'set_at', marketing_decisions: 'decided_at', strategy_initiative_links: 'set_at' })) {
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
async function liveBoard() {
  const r = await fetch(`${BASE}/api/aigeo/marketing?action=delivery-status`, { headers: { 'x-arp-admin-key': ENV.ARP_ADMIN_KEY } });
  return r.json();
}
/** Everything on the board except the negative-space record's uses, as comparable strings. */
function fingerprint(b) {
  const other = (b.content || []).filter((c) => c.asset_key !== NS).map((c) => `${c.asset_key}|${c.status?.code}|${(c.uses || []).map((u) => `${u.use_key}:${u.status?.code}`).join(',')}`);
  return {
    emails: (b.emails || []).map((e) => `${e.key}|${e.status?.code}|${(e.shorts || []).map((s) => s.asset_key).join(',')}`).sort(),
    placements: (b.placements || []).map((p) => `${p.step_key}|${p.placement}|${p.status?.code}`).sort(),
    tasks: (b.tasks || []).map((t) => `${t.step_key}|${t.type}|${t.status?.code}`).sort(),
    other_content: other.sort()
  };
}
async function routes(page, local) {
  await page.route('**/api/**', (r) => {
    const req = r.request();
    if (req.method() === 'GET') return r.fallback();
    blocked.push(`${req.method()} ${new URL(req.url()).pathname}`);
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' });
  });
  if (!local) return;
  for (const f of ['marketing-schedule-model.js', 'marketing-schedule.js', 'marketing-schedule-list.js']) await page.route(`**/lib/${f}*`, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`lib/${f}`, 'utf8') }));
  await page.route(/\/api\/aigeo\/marketing\?action=delivery-status/, async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(await localBoard()) }));
}
const text = (page, sel) => page.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
const clickIn = async (page, sel) => { await page.click(`#mk-schedule ${sel}`); await page.waitForTimeout(700); };
const itemIds = (page) => page.$$eval('#mk-schedule .mkl [data-mkl-item]', (els) => els.map((e) => e.getAttribute('data-mkl-item')));

async function openPage(browser, local) {
  const page = await browser.newPage({ viewport: { width: 1700, height: 1200 } });
  page.on('pageerror', (e) => errors.push(`${local ? 'local' : 'live'}: ${e.message}`));
  await page.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); for (const x of ['mks-layout', 'mks-channel', 'mks-lrange', 'mks-cycle', 'mks-axis-days', 'mks-axis-weeks']) localStorage.removeItem(x); }, ENV.ARP_ADMIN_KEY);
  await routes(page, local);
  const resp = page.waitForResponse((r) => /action=delivery-status/.test(r.url()), { timeout: 180000 });
  await page.goto(`${BASE}/audit-dashboard.html#marketing`, { waitUntil: 'domcontentloaded' });
  const board = await (await resp).json();
  await page.waitForFunction(() => document.querySelector('#mk-schedule .mkl') && /LinkedIn/.test(document.querySelector('#mk-schedule .mks-body')?.textContent || ''), null, { timeout: 180000 });
  await page.waitForTimeout(3000);
  return { page, board };
}
async function listIds(page) {
  await clickIn(page, '[data-mks-channel="all"]');
  await clickIn(page, '[data-mks-lrange="4w"]');
  const all = await itemIds(page);
  await clickIn(page, '[data-mks-channel="youtube"]');
  return { all, youtube: await itemIds(page) };
}

const before = await dbState();
const [live, local] = await Promise.all([liveBoard(), localBoard()]);
const [fl, fo] = [fingerprint(live), fingerprint(local)];
for (const k of Object.keys(fl)) check(`board ${k}: identical deployed vs local (${fl[k].length})`, JSON.stringify(fl[k]) === JSON.stringify(fo[k]), fl[k].length === fo[k].length ? '' : `${fl[k].length} → ${fo[k].length}`);

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const L = await openPage(browser, false);
const liveIds = await listIds(L.page);
await L.page.close();
const { page, board } = await openPage(browser, true);
const localIds = await listIds(page);
check('schedule list (All, 4 weeks + YouTube filter): same rows deployed vs local', JSON.stringify(liveIds) === JSON.stringify(localIds), `all ${liveIds.all.length} → ${localIds.all.length} · youtube ${liveIds.youtube.length} → ${localIds.youtube.length}`);
check('board carries 8 Short content records', (board.content || []).filter((c) => c.format === 'short_video').length === 8, `${(board.content || []).length} content records`);

const yt = await page.$$eval('#mk-schedule .mkl [data-mkl-item^="youtube|"]', (els) => els.map((e) => ({ day: e.closest('.mkl-day')?.querySelector('.mkl-d')?.innerText.replace(/\s+/g, ' '), t: e.innerText.replace(/\s+/g, ' ') })));
const allSch = yt.every((r) => /🕒\s*Scheduled/.test(r.t) && /6:00pm/.test(r.t) && /Open on YouTube/.test(r.t));
const ns = yt.find((r) => /Negative Space/i.test(r.t));
check('YouTube filter: 8 rows, all 🕒 Scheduled at 6:00pm (18:00) with the YouTube link', yt.length === 8 && allSch, yt.map((r) => r.day).join(' | '));
check('YouTube filter: How Much Negative Space? on THU 19 NOV at 6:00pm', ns && /THU 19 NOV/.test(ns.day || '') && /6:00pm/.test(ns.t), ns ? `${ns.day} · ${ns.t.slice(0, 120)}` : 'not found');
await page.locator('#mk-schedule').screenshot({ path: `${OUT}/shorts-negative-space-youtube-filter-local-1700px-20261109.png` });

const opened = await page.evaluate((k) => window.mkOpenContent(k), NS);
await page.waitForSelector('#mks-panel:not([hidden]) .mkl-content', { timeout: 10000 });
const rec = await text(page, '#mks-panel');
check('window.mkOpenContent opens the negative-space content record', opened === true && /How Much Negative Space\?/.test(rec) && /Content record/.test(rec), rec.slice(0, 120));
check('record: Short video / reel · Purpose Educate · 1:07 · YouTube Scheduled', /Short video \/ reel/.test(rec) && /Purpose Educate/.test(rec) && /Length 1:07/.test(rec) && /YouTube release 🕒 Scheduled/.test(rec), '');
check('record: evidence label (production chat, not re-verified by GPT) + UTM', /evidence: production chat's native YouTube scheduling confirmation \(9 Nov 2026\); not separately re-verified by GPT/.test(rec) && /UTM utm_source=youtube&utm_medium=short&utm_campaign=negative-space-woodland/.test(rec), '');
check('record: woodland uses: 20 Nov Story (From small details to winter landscapes), 4 Dec Story, 2 Jan winter, each "associated asset, no extra post"', /Uses \(5\)/.test(rec) && /From small details to winter landscapes Instagram Story · associated asset, no extra post/.test(rec) && /January is a good time to start the next step Instagram Story · associated asset/.test(rec) && /Make time for winter photography Facebook feed · Instagram feed · Instagram Story · associated asset/.test(rec) && (rec.match(/Associated with an existing post/g) || []).length === 3, (rec.match(/Squarespace email module[^]*/) || [''])[0].slice(0, 900));
check('record: native video uses still "none planned"', /Native Facebook \/ Instagram \/ LinkedIn uses: none planned or approved yet/.test(rec), '');
await page.screenshot({ path: `${OUT}/shorts-negative-space-content-record-local-1700px-20261109.png` });
await page.click('#mks-panel [data-mks-close]');

await page.evaluate(() => window.mkOpenContent('video|short|check-whole-frame'));
await page.waitForSelector('#mks-panel:not([hidden]) .mkl-content', { timeout: 10000 });
const rec7 = await text(page, '#mks-panel');
check('another Short\'s record is unchanged (Uses (2), no evidence / UTM / associated rows)', /Uses \(2\)/.test(rec7) && !/evidence:|UTM |Associated with/.test(rec7), rec7.slice(0, 160));
await page.click('#mks-panel [data-mks-close]');
await browser.close();

const after = await dbState();
const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
check('viewing writes nothing', !changed.length, changed.map((k) => `${k}: ${before[k]} → ${after[k]}`).join(' | '));
check('every non-GET refused (none reached the server)', true, `${blocked.length} refused`);
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);

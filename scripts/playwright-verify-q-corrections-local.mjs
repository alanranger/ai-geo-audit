/**
 * QUESTION-2026-11-09 (q) corrections on LIVE data with the LOCAL code (before deploy), 1700px. Read-only:
 *  - serves the changed browser files from disk;
 *  - answers GET ?action=delivery-status and /api/aigeo/strategy-summary with the local builders on a Supabase client
 *    whose writes (insert / upsert / update / delete / rpc) are blocked and logged (none expected);
 *  - refuses every non-GET request (403) and lists them.
 * Checks items 1–8 + 13 on screen, the native-queue counts, and the cold-load timing (RUNS cold loads, local).
 *   node scripts/playwright-verify-q-corrections-local.mjs
 * Screenshots: outputs/q-corrections-*-local-1700px-20261109.png
 */
import fs from 'node:fs';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
Object.assign(process.env, { SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: ENV.SUPABASE_SERVICE_ROLE_KEY });
const BASE = 'https://ai-geo-audit.vercel.app';
const OUT = 'outputs';
const SHOT = (name) => `${OUT}/q-corrections-${name}-local-1700px-20261109.png`;
const RUNS = Number(process.env.RUNS || 2);
/** BEFORE=1: timing only, with HEAD's versions of the same browser files (same local handlers) for a like-for-like before. */
const BEFORE = process.env.BEFORE === '1';
const { execSync } = await import('node:child_process');
const sourceOf = (file) => (BEFORE ? execSync(`git show HEAD:lib/${file}`, { encoding: 'utf8', maxBuffer: 1 << 26 }) : fs.readFileSync(`lib/${file}`, 'utf8'));
const LOCAL_FILES = ['marketing-schedule-list.js', 'marketing-schedule.js', 'marketing-tab.js', 'marketing-waiting.js', 'marketing-overview-tiles.js', 'marketing-delivery.js', 'strategy-quarter-plan.js'];
const BLUR = '.mk-detail, #mk-cust-body, #mq-results td:first-child, #mk-review-table td:first-child { filter: blur(6px) !important; }';
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const refused = [];
const blockedWrites = [];
const pageErrors = [];

/* ---------- a Supabase client that never writes ---------- */

const WRITES = new Set(['insert', 'upsert', 'update', 'delete']);
function inert(label) {
  blockedWrites.push(label);
  const p = new Proxy(() => {}, { get: (_t, k) => (k === 'then' ? (ok) => ok({ data: null, error: null }) : () => p), apply: () => p });
  return p;
}
function readOnly(sb) {
  const wrapFrom = (table) => new Proxy(sb.from(table), { get: (t, k) => (WRITES.has(k) ? () => inert(`${table}.${String(k)}`) : (typeof t[k] === 'function' ? t[k].bind(t) : t[k])) });
  return new Proxy(sb, { get: (t, k) => {
    if (k === 'from') return wrapFrom;
    if (k === 'rpc') return (name) => inert(`rpc ${name}`);
    return typeof t[k] === 'function' ? t[k].bind(t) : t[k];
  } });
}
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ro = readOnly(sb);
const { buildStatusBoard } = await import('../lib/marketing/delivery-status-board.mjs');
const { buildStrategySummary } = await import('../lib/strategy-summary.mjs');
const json = (o) => JSON.stringify({ ok: true, ...o });
const timed = async (fn) => { const t0 = Date.now(); const v = await fn(); return { v, ms: Date.now() - t0 }; };
const serverMs = { board: [], summary: [] };
async function localBoard() { const r = await timed(() => buildStatusBoard(ro)); serverMs.board.push(r.ms); return json(r.v); }
async function localSummary() {
  const r = await timed(() => buildStrategySummary(ro, 'https://www.alanranger.com', { noBackfill: true, insights: true }).catch((e) => ({ ok: false, error: e.message })));
  serverMs.summary.push(r.ms);
  return r.v.ok === false ? JSON.stringify(r.v) : json(r.v);
}

async function routes(page) {
  await page.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); localStorage.setItem('mks-layout', 'list'); localStorage.setItem('mks-channel', 'all'); localStorage.setItem('mks-lrange', '4w'); }, ENV.ARP_ADMIN_KEY);
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() !== 'GET') {
      if (url.pathname.startsWith('/api/')) refused.push(`${req.method()} ${url.pathname}`);
      return route.fulfill({ status: 403, contentType: 'application/json', body: '{"ok":false,"error":"read-only verification: non-GET refused"}' });
    }
    const file = LOCAL_FILES.find((f) => url.pathname === `/lib/${f}`);
    if (file) return route.fulfill({ status: 200, contentType: 'application/javascript', body: sourceOf(file) });
    if (url.pathname === '/api/aigeo/marketing' && url.searchParams.get('action') === 'delivery-status') return route.fulfill({ status: 200, contentType: 'application/json', body: await localBoard() });
    if (url.pathname === '/api/aigeo/strategy-summary') return route.fulfill({ status: 200, contentType: 'application/json', body: await localSummary() });
    return route.fallback();
  });
}
async function open(browser, hash) {
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await routes(page);
  return { ctx, page, t0: Date.now(), go: () => page.goto(`${BASE}/audit-dashboard.html#${hash}`, { waitUntil: 'domcontentloaded' }) };
}
const secs = (t0) => Math.round((Date.now() - t0) / 100) / 10;
/** Waits until fn is true (a navigation that resets the page context is retried, never taken as "ready"); 180 s cap. */
async function waitFor(page, t0, fn, arg) {
  while (Date.now() - t0 < 180000) {
    const ok = await page.waitForFunction(fn, arg, { timeout: 180000 - (Date.now() - t0) }).then(() => true, () => false);
    if (ok) return secs(t0);
    await page.waitForTimeout(500);
  }
  return null;
}

/* ---------- cold-load timing (fresh context each run) ---------- */

async function coldLoad(browser) {
  const o = await open(browser, 'marketing');
  await o.go();
  const t = {};
  t.statusRow = await waitFor(o.page, o.t0, () => /Scheduled on platform|Partly scheduled/.test(document.querySelector('#mk-schedule .mks-body')?.textContent || ''));
  t.waiting = await waitFor(o.page, o.t0, () => /^\d+$/.test(document.querySelector('#mk-waiting .mkw-n')?.textContent.trim() || ''));
  t.tiles = await waitFor(o.page, o.t0, () => { const x = document.querySelector('#mk-overview-tiles'); return x && x.querySelector('.mko-tile') && !/Loading|loading…/i.test(x.innerText); });
  t.full = await waitFor(o.page, o.t0, () => !document.querySelector('#mk-planned.mkw-loading') && /Tasks/.test(document.querySelector('#mk-schedule .mks-body')?.textContent || ''));
  await o.ctx.close();
  return t;
}

/* ---------- the checks ---------- */

const text = (page, sel) => page.evaluate((s) => document.querySelector(s)?.innerText || '', sel);
async function openRow(page, stepKey) {
  await page.click(`[data-mkl-item^="fbig|${stepKey}"]`);
  await page.waitForSelector('#mks-panel:not([hidden]) .mks-pitem', { timeout: 20000 });
  await page.waitForTimeout(800);
  return text(page, '#mks-panel');
}
async function drawerChecks(page) {
  for (const [name, key] of [['macro', 'gpt-8w-social-2026-11-10-fbig'], ['norfolk', 'gpt-8w-social-2026-11-13-fbig']]) {
    const row = await page.evaluate((k) => document.querySelector(`[data-mkl-item^="fbig|${k}"] .mkl-s`)?.innerText || '', key);
    const panel = await openRow(page, key);
    const plc = await page.evaluate(() => document.querySelectorAll('#mks-panel .mks-plc').length);
    const caps = await page.evaluate(() => [...document.querySelectorAll('#mks-panel .mks-plc pre')].map((p) => p.textContent.slice(0, 50)));
    check(`item 1 (${name}): drawer = list status (${row.split('\n')[0]}), existing approval, no "Approve caption & artwork" / Draft / not scheduled`, /Scheduled on platform/.test(panel) && /Main artwork approved by Alan/.test(panel) && !/Approve caption &|Not ready to approve|Draft ·|not scheduled/.test(panel) && panel.includes(row.split('\n')[0]), `list "${row.replace(/\n/g, ' | ')}" · drawer head "${panel.split('\n').slice(2, 4).join(' | ')}"`);
    check(`item 1 (${name}): scheduled caption + asset per placement (FB feed, IG feed, IG Story)`, plc === 3 && caps.length === 3, `${plc} placement blocks · captions: ${caps.map((c) => `"${c}…"`).join(' / ')}`);
    await page.screenshot({ path: SHOT(`drawer-${name}`) });
    await page.click('[data-mks-close]');
  }
}
async function listChecks(page) {
  const rows = await page.evaluate(() => [...document.querySelectorAll('#mk-schedule .mkl-row')].map((r) => r.innerText.replace(/\s+/g, ' ').trim()));
  const fbig = rows.filter((r) => /Facebook · Instagram · Story/.test(r));
  check('item 2: every combined FB / IG / Story row names each placement with its own status', fbig.length && fbig.every((r) => /FB feed \w+.*IG feed \w+.*IG Story/.test(r)), `${fbig.length} rows · e.g. "${(fbig[0] || '').slice(0, 170)}"`);
  check('item 2: a row says "Scheduled on platform" only when every placement is scheduled; mixed rows say "Partly scheduled"', fbig.every((r) => !/Scheduled on platform/.test(r) || !/pending|waiting|preparation/.test(r)), fbig.filter((r) => /Partly scheduled/.test(r)).length ? `${fbig.filter((r) => /Partly/.test(r)).length} partly scheduled` : 'no mixed rows in range now (all 9 Stories scheduled by GPT)');
  const ll = rows.find((r) => /Light & Logic newsletter/.test(r)) || '';
  check('item 3: Light & Logic shows "On hold (Alan)", dependency kept, no "being prepared by GPT" / due date / promoted-in', /On hold \(Alan\)/.test(ll) && /planned dependency/.test(ll) && !/being prepared by GPT|promoted in:|Planned/.test(ll), ll.slice(0, 260));
  const subj = await page.evaluate(() => [...document.querySelectorAll('#mk-schedule .mkl-subj')].map((e) => e.textContent));
  check('item 4: the real Squarespace subject shows under the friendly campaign name', subj.length > 0, subj.join(' · ').slice(0, 300));
  const tasks = await text(page, '#mk-schedule .mkl-tasks');
  const gbp = tasks.split('\n').filter((l) => /Google Business update/.test(l));
  check('item 6: Google optional-post briefs owned by GPT (Alan only for a commercial approval)', gbp.every((l) => /owner GPT/.test(l)), gbp.length ? gbp.join(' | ').slice(0, 220) : 'no optional Google update in this range (brief text covered by the unit test)');
  await page.evaluate(() => document.querySelector('#mk-schedule .mks-body')?.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(400);
  await page.screenshot({ path: SHOT('list') });
  await page.evaluate(() => [...document.querySelectorAll('#mk-schedule .mkl-row')].find((r) => /Light & Logic newsletter/.test(r.textContent))?.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(400);
  await page.screenshot({ path: SHOT('ll-hold') });
  return rows;
}
async function tileChecks(page) {
  await page.evaluate(() => document.querySelectorAll('#mk-overview-tiles details').forEach((d) => { d.open = true; }));
  const tiles = await text(page, '#mk-overview-tiles');
  const mix = tiles.slice(tiles.indexOf('content mix'), tiles.indexOf('content mix') + 900);
  check('item 5: content-mix tile keeps approval apart from scheduling ("Approved · waiting for platform window", drafts = not approved)', /Approved · waiting for platform window/.test(mix) && /Drafts \(not approved\)/.test(mix), mix.replace(/\n/g, ' | ').slice(0, 400));
  const cap = tiles.match(/([\d,]+) client recipients? \+ ([\d,]+) business cop(?:y|ies)(?: \+ [\d,]+ owner address(?:es)?)? = ([\d,]+) credits?/);
  const committed = tiles.match(/Committed \(scheduled \/ frozen\)\s*([\d,]+)/);
  check('item 7: credits label beside the counts, computed (= the committed figure)', !!cap && !!committed && cap[3] === committed[1], `${cap ? cap[0] : 'no label'} · committed ${committed ? committed[1] : '?'}`);
  await page.locator('#mk-overview-tiles').scrollIntoViewIfNeeded();
  await page.screenshot({ path: SHOT('tiles') });
}
async function backfillCheck(page) {
  await page.evaluate(() => { const f = document.getElementById('mk-behind'); if (f) f.open = true; });
  await page.waitForFunction(() => /Collector backfill/.test(document.querySelector('#mk-sources')?.textContent || ''), null, { timeout: 60000 }).catch(() => null);
  const row = await page.evaluate(() => [...document.querySelectorAll('#mk-sources tr')].find((tr) => /Collector backfill/.test(tr.textContent))?.innerText.replace(/\s+/g, ' ') || '');
  check('item 8: finished one-off backfill = "completed historical backfill", not STALE', /COMPLETED/.test(row) && /completed historical backfill/.test(row) && !/STALE/.test(row), row.slice(0, 220));
  await page.locator('#mk-sources').scrollIntoViewIfNeeded().catch(() => null);
  await page.addStyleTag({ content: BLUR });
  await page.screenshot({ path: SHOT('backfill') });
}

/* ---------- native queues vs the board (the ONE status source) ---------- */

async function queueCounts() {
  const b = await buildStatusBoard(ro);
  const sch = (pl) => b.placements.filter((p) => p.placement === pl && p.status.code === 'scheduled').length;
  const yt = (b.content || []).filter((c) => c.status?.code === 'scheduled').length;
  const sq = b.emails.filter((e) => e.status?.code === 'scheduled').length;
  const pub = b.placements.filter((p) => p.status.code === 'published').map((p) => `${p.placement} ${p.step_key}`);
  const got = { fb: sch('facebook_feed'), ig: sch('instagram_feed'), story: sch('instagram_story'), linkedin: sch('linkedin_feed'), youtube: yt, squarespace: sq };
  check('native queues: Meta 18 feed (9 FB + 9 IG) + 9 Stories, LinkedIn 8, YouTube 7, Squarespace 5 — board agrees', got.fb + got.ig === 18 && got.story === 9 && got.linkedin === 8 && got.youtube === 7 && got.squarespace === 5, JSON.stringify(got));
  check('nothing published by time alone (published = provider / live-check evidence only)', pub.every((x) => /linkedin_feed gpt-8w-social-linkedin-2026-11-09|linkedin/.test(x)), pub.join(', ') || 'none');
  const subjects = b.emails.filter((e) => e.status?.code === 'scheduled').map((e) => `${e.title} → "${e.subject}"`);
  return { got, subjects };
}

async function strategyCheck(browser) {
  const o = await open(browser, 'strategy');
  await o.go();
  await waitFor(o.page, o.t0, () => /Next:/.test(document.querySelector('#st-quarter-plan')?.textContent || ''));
  await o.page.waitForTimeout(2500);
  const lines = await o.page.evaluate(() => [...document.querySelectorAll('#st-quarter-plan .qp-l')].map((e) => e.textContent.trim()).filter((t) => /^Next:/.test(t)));
  const bad = lines.filter((l) => / draft: /.test(l) && /Scheduled|Published|waiting for Meta/.test(l));
  check('item 13: Quarter plan "Next" uses the actual delivery status (no "FB/IG draft" on scheduled content)', lines.length && !bad.length, `${lines.length} Next lines · ${lines.filter((l) => /FB\/IG/.test(l)).slice(0, 3).join(' | ')}${bad.length ? ` · BAD: ${bad.join(' | ')}` : ''}`);
  await o.page.locator('#st-quarter-plan').scrollIntoViewIfNeeded().catch(() => null);
  await o.page.screenshot({ path: SHOT('quarter-plan') });
  await o.ctx.close();
}

const log = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const timing = [];
for (let i = 0; i < RUNS; i += 1) { timing.push(await coldLoad(browser)); log(`cold load ${i + 1}${BEFORE ? ' (HEAD browser files)' : ''}: ${JSON.stringify(timing[i])}`); }
if (BEFORE) { await browser.close(); process.exit(0); }
const main = await open(browser, 'marketing');
await main.go();
await waitFor(main.page, main.t0, () => !document.querySelector('#mk-planned.mkw-loading') && /Tasks/.test(document.querySelector('#mk-schedule .mks-body')?.textContent || ''));
await main.page.waitForTimeout(2500);
log('marketing loaded');
await listChecks(main.page);
log('list checked');
await drawerChecks(main.page);
log('drawers checked');
await tileChecks(main.page);
await backfillCheck(main.page);
log('tiles + backfill checked');
await main.ctx.close();
await strategyCheck(browser);
log('strategy checked');
const queues = await queueCounts();
await browser.close();

const med = (k) => { const v = timing.map((r) => r[k]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
check('item 10: Marketing cold load (local code, live data) under 30 s, fully settled', med('full') < 30, `median: first platform status row ${med('statusRow')} s · first Waiting row ${med('waiting')} s · overview tiles ${med('tiles')} s · full List ${med('full')} s · runs ${JSON.stringify(timing)}`);
const tally = (list) => Object.entries(list.reduce((o, x) => ({ ...o, [x]: (o[x] || 0) + 1 }), {})).map(([k, v]) => `${k} ×${v}`).join(', ');
check('read-only: every non-GET refused in the browser (never sent); every DB write by the local builders blocked', true, `refused: ${tally(refused) || 'none'} · blocked writes: ${tally(blockedWrites) || 'none'}`);
check('no page errors', !pageErrors.length, pageErrors.slice(0, 5).join(' | ') || 'none');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(`server: board ${JSON.stringify(serverMs.board)} ms · strategy summary ${JSON.stringify(serverMs.summary)} ms`);
console.log(`scheduled email subjects: ${queues.subjects.join(' · ')}`);
fs.writeFileSync(`${OUT}/_q-corrections-local.json`, JSON.stringify({ results, timing, serverMs, queues, refused, blockedWrites }, null, 1));

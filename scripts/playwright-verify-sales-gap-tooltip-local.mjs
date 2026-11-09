/**
 * QUESTION-2026-11-09 (s): monthly "If all sold" ⓘ tooltip (hover at 1700px, tap on a touch viewport) with the LOCAL view
 * on production data. Read-only: production pages + GET APIs; only /lib/strategy-sales-gap.js is swapped (before = HEAD,
 * after = working tree), rendered back-to-back per viewport from the same API bodies; every non-GET is refused; DB row
 * counts + newest timestamps compared before / after.
 *   node scripts/playwright-verify-sales-gap-tooltip-local.mjs              (local: HEAD vs working tree)
 *   PHASE=live node scripts/playwright-verify-sales-gap-tooltip-local.mjs   (production files + APIs only)
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
const BASE = 'https://ai-geo-audit.vercel.app';
const OUT = 'outputs';
const TABLES = { strategy_event_snapshots: 'created_at', strategy_campaign_steps: 'last_seen_at', strategy_event_promotion_flags: 'set_at', prospect_enquiry: 'updated_at' };
const VIEWS = [{ key: '1700px', viewport: { width: 1700, height: 1100 } }, { key: 'touch-1024px', viewport: { width: 1024, height: 1366 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }];
/* At 390px the dashboard shell's fixed sidebar leaves the Strategy panel 66px wide (tiles 31px, overlapping), so the tap
 * check runs on a tablet-size touch viewport. */
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const blocked = [];
const errors = [];
const LIVE = process.env.PHASE === 'live';
const VERSION = 'tt-20261109a';
const VIEW = { before: execSync('git show HEAD:lib/strategy-sales-gap.js', { encoding: 'utf8' }), after: fs.readFileSync('lib/strategy-sales-gap.js', 'utf8') };
/** Both renders of a viewport get the SAME strategy-summary / prospects bodies, so live data churn can't show as a change. */
const CACHED = ['/api/aigeo/strategy-summary', '/api/aigeo/prospects'];

async function dbState() {
  const out = {};
  for (const [t, c] of Object.entries(TABLES)) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true });
    const { data } = await sb.from(t).select(c).not(c, 'is', null).order(c, { ascending: false }).limit(1);
    Object.assign(out, { [`${t}.rows`]: count ?? 'n/a', [`${t}.max`]: data?.[0]?.[c] || null });
  }
  return out;
}
const makeRoute = (view, cache) => async (r) => {
  const req = r.request();
  const url = new URL(req.url());
  if (req.method() !== 'GET') { if (url.pathname.startsWith('/api/')) blocked.push(`${req.method()} ${url.pathname}`); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' }); }
  if (view && url.pathname === '/lib/strategy-sales-gap.js') return r.fulfill({ status: 200, contentType: 'application/javascript', body: view });
  if (!CACHED.includes(url.pathname)) return r.fallback();
  if (cache[url.pathname]) return r.fulfill({ status: 200, contentType: 'application/json', body: cache[url.pathname] });
  const resp = await r.fetch();
  cache[url.pathname] = await resp.text();
  return r.fulfill({ response: resp, body: cache[url.pathname] });
};
/** Every Strategy block, each monthly tile and the quarter tile (position, size, visible text; quarter HTML). */
function layoutOf() {
  const panel = document.querySelector('section[data-panel="strategy"]');
  const top = panel.getBoundingClientRect().top;
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y - top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const txt = (el) => (el.innerText || '').replace(/\s+/g, ' ').trim();
  const q = document.querySelector('#st-sales-gap .sg-q');
  return {
    panel_top: Math.round(top + window.scrollY),
    blocks: [...panel.querySelectorAll('[id^="st-"]')].filter((el) => el.offsetParent !== null).map((el) => ({ id: el.id, ...box(el), text: txt(el) })),
    months: [...document.querySelectorAll('#st-sales-gap [data-sg-month]')].map((el) => ({ id: el.dataset.sgMonth, ...box(el), text: txt(el).replace(/ⓘ/g, '').replace(/\s+/g, ' ') })),
    quarter: { ...box(q), html: q.outerHTML }
  };
}
/** The tooltip state of one month tile: bubble visible + its box, and the Total row's "If all sold" title. */
function tipState(key) {
  const m = document.querySelector(`#st-sales-gap [data-sg-month="${key}"]`);
  const b = m.querySelector('.sg-tipb');
  const r = b?.getBoundingClientRect();
  const tot = m.querySelector('.sg-mcat tr.sg-qtot td:nth-child(4)');
  return { icons: m.querySelectorAll('[data-sg-tip]').length, head: m.querySelector('.sg-mcat th:nth-child(4)')?.firstChild?.textContent.trim(), text: b?.textContent, shown: b ? getComputedStyle(b).display !== 'none' : false, box: r ? { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), w: window.innerWidth } : null, title: tot?.getAttribute('title') || null, expanded: m.querySelector('[data-sg-tip]')?.getAttribute('aria-expanded') };
}

async function openPage(browser, v, view, cache) {
  const ctx = await browser.newContext({ viewport: v.viewport, hasTouch: !!v.hasTouch, isMobile: !!v.isMobile, deviceScaleFactor: v.deviceScaleFactor || 1 });
  await ctx.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); }, ENV.ARP_ADMIN_KEY);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${v.key}: ${e.message}`));
  await page.route('**/*', makeRoute(view, cache));
  await page.goto(`${BASE}/audit-dashboard.html#strategy`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#st-sales-gap [data-sg-month]') && document.querySelector('#st-fold-why'), null, { timeout: 240000 });
  await page.waitForTimeout(4000);
  await page.evaluate(() => [...document.querySelectorAll('body *')].filter((el) => getComputedStyle(el).position === 'fixed' && el.getBoundingClientRect().top > window.innerHeight / 2).forEach((el) => { el.style.visibility = 'hidden'; }));
  return { ctx, page };
}
const shot = (name, v, phase = LIVE ? 'live' : 'after-local') => `${OUT}/sales-gap-tooltip-${name}-${phase}-${v.key}-20261109.png`;
async function exercise(page, v, key) {
  const icon = page.locator(`#st-sales-gap [data-sg-month="${key}"] [data-sg-tip]`);
  const card = page.locator(`#st-sales-gap [data-sg-month="${key}"]`);
  await card.scrollIntoViewIfNeeded();
  const closed = await page.evaluate(tipState, key);
  if (v.hasTouch) await icon.tap(); else await icon.hover();
  await page.waitForTimeout(250);
  const open = await page.evaluate(tipState, key);
  await card.screenshot({ path: shot(`${key}-open`, v) });
  if (v.hasTouch) await page.locator('#st-sales-gap h3').tap(); else await page.mouse.move(5, 5);
  await page.waitForTimeout(250);
  return { closed, open, after: await page.evaluate(tipState, key) };
}

const TIP = (s) => `Full-price value of the unsold places on the events people normally book this month. The same event can be in its buying window in more than one month, so these figures overlap and don't add up to the quarter's £${(Math.round(s.sales_gap.rolling.stock.gbp / 100) / 10).toFixed(1)}k stock.`;
const inView = (b) => !!b && b.l >= 0 && b.r <= b.w;
const ariaOk = (v, st) => !v.hasTouch || (st.open.expanded === 'true' && st.after.expanded === 'false');
function tipChecks(v, key, st, summary) {
  const tip = TIP(summary);
  const how = v.hasTouch ? { show: 'tap shows', hide: 'a tap elsewhere', until: 'tapped' } : { show: 'hover shows', hide: 'moving away', until: 'hovered' };
  check(`${v.key} ${key}: one ⓘ on "If all sold", exact text, hidden until ${how.until}`, st.closed.icons === 1 && st.closed.head === 'If all sold' && st.closed.text === tip && !st.closed.shown, `"${String(st.closed.text).slice(-60)}"`);
  check(`${v.key} ${key}: ${how.show} the tooltip inside the screen; ${how.hide} hides it`, st.open.shown && inView(st.open.box) && !st.after.shown && ariaOk(v, st), `box ${JSON.stringify(st.open.box)} · after ${st.after.shown ? 'shown' : 'hidden'}`);
  check(`${v.key} ${key}: Total row "If all sold" cell has the same text as a hover title`, st.closed.title === tip, st.closed.title === tip ? 'same text' : String(st.closed.title));
}
const clean = (t) => String(t).replace(/\b\d{1,2}:\d{2}\b/g, 'HH:MM').replace(/ ?ⓘ/g, '');
function diffChecks(v, layout, prior) {
  const same = (a, b) => a && b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && clean(a.text) === clean(b.text);
  const moved = layout.blocks.filter((b) => !same(b, prior.blocks.find((x) => x.id === b.id))).map((b) => b.id);
  const shell = layout.panel_top === prior.panel_top ? '' : ` · the dashboard shell above the Strategy panel rendered ${layout.panel_top - prior.panel_top}px taller on this load (outside the Strategy panel)`;
  check(`${v.key}: nothing else moved (every Strategy block: same position within the panel, size and text)`, !moved.length && layout.blocks.length === prior.blocks.length, (moved.join(', ') || `${layout.blocks.length} blocks identical`) + shell);
  const mm = layout.months.filter((m) => !same(m, prior.months.find((x) => x.id === m.id))).map((m) => `${m.id} ${JSON.stringify(prior.months.find((x) => x.id === m.id))?.slice(0, 60)}`);
  check(`${v.key}: the three monthly tiles keep their position, size and visible text (bar the ⓘ)`, !mm.length, mm.join(' | ') || '3 tiles identical');
  check(`${v.key}: quarter tile unchanged (same HTML, position and size)`, layout.quarter.html === prior.quarter.html && same({ ...layout.quarter, text: '' }, { ...prior.quarter, text: '' }), `${prior.quarter.w}×${prior.quarter.h} → ${layout.quarter.w}×${layout.quarter.h}`);
}

/** PHASE=live: the deployed files and APIs only (GET), served ?v= checked against the committed file. */
async function liveView(browser, v) {
  const cache = {};
  const { ctx, page } = await openPage(browser, v, null, cache);
  const served = await page.evaluate(async () => {
    const src = document.querySelector('script[src*="/lib/strategy-sales-gap.js"]')?.getAttribute('src') || '';
    return { src, body: src ? await (await fetch(src, { cache: 'no-store' })).text() : '' };
  });
  const committed = execSync('git show 2c15cbb9:lib/strategy-sales-gap.js', { encoding: 'utf8' }).replace(/\r\n/g, '\n');
  check(`${v.key}: production serves strategy-sales-gap.js?v=${VERSION}, byte-identical to 2c15cbb9`, served.src.endsWith(`?v=${VERSION}`) && served.body.replace(/\r\n/g, '\n') === committed, `${served.src} · ${served.body.length} bytes`);
  await page.locator('#st-sales-gap').screenshot({ path: shot('tiles', v) });
  const summary = JSON.parse(cache['/api/aigeo/strategy-summary']);
  for (const key of ['2026-11', '2026-12', '2027-01']) tipChecks(v, key, await exercise(page, v, key), summary);
  const q = await page.evaluate(() => document.querySelector('#st-sales-gap .sg-q')?.outerHTML || '');
  check(`${v.key}: quarter tile has no tooltip (its If all sold is the true total)`, q && !/data-sg-tip|title="/.test(q), `${q.length} chars`);
  await ctx.close();
}

const before = await dbState();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const snap = {};
for (const v of VIEWS) {
  if (LIVE) { await liveView(browser, v); continue; }
  const cache = {};
  const a = await openPage(browser, v, VIEW.before, cache);
  const prior = await a.page.evaluate(layoutOf);
  await a.page.locator('#st-sales-gap').screenshot({ path: shot('tiles', v, 'before') });
  await a.ctx.close();
  const { ctx, page } = await openPage(browser, v, VIEW.after, cache);
  snap[v.key] = { before: prior, after: await page.evaluate(layoutOf) };
  await page.locator('#st-sales-gap').screenshot({ path: shot('tiles', v) });
  const summary = JSON.parse(cache['/api/aigeo/strategy-summary']);
  for (const key of ['2026-11', '2026-12', '2027-01']) tipChecks(v, key, await exercise(page, v, key), summary);
  diffChecks(v, snap[v.key].after, prior);
  await ctx.close();
}
await browser.close();
const after = await dbState();
const changed = Object.keys(before).filter((x) => before[x] !== after[x]);
check('viewing writes nothing (row counts + newest timestamps)', !changed.length, changed.map((x) => `${x}: ${before[x]} → ${after[x]}`).join(' | ') || `${Object.keys(TABLES).length} tables unchanged`);
check('every non-GET refused', true, `${blocked.length} refused: ${[...new Set(blocked)].join(', ') || 'none attempted'}`);
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
if (!LIVE) fs.writeFileSync(`${OUT}/_tt-layout.json`, JSON.stringify(snap, null, 1));
fs.writeFileSync(`${OUT}/_tt-${LIVE ? 'live-' : ''}result.json`, JSON.stringify({ results, before, after }, null, 1));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
process.exit(0);

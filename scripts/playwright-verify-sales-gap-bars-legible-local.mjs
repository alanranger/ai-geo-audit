/**
 * QUESTION-2026-11-09 (ee) legible bars, LOCAL view on LIVE data, 1700px. Read-only: production pages + GET APIs (the
 * same strategy-summary / prospects bodies for both renders); only /lib/strategy-sales-gap.js is swapped (before = HEAD,
 * after = working tree); every non-GET refused. Enquiry labels are masked before the screenshot; nothing personal saved.
 *   node scripts/playwright-verify-sales-gap-bars-legible-local.mjs
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
const BASE = 'https://ai-geo-audit.vercel.app';
const OUT = 'outputs';
/** PHASE=live: production files + APIs (GET); "before" = the same page with only the parent commit's view. */
const LIVE = process.env.PHASE === 'live';
const COMMIT = 'dffc1945';
const VERSION = 'lg-20261109a';
const VIEW = LIVE
  ? { before: execSync(`git show ${COMMIT}~1:lib/strategy-sales-gap.js`, { encoding: 'utf8' }), after: null }
  : { before: execSync('git show HEAD:lib/strategy-sales-gap.js', { encoding: 'utf8' }), after: fs.readFileSync('lib/strategy-sales-gap.js', 'utf8') };
const CACHED = ['/api/aigeo/strategy-summary', '/api/aigeo/prospects'];
const API = {};
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const blocked = [];
const errors = [];

const makeRoute = (view) => async (r) => {
  const req = r.request();
  const url = new URL(req.url());
  if (req.method() !== 'GET') { if (url.pathname.startsWith('/api/')) blocked.push(`${req.method()} ${url.pathname}`); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' }); }
  if (view && url.pathname === '/lib/strategy-sales-gap.js') return r.fulfill({ status: 200, contentType: 'application/javascript', body: view });
  if (!CACHED.includes(url.pathname)) return r.fallback();
  if (!API[url.pathname]) API[url.pathname] = await (await r.fetch()).text();
  return r.fulfill({ status: 200, contentType: 'application/json', body: API[url.pathname] });
};
async function render(browser, view) {
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
  await ctx.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); }, ENV.ARP_ADMIN_KEY);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await ctx.route('**/*', makeRoute(view));
  await page.goto(`${BASE}/audit-dashboard.html#strategy`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#st-sales-gap [data-sg-month]') && document.querySelector('#st-fold-why'), null, { timeout: 240000 });
  await page.waitForTimeout(3500);
  await page.evaluate(() => [...document.querySelectorAll('body *')].filter((el) => getComputedStyle(el).position === 'fixed' && el.getBoundingClientRect().top > window.innerHeight / 2).forEach((el) => { el.style.visibility = 'hidden'; }));
  return { ctx, page };
}
/** Tile heights + every other Strategy block (relative to the panel, so a shell change above it can't count). */
function layoutOf() {
  const panel = document.querySelector('section[data-panel="strategy"]');
  const top = panel.getBoundingClientRect().top;
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y - top), w: Math.round(r.width), h: Math.round(r.height) }; };
  return {
    tiles: [...document.querySelectorAll('#st-sales-gap .sg-grid .sg-card')].map((c) => ({ key: c.dataset.sgMonth || 'quarter', ...box(c) })),
    grid: box(document.querySelector('#st-sales-gap .sg-grid')),
    blocks: [...panel.querySelectorAll('[id^="st-"]')].filter((el) => el.offsetParent !== null && el.id !== 'st-sales-gap').map((el) => ({ id: el.id, ...box(el), len: (el.innerText || '').replace(/\b\d{1,2}:\d{2}\b/g, 'HH:MM').replace(/\s+/g, ' ').length })),
    cover: document.getElementById('sg-cover')?.outerHTML || '', tables: [...document.querySelectorAll('#st-sales-gap .sg-grid table')].map((t) => t.outerHTML).join('')
  };
}
/** Computed styles per tile: bar heights, every segment's text, font, colour and whether it is cut off. */
function stylesOf() {
  const cs = (el) => getComputedStyle(el);
  const seg = (el) => ({ cls: el.className, text: el.textContent, size: cs(el).fontSize, weight: cs(el).fontWeight, color: cs(el).color, shadow: cs(el).textShadow, bg: cs(el).backgroundColor, border: cs(el).borderTopStyle, align: cs(el).textAlign, w: el.clientWidth, cut: el.scrollWidth > el.clientWidth });
  return [...document.querySelectorAll('#st-sales-gap .sg-grid .sg-card')].map((c) => {
    const out = c.querySelector('.sg-gapout');
    return {
      key: c.dataset.sgMonth || 'quarter', barH: c.querySelector('.sg-bar')?.getBoundingClientRect().height, covH: c.querySelector('.sg-covbar')?.getBoundingClientRect().height,
      segs: [...c.querySelectorAll('.sg-bar > span, .sg-covbar > .sg-cs')].map(seg), out: out && !out.hidden ? seg(out) : null,
      key12: cs(c.querySelector('.sg-covkey')).fontSize, keyColor: cs(c.querySelector('.sg-covkey')).color
    };
  });
}

const DARK = 'rgb(11, 14, 20)';
const AMBER = 'rgb(240, 180, 41)';
const k1 = (v) => `£${(Math.round((Number(v) || 0) / 100) / 10).toFixed(1)}k`;
function styleChecks(st) {
  for (const t of st) {
    const texts = t.segs.filter((s) => s.text);
    const dark = texts.filter((s) => !/sg-s-pr|sg-s-gap/.test(s.cls));
    const okDark = dark.every((s) => s.size === '14px' && s.weight === '700' && s.color === DARK);
    const okPr = texts.filter((s) => /sg-s-pr/.test(s.cls)).every((s) => s.color === 'rgb(255, 255, 255)' && s.shadow !== 'none');
    check(`${t.key}: both bars 28px; values 14px bold, dark on blue / green / purple (white + shadow on prospects); none cut off; key 12px #c3c9d4`, t.barH === 28 && t.covH === 28 && okDark && okPr && !texts.some((s) => s.cut) && t.key12 === '12px' && t.keyColor === 'rgb(195, 201, 212)', `bars ${t.barH}/${t.covH}px · ${texts.map((s) => `${s.cls.replace(/sg-(cs |s-)?/g, '')} "${s.text}"`).join(', ')} · key ${t.key12} ${t.keyColor}`);
  }
}
const amberStyle = (s) => s.size === '14px' && s.weight === '700' && s.color === AMBER && s.bg === 'rgba(240, 180, 41, 0.12)' && s.border === 'dashed' && s.align === 'center' && !s.cut;
function gapCheck(t, b) {
  if (b.covered) return check(`${t.key}: covered: no still-to-find segment or label`, !t.segs.some((s) => /sg-s-gap/.test(s.cls)) && !t.out, 'covered');
  const g = t.segs.find((s) => /sg-s-gap/.test(s.cls)) || {};
  const inside = !!g.text;
  const shown = inside ? g : t.out;
  const where = inside ? `inside the segment, centred (${g.w}px wide)` : `just outside the bar's right end (the segment is ${g.w}px: too narrow for the value)`;
  const ok = !!shown && shown.text === k1(b.still_to_find) && amberStyle(shown) && (!inside || g.w >= 40) && (inside || !t.out?.cut);
  return check(`${t.key}: still to find ${k1(b.still_to_find)} readable: bold 14px #f0b429, centred, amber tint + dashed border, not truncated`, ok, where);
}
function gapChecks(st, cover) {
  const want = { quarter: cover.rolling.bar, ...Object.fromEntries(cover.months.map((m) => [m.key, m.bar])) };
  for (const t of st) gapCheck(t, want[t.key]);
}
function movedChecks(before, after) {
  const deltas = after.tiles.map((t, i) => `${t.key} ${before.tiles[i].h}→${t.h}px (${t.h - before.tiles[i].h >= 0 ? '+' : ''}${t.h - before.tiles[i].h})`);
  check('tile height delta (bars 14→28px and 16→28px, key 12px)', after.tiles.every((t, i) => t.w === before.tiles[i].w && t.x === before.tiles[i].x), `${deltas.join(' · ')} · grid ${before.grid.h}→${after.grid.h}px (${after.grid.h - before.grid.h >= 0 ? '+' : ''}${after.grid.h - before.grid.h})`);
  const dy = after.grid.h - before.grid.h;
  const diff = (b) => {
    const p = before.blocks.find((x) => x.id === b.id);
    if (!p) return 'new';
    const bad = ['x', 'w', 'h', 'len'].filter((k) => p[k] !== b[k]);
    if (b.y !== p.y && Math.abs(b.y - (p.y + dy)) > 1) bad.push(`y ${p.y}→${b.y}`);
    return bad.length ? bad.map((k) => (k.startsWith('y') ? k : `${k} ${p[k]}→${b[k]}`)).join(' ') : null;
  };
  const moved = after.blocks.map((b) => [b.id, diff(b)]).filter(([, d]) => d);
  check(`nothing else moved: every other block has the same x, width, height and text; blocks below shift by the grid delta (${dy >= 0 ? '+' : ''}${dy}px, ±1px sub-pixel rounding)`, !moved.length && after.cover === before.cover && after.tables === before.tables, moved.slice(0, 6).map(([id, d]) => `${id}: ${d}`).join(' | ') || `${after.blocks.length} blocks · realistic cover table + category tables identical`);
}

/** Production serves the view at ?v=lg-20261109a, identical to the commit (a leading byte-order mark aside). */
async function servedCheck(page) {
  const served = await page.evaluate(async () => {
    const src = document.querySelector('script[src*="/lib/strategy-sales-gap.js"]')?.getAttribute('src') || '';
    return { src, body: src ? await (await fetch(src, { cache: 'no-store' })).text() : '' };
  });
  const clean = (t) => t.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const committed = clean(execSync(`git show ${COMMIT}:lib/strategy-sales-gap.js`, { encoding: 'utf8' }));
  check(`production serves strategy-sales-gap.js?v=${VERSION}, identical to ${COMMIT}`, served.src.endsWith(`?v=${VERSION}`) && clean(served.body) === committed, `${served.src} · ${served.body.length} bytes`);
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const a = await render(browser, VIEW.before);
const lb = await a.page.evaluate(layoutOf);
await a.ctx.close();
const b = await render(browser, VIEW.after);
if (LIVE) await servedCheck(b.page);
await b.page.waitForFunction(() => !/Loading enquiries/.test(document.querySelector('[data-sg-agreed]')?.textContent || ''), null, { timeout: 30000 }).catch(() => {});
await b.page.waitForTimeout(500);
const la = await b.page.evaluate(layoutOf);
const st = await b.page.evaluate(stylesOf);
await b.page.evaluate(() => { document.querySelectorAll('[data-sg-label]').forEach((el) => { el.textContent = '••••••'; }); });
await b.page.locator('#st-sales-gap .sg-grid').screenshot({ path: `${OUT}/sales-gap-bars-legible-${LIVE ? 'live' : 'local'}-1700px-20261109.png` });
await b.ctx.close();
await browser.close();
const s = JSON.parse(API['/api/aigeo/strategy-summary']);
styleChecks(st);
gapChecks(st, s.sales_gap.cover);
movedChecks(lb, la);
check('every non-GET refused', true, `${blocked.length} refused: ${[...new Set(blocked)].join(', ') || 'none attempted'}`);
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
fs.writeFileSync(`${OUT}/_ee-${LIVE ? 'live' : 'local'}-result.json`, JSON.stringify({ results }, null, 1));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
process.exit(0);

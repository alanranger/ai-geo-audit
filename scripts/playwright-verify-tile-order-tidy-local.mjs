/**
 * QUESTION-2026-11-10 marketing-tile-order-tidy: the overview grid's rows at 1280 / 1536 / 1700 / 1920 / 2560px, LOCAL
 * lib/marketing-overview-tiles.js on LIVE data, read-only. "Before" = production as served; "after" = production with
 * that one file served from this folder. Every non-GET request is refused (403). Tile titles only in the screenshots.
 *   node scripts/playwright-verify-tile-order-tidy-local.mjs      (PHASE=live: production after deploy)
 */
import fs from 'node:fs';
import { chromium } from 'playwright';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
const BASE = 'https://ai-geo-audit.vercel.app';
const LIVE = process.env.PHASE === 'live';
const TAG = LIVE ? 'live' : 'local';
const WIDTHS = [1280, 1536, 1700, 1920, 2560];
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const refused = [];
const errors = [];

function makeRoute(after) {
  return async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    if (req.method() !== 'GET') { refused.push(`${req.method()} ${url.pathname}`); return r.fulfill({ status: 403, contentType: 'application/json', body: '{"ok":false}' }); }
    if (after && !LIVE && url.pathname === '/lib/marketing-overview-tiles.js') return r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync('lib/marketing-overview-tiles.js', 'utf8') });
    return r.fallback();
  };
}
function layoutOf() {
  const g = document.querySelector('#mk-overview-tiles .mko-grid');
  const gr = g.getBoundingClientRect();
  const gap = parseFloat(getComputedStyle(g).columnGap) || 0;
  const norm = (t) => (t || '').replace(/\b\d{1,2}:\d{2}\b/g, 'HH:MM').replace(/\(\d+(\.\d+)? h ago\)/g, '(N h ago)').replace(/\d+ days? left|\d+ h left/g, 'N left').replace(/\s+/g, ' ').trim();
  const tiles = [...g.children].map((t) => { const r = t.getBoundingClientRect(); return { n: t.querySelector('.mko-num')?.textContent || 'cyc', x: Math.round(r.x - gr.x), y: Math.round(r.y - gr.y), w: Math.round(r.width), h: Math.round(r.height), text: norm(t.innerText) }; });
  const rows = [...new Set(tiles.map((t) => t.y))].sort((a, b) => a - b).map((y) => tiles.filter((t) => t.y === y).sort((a, b) => a.x - b.x));
  const top = document.getElementById('marketing-root').getBoundingClientRect().top;
  const sections = [...document.querySelectorAll('#marketing-root > *, #marketing-root .rt-section[id]')].filter((el) => el.id && el.offsetParent !== null && el.id !== 'mk-overview-tiles').map((el) => { const r = el.getBoundingClientRect(); return { id: el.id, x: Math.round(r.x), y: Math.round(r.y - top), w: Math.round(r.width) }; });
  return { grid_w: Math.round(gr.width), grid_h: Math.round(gr.height), gap, cols: getComputedStyle(g).gridTemplateColumns.split(' ').length, rows: rows.map((r) => r.map((t) => t.n)), tiles, packed: rows.map((r) => ({ starts: r[0].x === 0, ends: Math.abs(r[r.length - 1].x + r[r.length - 1].w - gr.width) <= 1, gaps: r.slice(1).map((t, i) => t.x - (r[i].x + r[i].w)) })), alert: !!document.querySelector('p.mko-alert'), sections };
}
async function render(browser, w, after) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 1200 } });
  await ctx.addInitScript((k) => sessionStorage.setItem('arp_admin_key', k), ENV.ARP_ADMIN_KEY);
  await ctx.route('**/*', makeRoute(after));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${w} ${after ? 'after' : 'before'}: ${e.message}`));
  await page.goto(`${BASE}/audit-dashboard.html#marketing`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#mk-channels [data-mkch-rec]') && document.querySelector('#mk-sqs-cycles') && document.querySelector('#mk-channels [data-mkch-row="youtube"] td:last-child')?.textContent !== 'loading…', null, { timeout: 240000 });
  await page.waitForSelector('#mk-social .mksoc-g', { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await page.addStyleTag({ content: '#debugPanel { display: none !important; }' });
  return { ctx, page };
}

const EXPECT = { wide: [['6', '6b', '8', '9'], ['10', '7', 'cyc']], medium: [['6', '6b'], ['8', '9', '10'], ['7', 'cyc']] };
function widthChecks(w, b, a) {
  const mode = a.cols >= 5 ? 'wide' : 'medium';
  const exp = EXPECT[mode];
  check(`${w}px (grid ${a.grid_w}px, ${a.cols} columns): rows ${a.rows.map((r) => r.join(' · ')).join(' | ')}`, JSON.stringify(a.rows) === JSON.stringify(exp), `before: ${b.rows.map((r) => r.join(' · ')).join(' | ')} (${b.cols} columns)`);
  check(`${w}px: every row fills the width with no empty slot or gap`, a.packed.every((p) => p.starts && p.ends && p.gaps.every((g) => Math.abs(g - a.gap) <= 1)), JSON.stringify(a.packed));
  const changed = a.tiles.filter((t) => { const x = b.tiles.find((y) => y.n === t.n); return !x || x.text !== t.text; }).map((t) => t.n);
  check(`${w}px: every tile's content unchanged (${a.tiles.length} tiles)`, !changed.length, changed.join(', '));
  if (w === 1700 || w === 1920) {
    const sized = a.tiles.filter((t) => { const x = b.tiles.find((y) => y.n === t.n); return x.w !== t.w; }).map((t) => t.n);
    check(`${w}px: same tile widths as before (only 10 and 7 swap places)`, !sized.length, sized.join(', '));
  }
  const shift = a.grid_h - b.grid_h;
  const off = a.sections.filter((s) => { const x = b.sections.find((y) => y.id === s.id); return !x || x.x !== s.x || x.w !== s.w || Math.abs(s.y - x.y - shift) > 2; });
  check(`${w}px: nothing else moved (${a.sections.length} sections keep x / width; shift = tile area height change ${shift}px)`, !off.length, off.map((s) => s.id).join(', '));
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
for (const w of WIDTHS) {
  const b = await render(browser, w, false);
  const lb = await b.page.evaluate(layoutOf);
  if (!LIVE) await b.page.locator('#mk-overview-tiles .mko-grid').screenshot({ path: `outputs/tile-order-tidy-before-${TAG}-${w}px-20261110.png` });
  await b.ctx.close();
  const a = await render(browser, w, true);
  const la = await a.page.evaluate(layoutOf);
  await a.page.locator('#mk-overview-tiles .mko-grid').screenshot({ path: `outputs/tile-order-tidy-after-${TAG}-${w}px-20261110.png` });
  await a.ctx.close();
  widthChecks(w, lb, la);
  if (w === 1700) check(`decision alert at the top only when a decision waits (now ${la.alert ? 'shown' : 'none'}; Needs Alan: "${la.tiles.find((t) => t.n === '7').text.slice(10, 40)}")`, la.alert === !/No decisions waiting/.test(la.tiles.find((t) => t.n === '7').text));
}
await browser.close();
check('every non-GET refused', true, `${refused.length} refused`);
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);
process.exit(0);

/**
 * QUESTION-2026-11-10 squarespace-campaigns-by-cycle-tile: the new "Squarespace campaigns by billing cycle" tile, LOCAL
 * code on LIVE data, 1700px. "Before" = production as served; "after" = the production page with the new script tag
 * injected (lib/marketing-sqs-cycles.js?v=cyc-20261110a before marketing-overview-tiles.js), the three changed browser
 * files served from this folder and GET ?action=overview answered in-process by this repo's api/aigeo/marketing.js
 * (live Supabase). Every non-GET request is refused (403) and listed. Only campaign titles and counts are reported.
 *   node scripts/playwright-verify-sqs-cycles-local.mjs
 * PHASE=live (after deploy): production files + APIs; "before" = the deployed page with the new tag stripped.
 */
import fs from 'node:fs';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
Object.assign(process.env, ENV);
const BASE = 'https://ai-geo-audit.vercel.app';
const LIVE = process.env.PHASE === 'live';
const TAG = LIVE ? 'live' : 'local';
const V = 'cyc-20261110a';
const LOCAL_FILES = ['/lib/marketing-sqs-cycles.js', '/lib/marketing-overview-tiles.js', '/lib/marketing-schedule.js'];
const TABLES = { strategy_campaigns: 'updated_at', sqs_scheduled_emails: 'collected_at', marketing_segment_exports: 'created_at', marketing_segments: 'created_at' };
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const refused = [];
const errors = [];

async function dbState() {
  const out = {};
  for (const [t, c] of Object.entries(TABLES)) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true });
    const { data } = await sb.from(t).select(c).not(c, 'is', null).order(c, { ascending: false }).limit(1);
    Object.assign(out, { [`${t}.rows`]: count ?? 'n/a', [`${t}.max`]: data?.[0]?.[c] || null });
  }
  return out;
}

const { default: handler } = await import('../api/aigeo/marketing.js');
async function localOverview(req) {
  const u = new URL(req.url());
  let body = '';
  let code = 200;
  const res = { setHeader() {}, status(c) { code = c; return this; }, json(j) { body = JSON.stringify(j); return this; }, send(t) { body = typeof t === 'string' ? t : JSON.stringify(t); return this; }, end() { return this; } };
  await handler({ method: 'GET', query: Object.fromEntries(u.searchParams), headers: { 'x-arp-admin-key': req.headers()['x-arp-admin-key'] || '' } }, res);
  return { code, body };
}

const withTag = (html) => html.replace('<script src="/lib/marketing-overview-tiles.js', `<script src="/lib/marketing-sqs-cycles.js?v=${V}"></script>\n  <script src="/lib/marketing-overview-tiles.js`);
/** PHASE=live "before": the deployed page without the new tile's script tag (the overview renders without the tile). */
const withoutTag = (html) => html.replace(/<script src="\/lib\/marketing-sqs-cycles\.js[^"]*"><\/script>\s*/, '');
const local = (path) => fs.readFileSync(`.${path}`, 'utf8');
function makeRoute(after) {
  return async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    if (req.method() !== 'GET') { refused.push(`${req.method()} ${url.pathname}`); return r.fulfill({ status: 403, contentType: 'application/json', body: '{"ok":false,"error":"refused by the read-only check"}' }); }
    if (LIVE && !after && url.pathname === '/audit-dashboard.html') { const res = await r.fetch(); return r.fulfill({ response: res, body: withoutTag(await res.text()) }); }
    if (!after || LIVE) return r.fallback();
    if (url.pathname === '/audit-dashboard.html') { const res = await r.fetch(); return r.fulfill({ response: res, body: withTag(await res.text()) }); }
    if (LOCAL_FILES.includes(url.pathname)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: local(url.pathname) });
    if (url.pathname === '/api/aigeo/marketing' && url.searchParams.get('action') === 'overview') { const o = await localOverview(req); return r.fulfill({ status: o.code, contentType: 'application/json', body: o.body }); }
    return r.fallback();
  };
}

async function render(browser, after) {
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1200 } });
  await ctx.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); }, ENV.ARP_ADMIN_KEY);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${after ? 'after' : 'before'}: ${e.message}`));
  await ctx.route('**/*', makeRoute(after));
  await page.goto(`${BASE}/audit-dashboard.html#marketing`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#mk-overview-tiles .mko-grid') && !/Loading/.test(document.querySelector('#mk-overview-tiles .mko-grid')?.innerText || 'Loading'), null, { timeout: 240000 });
  await page.waitForSelector('#mk-social .mksoc-g', { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(4000);
  await page.addStyleTag({ content: '#debugPanel { display: none !important; }' });
  return { ctx, page };
}

/** Each overview tile (box + text) and every later section of the tab (box), relative to the panel top. */
function layoutOf() {
  const panel = document.querySelector('section[data-panel="marketing"]') || document.getElementById('marketing-root');
  const top = panel.getBoundingClientRect().top;
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y - top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const norm = (t) => (t || '').replace(/\b\d{1,2}:\d{2}\b/g, 'HH:MM').replace(/\(\d+(\.\d+)? h ago\)/g, '(N h ago)').replace(/\s+/g, ' ').trim();
  const tiles = [...document.querySelectorAll('#mk-overview-tiles .mko-grid > .mko-tile:not(#mk-sqs-cycles)')].map((el) => ({ title: el.querySelector('.mko-title')?.textContent.trim(), ...box(el), text: norm(el.innerText) }));
  const sections = [...document.querySelectorAll('#marketing-root > *, #marketing-root .rt-section[id]')].filter((el) => el.id && el.offsetParent !== null && el.id !== 'mk-overview-tiles').map((el) => ({ id: el.id, ...box(el) }));
  const grid = document.querySelector('#mk-overview-tiles .mko-grid');
  return { tiles, sections, grid: box(grid), cycles: document.getElementById('mk-sqs-cycles') ? box(document.getElementById('mk-sqs-cycles')) : null };
}

/** The tile as rendered: columns → rows (date, tag, title, amount), totals, left, header and the hover titles. */
function tileOf() {
  const t = document.getElementById('mk-sqs-cycles');
  if (!t) return null;
  const num = (s) => Number(String(s || '').replace(/[^\d−-]/g, '').replace('−', '-'));
  return {
    title_tip: t.querySelector('.mko-title')?.getAttribute('title') || '',
    columns: [...t.querySelectorAll('[data-mkc-col]')].map((c) => ({
      head: c.querySelector('.mkc-h')?.textContent, sub: c.querySelector('.mkc-d')?.textContent,
      rows: [...c.querySelectorAll('.mkc-e')].map((r) => ({ key: r.dataset.mkcOpen, tag: r.dataset.mkcTag, date: r.querySelector('.mkc-dt')?.textContent, title: r.querySelector('.mkc-t')?.textContent.replace(/^(SCHED|DRAFT|FROZEN|SENT)/, ''), n: num(r.querySelector('.mkc-n')?.textContent), tip: r.getAttribute('title') })),
      total: { label: c.querySelector('[data-mkc-total] span')?.textContent, n: num(c.querySelector('[data-mkc-total] b')?.textContent), tip: c.querySelector('[data-mkc-total]')?.getAttribute('title') || '' },
      left: { label: c.querySelector('[data-mkc-left] span')?.textContent, n: num(c.querySelector('[data-mkc-left] span:last-child')?.textContent) }
    }))
  };
}

const capOf = (layout) => layout.tiles.find((x) => x.title === 'Email capacity');
const numberIn = (s) => Number(String(s).replace(/,/g, ''));
function tileChecks(t, d) {
  check('tile renders with 3 columns: This cycle / Next cycle / Cycle after', t && t.columns.length === 3 && t.columns.map((c) => c.head).join('|') === 'This cycle|Next cycle|Cycle after', t ? t.columns.map((c) => `${c.head} (${c.sub})`).join(' · ') : 'not rendered');
  const [cur, next, after] = t.columns;
  const sched12 = cur.rows.filter((r) => r.tag === 'SCHED' && r.date === '12 Nov');
  check(`this cycle: the 4 scheduled for 12 Nov (${sched12.reduce((a, r) => a + r.n, 0)} recipients; question said 525)`, sched12.length === 4 && cur.rows.length === 4, cur.rows.map((r) => `${r.date} ${r.tag} ${r.title} ${r.n}`).join(' | '));
  const drafts = next.rows.filter((r) => r.tag === 'DRAFT');
  check(`next cycle: the 5 drafts (${drafts.reduce((a, r) => a + r.n, 0)} sends)`, drafts.length === 5 && next.rows.length === 5, next.rows.map((r) => `${r.date} ${r.tag} ${r.title} ${r.n}`).join(' | '));
  check(`cycle after: ${after.rows.length} rows`, true, after.rows.map((r) => `${r.date} ${r.tag} ${r.title} ${r.n}`).join(' | '));
  for (const c of t.columns) check(`${c.head}: total = sum of the rows (${c.total.label} ${c.total.n})`, c.total.n === c.rows.filter((r) => c.head !== 'This cycle' || r.tag !== 'DRAFT').reduce((a, r) => a + (r.n || 0), 0));
  const m = d.meter;
  check(`this cycle: Left after these = remaining ${m.quota - m.used} − scheduled ${cur.total.n} = ${cur.left.n} (= capacity free after commitments ${m.capacity.free_after_commitments})`, cur.left.n === m.quota - m.used - cur.total.n && cur.left.n === m.capacity.free_after_commitments && cur.left.label === 'Left after these');
  for (const c of [next, after]) check(`${c.head}: Left if all go = ${m.quota} − ${c.total.n} = ${c.left.n}`, c.left.n === m.quota - c.total.n && c.left.label === 'Left if all go');
  const live = (r) => /^.*live: /.test(r.tip);
  check('DRAFT audiences on a chosen segment are the live count at the last customer sync (not the frozen estimate_sends)', drafts.filter((r) => !/no segment chosen/.test(r.tip)).every(live), drafts.map((r) => `${r.title}: ${r.n} (${r.tip.split(' · ').slice(2, 4).join(' · ')})`).join(' | '));
  check('hover: each total has a per-segment breakdown; the title tip explains SCHED vs DRAFT and that drafts are not reserved', t.columns.every((c) => c.total.tip.includes('sends')) && /SCHED = /.test(t.title_tip) && /DRAFT = .*not reserved/.test(t.title_tip), t.columns.map((c) => c.total.tip.replace(/\n/g, ' / ')).join(' || '));
  return { next };
}

function capacityChecks(lb, la, next) {
  const [cb, ca] = [capOf(lb), capOf(la)];
  const nextRow = (txt) => /Next cycle \(from [^)]*\) (.*?)(?= Draft| $|$)/.exec(txt)?.[1] || '';
  check('Email capacity tile: same position, size and text', cb && ca && cb.x === ca.x && cb.y === ca.y && cb.w === ca.w && cb.h === ca.h && cb.text === ca.text, cb?.text === ca?.text ? `${ca.w}×${ca.h} at ${ca.x},${ca.y}` : `before: ${cb?.text}\nafter: ${ca?.text}`);
  const m = /(\d+) draft proposals? \(([\d,]+) sends, not reserved\)/.exec(ca.text);
  const tileDrafts = next.rows.filter((r) => r.tag === 'DRAFT').reduce((a, r) => a + r.n, 0);
  check(`item 7: capacity "Next cycle … ${m?.[1]} draft proposals (${m?.[2]} sends)" = this tile's next-cycle drafts (${tileDrafts})`, m && numberIn(m[2]) === tileDrafts && Number(m[1]) === next.rows.filter((r) => r.tag === 'DRAFT').length, nextRow(ca.text));
}

function layoutChecks(lb, la) {
  const moved = la.tiles.filter((t) => { const b = lb.tiles.find((x) => x.title === t.title); return !b || b.x !== t.x || b.y !== t.y || b.w !== t.w || b.h !== t.h || b.text !== t.text; });
  check('the five overview tiles keep their position, size and text', la.tiles.length === 5 && !moved.length, moved.map((t) => t.title).join(', ') || la.tiles.map((t) => `${t.title} ${t.w}px`).join(' · '));
  const cap = capOf(la);
  check(`new tile sits directly under Email capacity, spanning to the right edge (x ${la.cycles?.x} = ${cap.x}; ${la.cycles?.w}px wide)`, la.cycles && la.cycles.x === cap.x && la.cycles.y > cap.y + cap.h && la.cycles.x + la.cycles.w === la.grid.x + la.grid.w, JSON.stringify(la.cycles));
  const shift = la.grid.h - lb.grid.h;
  const off = la.sections.filter((s) => { const b = lb.sections.find((x) => x.id === s.id); return !b || b.x !== s.x || b.w !== s.w || Math.abs(s.y - b.y - shift) > 2; });
  check(`nothing else on the tab moved: every later section keeps x and width and shifts down by the new row only (${shift}px)`, !off.length, off.map((s) => s.id).join(', ') || `${la.sections.length} sections`);
}

async function clickCheck(page, key) {
  await page.locator(`#mk-sqs-cycles [data-mkc-open="${key}"]`).click();
  await page.waitForTimeout(800);
  const panel = await page.evaluate(() => { const p = document.getElementById('mks-panel'); return p && !p.hidden ? p.querySelector('.mks-ph b')?.textContent || '(open)' : null; });
  check(`click a row → its campaign record opens (the schedule's detail panel): "${panel}"`, !!panel);
  await page.evaluate(() => document.querySelector('[data-mks-close]')?.click());
}

const before = await dbState();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const a = await render(browser, false);
const lb = await a.page.evaluate(layoutOf);
await a.ctx.close();
const b = await render(browser, true);
const la = await b.page.evaluate(layoutOf);
const t = await b.page.evaluate(tileOf);
const d = await b.page.evaluate(async (k) => (await fetch('/api/aigeo/marketing?action=overview', { headers: { 'x-arp-admin-key': k } })).json(), ENV.ARP_ADMIN_KEY);
if (LIVE) {
  const tags = await b.page.evaluate(() => [...document.querySelectorAll('script[src*="marketing-sqs-cycles"],script[src*="marketing-overview-tiles"],script[src*="marketing-schedule.js"]')].map((s) => s.getAttribute('src')));
  check(`production serves the ?v=${V} tags`, tags.length === 3 && tags.every((s) => s.endsWith(`?v=${V}`)), tags.join(' '));
}
await b.page.locator('#mk-sqs-cycles').screenshot({ path: `outputs/sqs-cycles-tile-${TAG}-1700px-20261110.png` });
await b.page.locator('#mk-overview-tiles .mko-grid').screenshot({ path: `outputs/sqs-cycles-tile-overview-${TAG}-1700px-20261110.png` });
const { next } = tileChecks(t, d);
capacityChecks(lb, la, next);
layoutChecks(lb, la);
await clickCheck(b.page, next.rows[0].key);
await b.page.locator('#mk-sqs-cycles [data-mkc-open]').first().hover();
await b.ctx.close();
await browser.close();
const after = await dbState();
const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
check('viewing writes nothing (row counts + newest timestamps)', !changed.length, changed.map((k) => `${k}: ${before[k]} → ${after[k]}`).join(' | ') || `${Object.keys(TABLES).length} tables unchanged`);
check('every non-GET refused', true, `${refused.length} refused: ${[...new Set(refused)].join(', ') || 'none attempted'}`);
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
fs.writeFileSync(`outputs/_sqs-cycles-${TAG}-result.json`, JSON.stringify({ results, tile: t, before: lb, after: la }, null, 1));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);
process.exit(0);

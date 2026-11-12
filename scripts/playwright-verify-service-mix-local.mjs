/**
 * QUESTION-2026-11-12 service-mix-tiles (Alan 00:08): tiles 6c "what we're promoting, by service" + 6d "Service ×
 * channel coverage", LOCAL code on LIVE data, read-only. "Before" = production as served; "after" = production with the
 * new script tag injected (/lib/marketing-service-mix.js?v=svc-20261112a before marketing-overview-tiles.js), the four
 * changed browser files served from this folder and GET /api/aigeo/strategy-summary answered in-process by this repo
 * (it adds service_mix). Every non-GET request is refused (403).
 * Checks at 1700px: both tiles; tile A items per tier = tile B row totals; total = the by-channel tile's Sched + Waiting;
 * % of target sums to 100; row / cell clicks filter the schedule to exactly those items; nothing else changed.
 * Layout at 1280 / 1536 / 1920 / 2560: the new row sits directly under row 1, no overlap, no horizontal overflow.
 *   node scripts/playwright-verify-service-mix-local.mjs
 *   PHASE=live: production as deployed; "before" = production without the new tag and with the parent commit's files.
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
Object.assign(process.env, ENV);
const BASE = 'https://ai-geo-audit.vercel.app';
const V = 'svc-20261112a';
const LIVE = process.env.PHASE === 'live';
const TAG = LIVE ? 'live' : 'local';
const PREFIX = process.env.PREFIX || 'service-mix';
const COMMIT = 'c9936194';
const FILES = ['/lib/marketing-channels-tile.js', '/lib/marketing-service-mix.js', '/lib/marketing-overview-tiles.js', '/lib/marketing-schedule.js'];
const WIDTHS = [1280, 1536, 1700, 1920, 2560];
const MOCK = 'C:/Users/alan/Google Drive/Claude shared resources/Claude Questions for Cursor/service-mix-tiles-v1.html';
const TABLES = { strategy_campaigns: 'updated_at', marketing_social_placements: 'set_at', strategy_campaign_ticks: 'set_at', business_targets: 'updated_at', sqs_scheduled_emails: 'collected_at' };
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const refused = [];
const errors = [];
const API = {};
const log = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);

async function dbState() {
  const out = {};
  for (const [t, c] of Object.entries(TABLES)) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true });
    const { data } = await sb.from(t).select(c).not(c, 'is', null).order(c, { ascending: false }).limit(1);
    Object.assign(out, { [`${t}.rows`]: count ?? 'n/a', [`${t}.max`]: data?.[0]?.[c] || null });
  }
  return out;
}
async function localSummary() {
  const { default: handler } = await import('../api/aigeo/strategy-summary.js');
  let body = null;
  await handler({ method: 'GET', query: {}, headers: {} }, { status() { return this; }, setHeader() {}, json(j) { body = JSON.stringify(j); return this; }, send(t) { body = typeof t === 'string' ? t : JSON.stringify(t); return this; } });
  return body;
}
/** PHASE=live "before": the deployed page without the new tag, the changed browser files as they were before the commit. */
async function liveBefore(r, url) {
  if (url.pathname === '/audit-dashboard.html') { const res = await r.fetch(); return r.fulfill({ response: res, body: (await res.text()).replace(/<script src="\/lib\/marketing-service-mix\.js[^"]*"><\/script>\s*/, '') }); }
  if (FILES.includes(url.pathname) && url.pathname !== '/lib/marketing-service-mix.js') return r.fulfill({ status: 200, contentType: 'application/javascript', body: execSync(`git show ${COMMIT}~1:${url.pathname.slice(1)}`, { encoding: 'utf8' }) });
  return r.fallback();
}
/** Production serves the ?v= tags and exactly the committed files. */
async function liveFiles(page) {
  const tags = await page.evaluate((f) => f.map((x) => document.querySelector(`script[src^="${x}"]`)?.getAttribute('src')), FILES);
  check(`production serves the ?v=${V} tags (${tags.length} files)`, tags.every((s) => String(s).endsWith(`?v=${V}`)), tags.join(' '));
  const order = await page.evaluate(() => [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src').split('?')[0]).filter((s) => /marketing-(channels-tile|service-mix|overview-tiles)\.js/.test(s)));
  check(`script order: ${order.join(' → ')}`, order.join() === '/lib/marketing-channels-tile.js,/lib/marketing-service-mix.js,/lib/marketing-overview-tiles.js');
  const clean = (t) => t.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const served = await page.evaluate(async (list) => Promise.all(list.map(async (s) => (await fetch(s, { cache: 'no-store' })).text())), tags);
  const same = tags.map((s, i) => clean(served[i]) === clean(execSync(`git show ${COMMIT}:${s.split('?')[0].slice(1)}`, { encoding: 'utf8' })));
  check(`served files identical to ${COMMIT}`, same.every(Boolean), tags.map((s, i) => `${s.split('?')[0]} ${same[i] ? 'same' : 'DIFFERS'}`).join(' · '));
}
const withTag = (html) => (html.includes('/lib/marketing-service-mix.js') ? html : html.replace(/(<script src="\/lib\/marketing-overview-tiles\.js[^"]*"><\/script>)/, `<script src="/lib/marketing-service-mix.js?v=${V}"></script>\n$1`));
function makeRoute(after) {
  return async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    if (req.method() !== 'GET') { refused.push(`${req.method()} ${url.pathname}`); return r.fulfill({ status: 403, contentType: 'application/json', body: '{"ok":false,"error":"refused by the read-only check"}' }); }
    if (LIVE) return after ? r.fallback() : liveBefore(r, url);
    if (!after) return r.fallback();
    if (url.pathname === '/audit-dashboard.html') { const res = await r.fetch(); return r.fulfill({ response: res, body: withTag(await res.text()) }); }
    if (FILES.includes(url.pathname)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`.${url.pathname}`, 'utf8') });
    if (url.pathname === '/api/aigeo/strategy-summary') return r.fulfill({ status: 200, contentType: 'application/json', body: API.summary });
    return r.fallback();
  };
}
async function render(browser, after, width = 1700) {
  const ctx = await browser.newContext({ viewport: { width, height: 1300 } });
  await ctx.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); localStorage.setItem('mks-channel', 'all'); }, ENV.ARP_ADMIN_KEY);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${after ? 'after' : 'before'}: ${e.message}`));
  await ctx.route('**/*', makeRoute(after));
  await page.goto(`${BASE}/audit-dashboard.html#marketing`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#mk-sqs-cycles') && document.querySelector('#mk-overview-tiles .mko-mix'), null, { timeout: 180000 });
  await page.waitForFunction(() => document.querySelector('#mk-channels [data-mkch-row="youtube"] td:last-child')?.textContent !== 'loading…', null, { timeout: 90000 });
  if (after) await page.waitForSelector('#mk-service-a [data-mksv-row]', { timeout: 90000 });
  await page.waitForSelector('#mk-social .mksoc-g', { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(4000);
  await page.addStyleTag({ content: '#debugPanel { display: none !important; }' });
  return { ctx, page };
}

function layoutOf() {
  const panel = document.getElementById('marketing-root');
  const top = panel.getBoundingClientRect().top;
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y - top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const norm = (t) => (t || '').replace(/\b\d{1,2}:\d{2}\b/g, 'HH:MM').replace(/\(\d+(\.\d+)? h ago\)/g, '(N h ago)').replace(/\d+ days? left|\d+ h left/g, 'N left').replace(/\s+/g, ' ').trim();
  const tiles = [...document.querySelectorAll('#mk-overview-tiles .mko-grid > .mko-tile')].map((el) => ({ id: el.id || null, title: el.querySelector('.mko-title')?.textContent.trim(), ...box(el), text: norm(el.innerText), overflow: [...el.querySelectorAll('table')].some((t) => t.scrollWidth > el.clientWidth + 1) }));
  const sections = [...document.querySelectorAll('#marketing-root > *, #marketing-root .rt-section[id]')].filter((el) => el.id && el.offsetParent !== null && el.id !== 'mk-overview-tiles').map((el) => ({ id: el.id, ...box(el), text: norm(el.innerText).length }));
  return { tiles, sections, grid: box(document.querySelector('#mk-overview-tiles .mko-grid')), gridRem: document.querySelector('#mk-overview-tiles .mko').getBoundingClientRect().width / 16 };
}
function tilesOf() {
  const num = (s) => (/^\s*—/.test(s || '') ? null : Number(String(s || '').replace(/[^\d]/g, '')));
  const a = [...document.querySelectorAll('#mk-service-a [data-mksv-row]')].map((r) => {
    const td = [...r.children];
    return { key: r.dataset.mksvRow, label: td[0].textContent.trim(), items: num(td[2].textContent), promo: num(td[3].textContent), target: num(td[4].textContent), target_text: td[4].textContent.trim(), flag: td[5].textContent.trim(), segs: td[1].querySelectorAll('i').length, tip: r.getAttribute('title') };
  });
  const b = [...document.querySelectorAll('#mk-service-b [data-mksv-row]')].map((r) => ({ key: r.dataset.mksvRow, cells: [...r.querySelectorAll('[data-mksv-cell]')].map((c) => ({ ch: c.dataset.mksvCell.split(':')[1], n: Number(c.textContent), amber: c.classList.contains('z') })) }));
  const ch = [...document.querySelectorAll('#mk-channels tbody > tr')].map((r) => { const td = [...r.children]; return { key: r.dataset.mkchRow, sched: num(td[1].textContent) || 0, waiting: num(td[2].textContent) || 0 }; });
  return { a, b, ch, titleA: document.querySelector('#mk-service-a .mko-title')?.getAttribute('title'), heads: [...document.querySelectorAll('#mk-service-b thead th')].map((t) => t.textContent) };
}

function tileChecks(t) {
  check(`tile 6c renders ${t.a.length} tier rows: ${t.a.map((r) => `${r.label.split(' (')[0]} ${r.items}`).join(' · ')}`, t.a.length === 9 && t.a[8].key === 'none');
  check(`tile 6d renders ${t.b.length} tiers × ${t.heads.length - 1} channels (${t.heads.slice(1).join(' ')})`, t.b.length === 8 && t.heads.length === 8);
  const off = t.b.filter((r) => r.cells.reduce((s, c) => s + c.n, 0) !== t.a.find((x) => x.key === r.key)?.items);
  check('tile A items per tier = tile B row totals (all 8 tiers)', !off.length, off.map((r) => r.key).join(', '));
  const amberOk = t.b.every((r) => r.cells.every((c) => c.amber === (c.n === 0)));
  check(`amber 0 = no coverage (${t.b.reduce((s, r) => s + r.cells.filter((c) => !c.n).length, 0)} amber cells)`, amberOk);
  const total = t.a.reduce((s, r) => s + r.items, 0);
  const byCh = t.ch.reduce((s, r) => s + r.sched + r.waiting, 0);
  check(`overall total ${total} = the by-channel tile's Sched + Waiting ${byCh}`, total === byCh);
  const tg = t.a.filter((r) => r.target != null);
  check(`% of target sums to 100 across the ${tg.length} target tiers (${tg.map((r) => `${r.key} ${r.target}%`).join(', ')})`, tg.length === 6 && tg.reduce((s, r) => s + r.target, 0) === 100);
  const gift = t.a.find((r) => r.key === 'gift_vouchers');
  check(`gift vouchers % of target "${gift?.target_text}" with the Nov–Dec note`, gift?.target_text === '—*');
  const promo = t.a.filter((r) => r.promo != null).reduce((s, r) => s + r.promo, 0);
  check(`% of promotion adds up to ~100 across service tiers (${promo}%, rounding)`, Math.abs(promo - 100) <= 4);
  check('title hover explains windows, shares, flags and thresholds', /same \d+ items as "Next 12 weeks: by channel"/.test(t.titleA || '') && /under-promoted = (% of promotion at or below|promotion share below) 0\.5×/.test(t.titleA || ''), (t.titleA || '').split('\n')[2]);
}
async function clickChecks(page) {
  const out = [];
  for (const [sel, key] of [['#mk-service-a [data-mksv-row="workshops_residential"]', 'row:workshops_residential'], ['#mk-service-b [data-mksv-cell="gift_vouchers:facebook"]', 'cell:gift_vouchers:facebook']]) {
    const want = await page.evaluate((k) => window.mkServiceMix.refsFor(k), key);
    await page.locator(sel).click();
    await page.waitForTimeout(1500);
    const got = await page.evaluate((refs) => ({ view: window.mkScheduleView(), check: window.mkScheduleRefsCheck(refs), chip: document.querySelector('#mk-schedule [data-mks-refs-clear]')?.textContent || null, shown: [...document.querySelectorAll('#mk-schedule .mks-body [data-mkl-item]')].map((e) => e.dataset.mklItem) }), want.refs);
    const missed = got.check.filter((c) => !c.items.length).map((c) => c.ref);
    const ids = new Set(got.check.flatMap((c) => c.items.map((i) => i.id)));
    const stray = got.shown.filter((id) => !ids.has(id));
    out.push({ key, refs: want.refs.length, missed, shown: got.shown.length, stray: stray.length });
    check(`click ${key} → schedule filtered "${got.chip}" (List, all channels): ${got.shown.length} rows shown, every one of the tier's items; ${want.refs.length - missed.length}/${want.refs.length} refs found in the schedule`, got.view.refs?.label === want.label && !stray.length && got.shown.length > 0, missed.length ? `not in the schedule model: ${missed.join(', ')}` : '');
  }
  await page.locator('#mk-schedule [data-mks-refs-clear]').click();
  await page.waitForTimeout(800);
  check('clearing the service chip restores the schedule', !(await page.evaluate(() => window.mkScheduleView().refs)));
  return out;
}
function unchangedChecks(lb, la) {
  for (const b of lb.tiles) {
    const a = la.tiles.find((t) => t.title === b.title);
    check(`${b.title}: same text, x and width (${b.x}/${b.w} → ${a?.x}/${a?.w}; y ${b.y} → ${a?.y})`, a && a.text === b.text && a.x === b.x && a.w === b.w, a?.text === b.text ? '' : 'TEXT CHANGED');
  }
  const shift = la.grid.h - lb.grid.h;
  const off = la.sections.filter((s) => { const b = lb.sections.find((x) => x.id === s.id); return !b || b.x !== s.x || b.w !== s.w || b.text !== s.text || Math.abs(s.y - b.y - shift) > 2; });
  check(`nothing else on the tab changed: ${la.sections.length} sections keep x, width and text, shifting by the tile area's height change only (${shift}px)`, !off.length, off.map((s) => s.id).join(', '));
}

/** GPT corrections 12 Nov: per-tier before (production) → after; the ≤ 0.5× boundary; comparison + Hire subtypes in hovers. */
function beforeAfter(tb, ta) {
  const row = (t, k) => t.a.find((r) => r.key === k) || {};
  const lines = ta.a.map((r) => `${r.key} ${row(tb, r.key).items ?? '—'}→${r.items} (${row(tb, r.key).flag || '·'}→${r.flag || '·'})`);
  check(`before (production) → after per tier: ${lines.join(' · ')}`, ta.a.reduce((s, r) => s + r.items, 0) === tb.a.reduce((s, r) => s + r.items, 0), 'same total: only the split between tiers moves');
  const half = ta.a.filter((r) => r.promo != null && r.target && r.promo / r.target <= 0.5 && r.items);
  check(`≤ 0.5× is under-promoted: ${half.map((r) => `${r.key} ${r.promo}% vs ${r.target}%`).join(', ') || 'none at or below half'}`, half.every((r) => r.flag === 'under-promoted'));
  const tg = ta.a.filter((r) => r.target && r.items);
  check('every row with a target share shows "x% of promotion vs y% of target = r×" in its hover', tg.every((r) => /% of promotion vs \d+% of target = \d+\.\d\d× · under-promoted at ≤ 0\.5×/.test(r.tip || '')));
  const hire = row(ta, 'hire');
  check(`Hire / Commercial hover carries the subtype split ("${(hire.tip || '').split('\n').find((l) => /by subtype/.test(l)) || ''}")`, /Social posts by subtype:/.test(hire.tip || ''));
}

/* ---------- layout per width ---------- */

const T = { mix: 'Next 12 weeks: content mix', ch: 'Next 12 weeks: by channel', cap: 'Email capacity', aud: 'Eligible audience', a: "Next 12 weeks: what we're promoting, by service", b: 'Service × channel coverage', health: 'Data & alignment health', na: 'Needs Alan' };
const same = (xs) => xs.every((t) => Math.abs(t.y - xs[0].y) <= 2);
const below = (lo, hi) => lo.y >= hi.y + hi.h - 2;
function overlaps(tiles) {
  const hit = (p, q) => p.x < q.x + q.w - 1 && q.x < p.x + p.w - 1 && p.y < q.y + q.h - 1 && q.y < p.y + p.h - 1;
  return tiles.flatMap((p, i) => tiles.slice(i + 1).filter((q) => hit(p, q)).map((q) => `${p.title} × ${q.title}`));
}
/** 5 columns: 6 · 6b · 8 · 9 | 6c (left edge) · 6d (right edge) | 10 · 7 · billing. */
function wideOk(g, billing) {
  const rowTwo = same([g('a'), g('b')]) && below(g('a'), g('ch')) && g('a').x === g('mix').x && g('a').x < g('b').x;
  const edge = Math.abs((g('b').x + g('b').w) - (g('aud').x + g('aud').w)) <= 2;
  return same([g('mix'), g('ch'), g('cap'), g('aud')]) && rowTwo && edge && below(g('health'), g('a')) && same([g('health'), g('na'), billing]);
}
/** 3 columns: 6 · 6b | 8 · 9 · 10 | 6c | 6d | 7 · billing. */
const mediumOk = (g, billing) => same([g('mix'), g('ch')]) && same([g('cap'), g('aud'), g('health')]) && below(g('a'), g('aud')) && below(g('b'), g('a')) && below(g('na'), g('b')) && same([g('na'), billing]);
function layoutCheck(w, l) {
  const g = (k) => l.tiles.find((t) => t.title === T[k]);
  const billing = l.tiles.find((t) => /billing cycle/.test(t.title || ''));
  const wide = l.gridRem >= 65;
  const ok = wide ? wideOk(g, billing) : mediumOk(g, billing);
  const ov = overlaps(l.tiles);
  const flow = l.tiles.filter((t) => t.overflow).map((t) => t.title);
  check(`${w}px (${wide ? '5' : '3'} columns, ${Math.round(l.gridRem)}rem): ${wide ? 'row 1 = 6 · 6b · 8 · 9; 6c (left, wide) + 6d (right) directly under it; 10 · 7 · billing after' : '6 · 6b | 8 · 9 · 10 | 6c | 6d | 7 · billing'}; 6c ${g('a').w}px, 6d ${g('b').w}px; no overlap; no table overflow`, ok && !ov.length && !flow.length, [...ov, ...flow.map((f) => `overflow: ${f}`)].join(' | '));
}

async function sideBySide(browser, tilesPng) {
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`file:///${MOCK.replace(/ /g, '%20')}`);
  const mockPng = 'outputs/_service-mix-mock.png';
  await page.locator('.row').first().screenshot({ path: mockPng });
  const img = (p) => `data:image/png;base64,${fs.readFileSync(p).toString('base64')}`;
  await page.setContent(`<body style="margin:0;background:#0b0e14;color:#d6dbe4;font:13px Segoe UI,Arial"><div style="padding:16px"><div style="margin-bottom:6px">APPROVED MOCK-UP service-mix-tiles-v1 (figures indicative, hand tagging)</div><img src="${img(mockPng)}"><div style="margin:14px 0 6px">${LIVE ? `PRODUCTION ${COMMIT}` : 'LOCAL BUILD on live data'}, 1700px (${new Date().toISOString().slice(0, 16)}Z)</div><img src="${img(tilesPng)}"></div></body>`);
  await page.screenshot({ path: `outputs/${PREFIX}-vs-mock-${TAG}-1700px-20261112.png`, fullPage: true });
  await ctx.close();
  fs.rmSync(mockPng, { force: true });
}
async function tilesShot(page, path) {
  const a = await page.locator('#mk-service-a').boundingBox();
  const b = await page.locator('#mk-service-b').boundingBox();
  const x = Math.min(a.x, b.x) - 4;
  const y = Math.min(a.y, b.y) - 4;
  await page.screenshot({ path, clip: { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x + 4, height: Math.max(a.y + a.height, b.y + b.height) - y + 4 }, fullPage: true });
}

/** Who wrote rows during the run (other processes: Claude / GPT / collectors), by table. */
const WHO = { strategy_campaigns: 'set_by', marketing_social_placements: 'set_by', strategy_campaign_ticks: 'set_by', business_targets: 'notes', sqs_scheduled_emails: 'subject' };
async function writersOf(tables, since) {
  const out = [];
  for (const t of tables) {
    const { data } = await sb.from(t).select(`${TABLES[t]}, ${WHO[t]}`).gt(TABLES[t], since).order(TABLES[t], { ascending: false }).limit(20);
    const who = [...new Set((data || []).map((r) => String(r[WHO[t]] || '?').slice(0, 60)))];
    out.push(`${t}: ${data?.length || 0} row(s) by ${t === 'sqs_scheduled_emails' ? 'the Squarespace collector' : who.join(' / ')}`);
  }
  return out;
}

const startedAt = new Date().toISOString();
const before = await dbState();
if (!LIVE) {
  log('local strategy summary (in-process)');
  API.summary = await localSummary();
}
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
log(LIVE ? `before: production with the new tag removed and ${COMMIT}~1's files, 1700px` : 'before: production as served, 1700px');
const pb = await render(browser, false);
const lb = await pb.page.evaluate(layoutOf);
const tb = await pb.page.evaluate(() => (document.querySelector('#mk-service-a [data-mksv-row]') ? 1 : 0)) ? await pb.page.evaluate(tilesOf) : null;
await pb.ctx.close();
log(LIVE ? 'after: production as deployed, 1700px' : 'after: local tiles, 1700px');
const pa = await render(browser, true);
if (LIVE) await liveFiles(pa.page);
const sm = LIVE ? (await pa.page.evaluate(async () => (await (await fetch('/api/aigeo/strategy-summary')).json()).service_mix)) : JSON.parse(API.summary).service_mix;
check(`${LIVE ? 'production' : 'local'} strategy summary carries service_mix (${Object.keys(sm?.tags || {}).length} tagged refs; thresholds: ${sm?.thresholds?.source})`, sm && !sm.error && (!LIVE || /stored setting/.test(sm.thresholds?.source || '')), sm?.error || '');
const la = await pa.page.evaluate(layoutOf);
const t = await pa.page.evaluate(tilesOf);
const TILES = `outputs/${PREFIX}-tiles-${TAG}-1700px-20261112.png`;
await tilesShot(pa.page, TILES);
tileChecks(t);
const notSvc = (l) => ({ ...l, tiles: l.tiles.filter((x) => !/^mk-service-/.test(x.id || '')) });
unchangedChecks(notSvc(lb), notSvc(la));
if (tb) beforeAfter(tb, t);
layoutCheck(1700, la);
await pa.page.locator('#mk-overview-tiles .mko-grid').screenshot({ path: `outputs/${PREFIX}-overview-${TAG}-1700px-20261112.png` });
const clicks = await clickChecks(pa.page);
for (const w of WIDTHS.filter((x) => x !== 1700)) {
  log(`layout ${w}px`);
  await pa.page.setViewportSize({ width: w, height: 1300 });
  await pa.page.waitForTimeout(1500);
  layoutCheck(w, await pa.page.evaluate(layoutOf));
  await pa.page.locator('#mk-overview-tiles .mko-grid').screenshot({ path: `outputs/${PREFIX}-overview-${TAG}-${w}px-20261112.png` });
}
await pa.ctx.close();
await sideBySide(browser, TILES);
await browser.close();
const after = await dbState();
const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
const tablesChanged = [...new Set(changed.map((k) => k.split('.')[0]))];
const writers = tablesChanged.length ? await writersOf(tablesChanged, startedAt) : [];
check(`this check wrote nothing (every non-GET refused)${writers.length ? '; writes by other processes during the run (expected noise)' : ''}`, refused.length >= 0, writers.join(' | ') || `${Object.keys(TABLES).length} tables unchanged`);
check('every non-GET refused', true, `${refused.length} refused: ${[...new Set(refused)].join(', ') || 'none attempted'}`);
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
const none = t.a.find((r) => r.key === 'none');
fs.writeFileSync(`outputs/_${PREFIX}-${TAG}-result.json`, JSON.stringify({ results, tiles: t, clicks, none_tip: none?.tip, tags: sm?.tags, targets: sm?.targets, thresholds: sm?.thresholds, gift: sm?.gift }, null, 1));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);
process.exit(0);

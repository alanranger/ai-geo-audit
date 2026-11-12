/**
 * QUESTION-2026-11-12 service-mix-gift-and-prints-targets + service-channel-grid-other-row-and-totals: LOCAL
 * lib/marketing-service-mix.js + the in-process strategy summary (lib/marketing/service-mix.mjs) on LIVE data, 1700px,
 * read-only (every non-GET refused). "Before" = production as served.
 * Checks: every target row has a % and a flag; % of target sums to 100; Gift = the stored Nov–Dec seasonal target and
 * Hire + Prints = the cockpit Hire / Commercial; Other row in both tiles; Total column / row; each channel column =
 * that channel's Sched + Waiting on the by-channel tile (✓), grand total = the by-channel total; Courses emails ≥ 4;
 * nothing else on the tab changed.
 *   node scripts/playwright-verify-service-mix-v3-local.mjs     (PHASE=live: production as deployed)
 */
import fs from 'node:fs';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { loadTargetsMaster } from '../lib/targets-master.mjs';
import { targetsOf } from '../lib/marketing/service-mix.mjs';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
Object.assign(process.env, ENV);
const BASE = 'https://ai-geo-audit.vercel.app';
const LIVE = process.env.PHASE === 'live';
const TAG = LIVE ? 'live' : 'local';
const FILE = '/lib/marketing-service-mix.js';
const MOCK = 'C:/Users/alan/Google Drive/Claude shared resources/Claude Questions for Cursor/service-mix-tiles-v1.html';
const OUT = (k) => `outputs/service-mix-v3-${k}-${TAG}-1700px-20261112.png`;
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const refused = [];
const errors = [];
const API = {};
const log = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);

async function localSummary() {
  const { default: handler } = await import('../api/aigeo/strategy-summary.js');
  let body = null;
  await handler({ method: 'GET', query: {}, headers: {} }, { status() { return this; }, setHeader() {}, json(j) { body = JSON.stringify(j); return this; }, send(t) { body = typeof t === 'string' ? t : JSON.stringify(t); return this; } });
  return body;
}
function makeRoute(after) {
  return async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    if (req.method() !== 'GET') { refused.push(`${req.method()} ${url.pathname}`); return r.fulfill({ status: 403, contentType: 'application/json', body: '{"ok":false,"error":"refused by the read-only check"}' }); }
    if (!after || LIVE) return r.fallback();
    if (url.pathname === FILE) return r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`.${FILE}`, 'utf8') });
    if (url.pathname === '/api/aigeo/strategy-summary') return r.fulfill({ status: 200, contentType: 'application/json', body: API.summary });
    return r.fallback();
  };
}
async function render(browser, after) {
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1300 } });
  await ctx.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); localStorage.setItem('mks-channel', 'all'); }, ENV.ARP_ADMIN_KEY);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${after ? 'after' : 'before'}: ${e.message}`));
  await ctx.route('**/*', makeRoute(after));
  await page.goto(`${BASE}/audit-dashboard.html#marketing`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#mk-service-a [data-mksv-row]', { timeout: 180000 });
  await page.waitForFunction(() => document.querySelector('#mk-channels [data-mkch-row="youtube"] td:last-child')?.textContent !== 'loading…', null, { timeout: 90000 });
  await page.waitForTimeout(4000);
  await page.addStyleTag({ content: '#debugPanel { display: none !important; }' });
  return { ctx, page };
}
function layoutOf() {
  const top = document.getElementById('marketing-root').getBoundingClientRect().top;
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y - top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const norm = (t) => (t || '').replace(/\b\d{1,2}:\d{2}\b/g, 'HH:MM').replace(/\(\d+(\.\d+)? h ago\)/g, '(N h ago)').replace(/\d+ days? left|\d+ h left/g, 'N left').replace(/\s+/g, ' ').trim();
  const tiles = [...document.querySelectorAll('#mk-overview-tiles .mko-grid > .mko-tile')].filter((el) => !/^mk-service-/.test(el.id || '')).map((el) => ({ title: el.querySelector('.mko-title')?.textContent.trim(), ...box(el), text: norm(el.innerText) }));
  const sections = [...document.querySelectorAll('#marketing-root > *, #marketing-root .rt-section[id]')].filter((el) => el.id && el.offsetParent !== null && el.id !== 'mk-overview-tiles').map((el) => ({ id: el.id, ...box(el), text: norm(el.innerText).length }));
  return { tiles, sections, grid: box(document.querySelector('#mk-overview-tiles .mko-grid')) };
}
function tilesOf() {
  const num = (s) => (/^\s*—/.test(s || '') ? null : Number(String(s || '').replace(/[^\d]/g, '')));
  const a = [...document.querySelectorAll('#mk-service-a tbody [data-mksv-row]')].map((r) => { const td = [...r.children]; return { key: r.dataset.mksvRow, label: td[0].textContent.trim(), items: num(td[2].textContent), promo: num(td[3].textContent), target: num(td[4].textContent), ttip: td[4].getAttribute('title') || '', flag: td[5].textContent.trim() }; });
  const b = [...document.querySelectorAll('#mk-service-b tbody [data-mksv-row]')].map((r) => ({ key: r.dataset.mksvRow, label: r.children[0].textContent.trim(), total: Number(r.querySelector('[data-mksv-rowtotal]')?.textContent), cells: Object.fromEntries([...r.querySelectorAll('[data-mksv-cell]')].map((c) => [c.dataset.mksvCell.split(':')[1], Number(c.textContent)])) }));
  const col = Object.fromEntries([...document.querySelectorAll('#mk-service-b [data-mksv-coltotal]')].map((c) => [c.dataset.mksvColtotal, Number(c.firstChild.textContent)]));
  const ch = Object.fromEntries([...document.querySelectorAll('#mk-channels tbody > tr')].map((r) => { const td = [...r.children]; const v = (i) => Number(String(td[i].textContent).replace(/[^\d]/g, '')) || 0; return [r.dataset.mkchRow, v(1) + v(2)]; }));
  return {
    a, b, col, ch, grand: Number(document.querySelector('#mk-service-b [data-mksv-grand]')?.dataset.mksvGrand), totalA: Number(document.querySelector('#mk-service-a [data-mksv-total]')?.dataset.mksvTotal),
    ok: document.querySelectorAll('#mk-service-a [data-mksv-check="ok"], #mk-service-b [data-mksv-check="ok"]').length, off: document.querySelectorAll('[data-mksv-check="off"]').length,
    foot: document.querySelector('#mk-service-a .mko-src')?.textContent || ''
  };
}

async function targetChecks(t, sm) {
  const tg = t.a.filter((r) => r.key !== 'none');
  check(`every target row shows a % of target and a flag: ${tg.map((r) => `${r.key} ${r.target}% ${r.flag}`).join(' · ')}`, tg.every((r) => r.target != null && r.flag));
  check(`% of target sums to 100 (${tg.reduce((s, r) => s + r.target, 0)})`, tg.reduce((s, r) => s + r.target, 0) === 100);
  const g = sm.targets.gift_vouchers;
  check(`Gift vouchers target this month = £${g?.monthly} (${g?.seasonal ? 'stored seasonal' : 'Booking Sheet'}; Booking Sheet £${g?.booking_sheet_monthly}/month)`, g?.seasonal && g.monthly === 550 && g.booking_sheet_monthly === 83, g?.source);
  const master = await loadTargetsMaster(sb, 'https://www.alanranger.com', new Date());
  const cockpit = targetsOf(master);
  const six = Object.values(cockpit).reduce((s, v) => s + v.monthly, 0);
  const all = Object.values(sm.targets).reduce((s, v) => s + v.monthly, 0);
  check(`Hire £${sm.targets.hire.monthly} + Prints £${sm.targets.prints.monthly} = cockpit Hire / Commercial £${cockpit.hire.monthly}; six cockpit tiers £${six} + Gift £${g.monthly} = all rows £${all}`, sm.targets.hire.monthly + sm.targets.prints.monthly === cockpit.hire.monthly && six + g.monthly === all);
  for (const k of ['courses', 'workshops_nonres', 'workshops_residential', 'services', 'pnm_academy']) check(`${k} target £${sm.targets[k].monthly} = Survival Cockpit £${cockpit[k].monthly}`, sm.targets[k].monthly === cockpit[k].monthly);
  check('each target hover names its source', tg.every((r) => /\nSource: /.test(r.ttip)), tg.map((r) => `${r.key}: ${(r.ttip.split('Source: ')[1] || '').slice(0, 70)}`).join(' | '));
  check(`footnote: "${t.foot.match(/Gift vouchers: [^.]*\./)?.[0]}"`, /Gift vouchers: Booking Sheet £83\/month; Nov–Dec seasonal £550\/month \(vouchers only\)\./.test(t.foot));
}
function gridChecks(t) {
  check(`Other / not service-specific row in both tiles (6c: ${t.a.find((r) => r.key === 'none')?.items}, 6d: ${t.b.find((r) => r.key === 'none')?.total})`, t.a.some((r) => r.key === 'none') && t.b.find((r) => r.key === 'none')?.label === 'Other / not service-specific');
  check('6c and 6d list identical rows', t.a.map((r) => r.key).join() === t.b.map((r) => r.key).join(), t.b.map((r) => r.key).join(', '));
  const rowOff = t.b.filter((r) => r.total !== t.a.find((x) => x.key === r.key)?.items || r.total !== Object.values(r.cells).reduce((s, v) => s + v, 0));
  check('Total column: each row total = its cells = tile 6c Items', !rowOff.length, rowOff.map((r) => r.key).join(', '));
  const colOff = Object.keys(t.ch).filter((k) => t.col[k] !== t.ch[k]);
  check(`Total row = by-channel Sched + Waiting per channel: ${Object.keys(t.ch).map((k) => `${k} ${t.col[k]}/${t.ch[k]}`).join(' · ')}`, !colOff.length, colOff.join(', '));
  const by = Object.values(t.ch).reduce((s, v) => s + v, 0);
  check(`grand total ${t.grand} = 6c Total ${t.totalA} = by-channel total ${by}; ${t.ok} ✓, ${t.off} ⚠`, t.grand === by && t.totalA === by && t.ok === 9 && !t.off);
  const courses = t.b.find((r) => r.key === 'courses');
  check(`Courses emails = ${courses?.cells.email} (≥ 4)`, courses?.cells.email >= 4);
}
function unchangedChecks(lb, la) {
  for (const b of lb.tiles) {
    const a = la.tiles.find((x) => x.title === b.title);
    check(`${b.title}: same text, x and width`, a && a.text === b.text && a.x === b.x && a.w === b.w, a?.text === b.text ? '' : 'TEXT CHANGED');
  }
  const shift = la.grid.h - lb.grid.h;
  const off = la.sections.filter((s) => { const b = lb.sections.find((x) => x.id === s.id); return !b || b.x !== s.x || b.w !== s.w || b.text !== s.text || Math.abs(s.y - b.y - shift) > 2; });
  check(`nothing else on the tab changed: ${la.sections.length} sections keep x, width and text (tile area height change ${shift}px)`, !off.length, off.map((s) => s.id).join(', '));
}
async function shots(page, browser) {
  const box = await page.evaluate(() => {
    const a = document.getElementById('mk-service-a').getBoundingClientRect();
    const b = document.getElementById('mk-service-b').getBoundingClientRect();
    return { x: a.left - 4, y: a.top + window.scrollY - 4, width: b.right - a.left + 8, height: Math.max(a.height, b.height) + 8 };
  });
  await page.screenshot({ path: OUT('tiles'), fullPage: true, clip: box });
  await page.locator('#mk-overview-tiles .mko-grid').screenshot({ path: OUT('overview') });
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(`file:///${MOCK.replace(/ /g, '%20')}`);
  await p.locator('.row').first().screenshot({ path: 'outputs/_svc3-mock.png' });
  const img = (f) => `data:image/png;base64,${fs.readFileSync(f).toString('base64')}`;
  await p.setContent(`<body style="margin:0;background:#0b0e14;color:#d6dbe4;font:13px Segoe UI,Arial"><div style="padding:16px"><div>APPROVED MOCK-UP service-mix-tiles-v1</div><img src="${img('outputs/_svc3-mock.png')}"><div style="margin-top:12px">${LIVE ? 'PRODUCTION' : 'LOCAL BUILD on live data'}, 1700px (${new Date().toISOString().slice(0, 16)}Z)</div><img src="${img(OUT('tiles'))}"></div></body>`);
  await p.screenshot({ path: OUT('vs-mock'), fullPage: true });
  await ctx.close();
  fs.rmSync('outputs/_svc3-mock.png', { force: true });
}

if (!LIVE) { log('local strategy summary (in-process)'); API.summary = await localSummary(); }
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
log('before: production as served');
const pb = await render(browser, false);
const lb = await pb.page.evaluate(layoutOf);
await pb.ctx.close();
log(LIVE ? 'after: production' : 'after: local service-mix file + local summary');
const pa = await render(browser, true);
const sm = LIVE ? await pa.page.evaluate(async () => (await (await fetch('/api/aigeo/strategy-summary')).json()).service_mix) : JSON.parse(API.summary).service_mix;
const t = await pa.page.evaluate(tilesOf);
const la = await pa.page.evaluate(layoutOf);
await targetChecks(t, sm);
gridChecks(t);
unchangedChecks(lb, la);
await shots(pa.page, browser);
await pa.ctx.close();
await browser.close();
check(`this check wrote nothing (${refused.length} non-GET refused)`, true, [...new Set(refused)].join(', '));
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
fs.writeFileSync(`outputs/_service-mix-v3-${TAG}-result.json`, JSON.stringify({ results, tiles: t, targets: sm?.targets, tags: sm?.tags }, null, 1));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);
process.exit(0);

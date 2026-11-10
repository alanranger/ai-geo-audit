/**
 * QUESTION-2026-11-10 channel-tile-and-tile-order (parts 1–2): "Next 12 weeks: by channel" + the new tile order, LOCAL
 * code on LIVE data, 1700px, read-only. "Before" = production as served; "after" = production with the new script tag
 * injected (lib/marketing-channels-tile.js?v=chan-20261110a before marketing-overview-tiles.js), both tile files served
 * from this folder and GET /api/aigeo/strategy-summary answered in-process by this repo (it adds purpose_mix.items).
 * Every non-GET request is refused (403). Campaign titles only.
 *   node scripts/playwright-verify-channel-tile-local.mjs      (PHASE=live: production after deploy)
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
Object.assign(process.env, ENV);
const BASE = 'https://ai-geo-audit.vercel.app';
const LIVE = process.env.PHASE === 'live';
const TAG = LIVE ? 'live' : 'local';
const V = 'chan-20261110a';
const FILES = ['/lib/marketing-channels-tile.js', '/lib/marketing-overview-tiles.js'];
const TABLES = { strategy_campaigns: 'updated_at', marketing_social_placements: 'set_at', strategy_campaign_ticks: 'set_at', sqs_scheduled_emails: 'collected_at' };
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const refused = [];
const errors = [];
const API = {};

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
const withTag = (html) => html.replace('<script src="/lib/marketing-overview-tiles.js', `<script src="/lib/marketing-channels-tile.js?v=${V}"></script>\n<script src="/lib/marketing-overview-tiles.js`);
/** PHASE=live "before": the deployed page without the new tag and with the parent commit's overview tiles (old order). */
const COMMIT = '5102955a';
async function liveBefore(r, url) {
  if (url.pathname === '/audit-dashboard.html') { const res = await r.fetch(); return r.fulfill({ response: res, body: (await res.text()).replace(/<script src="\/lib\/marketing-channels-tile\.js[^"]*"><\/script>\s*/, '') }); }
  if (url.pathname === '/lib/marketing-overview-tiles.js') return r.fulfill({ status: 200, contentType: 'application/javascript', body: execSync(`git show ${COMMIT}~1:lib/marketing-overview-tiles.js`, { encoding: 'utf8' }) });
  return r.fallback();
}
function makeRoute(after) {
  return async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    if (req.method() !== 'GET') { refused.push(`${req.method()} ${url.pathname}`); return r.fulfill({ status: 403, contentType: 'application/json', body: '{"ok":false,"error":"refused by the read-only check"}' }); }
    if (LIVE && !after) return liveBefore(r, url);
    if (!after || LIVE) return r.fallback();
    if (url.pathname === '/audit-dashboard.html') { const res = await r.fetch(); return r.fulfill({ response: res, body: withTag(await res.text()) }); }
    if (FILES.includes(url.pathname)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`.${url.pathname}`, 'utf8') });
    if (url.pathname === '/api/aigeo/strategy-summary') return r.fulfill({ status: 200, contentType: 'application/json', body: API.summary });
    return r.fallback();
  };
}
async function render(browser, after) {
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1200 } });
  await ctx.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); localStorage.setItem('mks-channel', 'all'); }, ENV.ARP_ADMIN_KEY);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${after ? 'after' : 'before'}: ${e.message}`));
  await ctx.route('**/*', makeRoute(after));
  await page.goto(`${BASE}/audit-dashboard.html#marketing`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#mk-sqs-cycles') && document.querySelector('#mk-overview-tiles .mko-mix'), null, { timeout: 240000 });
  if (after) await page.waitForFunction(() => document.querySelector('#mk-channels [data-mkch-row="youtube"] td:last-child')?.textContent !== 'loading…', null, { timeout: 120000 });
  await page.waitForSelector('#mk-social .mksoc-g', { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(4000);
  await page.addStyleTag({ content: '#debugPanel { display: none !important; }' });
  return { ctx, page };
}

function layoutOf() {
  const panel = document.getElementById('marketing-root');
  const top = panel.getBoundingClientRect().top;
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y - top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const norm = (t) => (t || '').replace(/\b\d{1,2}:\d{2}\b/g, 'HH:MM').replace(/\(\d+(\.\d+)? h ago\)/g, '(N h ago)').replace(/\d+ days? left|\d+ h left/g, 'N left').replace(/\s+/g, ' ').trim();
  const tiles = [...document.querySelectorAll('#mk-overview-tiles .mko-grid > .mko-tile')].map((el) => ({ id: el.id || null, title: el.querySelector('.mko-title')?.textContent.trim(), num: el.querySelector('.mko-num')?.textContent || null, ...box(el), text: norm(el.innerText) }));
  const sections = [...document.querySelectorAll('#marketing-root > *, #marketing-root .rt-section[id]')].filter((el) => el.id && el.offsetParent !== null && el.id !== 'mk-overview-tiles').map((el) => ({ id: el.id, ...box(el) }));
  return { tiles, sections, grid: box(document.querySelector('#mk-overview-tiles .mko-grid')), alert: !!document.querySelector('.mko-alert') };
}
function channelOf() {
  const t = document.getElementById('mk-channels');
  const num = (s) => (s === '—' ? null : Number(String(s || '').replace(/[^\d]/g, '')));
  const rows = [...t.querySelectorAll('tr[data-mkch-row]')].map((r) => {
    const td = [...r.querySelectorAll('td')];
    return { key: r.dataset.mkchRow, go: r.dataset.mkchGo, sub: r.classList.contains('mkch-sub'), label: td[0].childNodes[0]?.textContent.trim(), sched: num(td[1].textContent), waiting: num(td[2].textContent), drafts: num(td[3].textContent), next: td[4].textContent, title: r.getAttribute('title'), flags: [...r.querySelectorAll('[data-mkch-flag]')].map((f) => ({ kind: f.dataset.mkchFlag, text: f.textContent, tip: f.getAttribute('title') })) };
  });
  const mixTile = [...document.querySelectorAll('#mk-overview-tiles .mko-tile')].find((x) => /content mix/.test(x.querySelector('.mko-title')?.textContent || ''));
  return {
    rows, rec: t.querySelector('[data-mkch-rec]')?.dataset.mkchRec, rec_text: t.querySelector('[data-mkch-rec]')?.textContent, tip: t.querySelector('.mko-title')?.getAttribute('title'), head: t.querySelector('.mko-head')?.textContent.trim(),
    mix_head: num(mixTile.querySelector('.mko-head > span')?.firstChild?.textContent), mix_chip: num(mixTile.querySelector('.mko-chip')?.textContent)
  };
}

const IN_MIX = ['email', 'fbig', 'linkedin', 'outlook', 'other'];
function tileChecks(c) {
  const main = c.rows.filter((r) => IN_MIX.includes(r.key));
  const planned = (r) => Number((r.flags.find((f) => f.kind === 'planned')?.text.match(/^\d+/) || [0])[0]);
  const live = main.reduce((t, r) => t + r.sched + r.waiting + planned(r), 0);
  const drafts = main.reduce((t, r) => t + r.drafts, 0);
  check(`rows reconcile with the content-mix tile: Σ(sched + waiting + planned, no post) = ${live} = headline ${c.mix_head}; Σ drafts = ${drafts} = chip +${c.mix_chip}`, live === c.mix_head && drafts === c.mix_chip && c.rec === 'ok', c.rec_text);
  check(`rows: ${c.rows.map((r) => `${r.sub ? '└' : ''}${r.label} ${r.sched ?? '—'}/${r.waiting ?? '—'}/${r.drafts ?? '—'} next ${r.next}`).join(' · ')}`, ['email', 'fbig', 'facebook_feed', 'instagram_feed', 'instagram_story', 'linkedin', 'gbp', 'youtube'].every((k) => c.rows.some((r) => r.key === k)));
  const li = c.rows.find((r) => r.key === 'linkedin');
  check(`LinkedIn gap flag: "${li?.flags.map((f) => f.text).join(' · ')}" (hover: ${li?.flags[0]?.tip?.slice(0, 90)}…)`, li?.flags.some((f) => f.kind === 'planned'));
  const gb = c.rows.find((r) => r.key === 'gbp');
  check(`Google Business gap flag: "${gb?.flags.map((f) => f.text).join(' · ')}" (hover: ${gb?.flags[0]?.tip?.slice(0, 110)}…)`, gb?.flags.some((f) => f.kind === 'gap'));
  const yt = c.rows.find((r) => r.key === 'youtube');
  check(`YouTube Shorts from the content records: ${yt?.sched ?? '—'} scheduled, next ${yt?.next}`, yt && yt.sched != null, yt?.title);
  check('title hover tip explains Sched / Waiting / Drafts', /Sched = booked in the platform/.test(c.tip || '') && /Waiting = approved/.test(c.tip) && /Drafts = still being prepared/.test(c.tip));
}
function orderChecks(lb, la) {
  const titleOf = (l) => l.tiles.map((t) => t.title);
  check(`order after: ${titleOf(la).join(' · ')}`, /content mix · Next 12 weeks: by channel · Email capacity · Eligible audience · Needs Alan · Data & alignment health/.test(titleOf(la).join(' · ')));
  const row1 = la.tiles.filter((t) => t.y === la.tiles[0].y).map((t) => t.title);
  check(`row 1 = ${row1.join(' · ')}`, row1.length === 4 && /by channel/.test(row1[1]) && /Email capacity/.test(row1[2]) && /Eligible audience/.test(row1[3]));
  for (const name of ['Needs Alan', 'Data & alignment health']) {
    const b = lb.tiles.find((t) => t.title === name);
    const a = la.tiles.find((t) => t.title === name);
    check(`${name}: on row 2 (y ${b.y} → ${a.y}), same width ${a.w}px and same text; number ${a.num}`, a.y > la.tiles[0].y && a.w === b.w && a.text === b.text && a.num === b.num, a.h !== b.h ? `height ${b.h} → ${a.h} (row height)` : '');
  }
  for (const name of ['Next 12 weeks: content mix', 'Email capacity', 'Eligible audience', 'Squarespace campaigns by billing cycle ⓘ']) {
    const b = lb.tiles.find((t) => t.title === name);
    const a = la.tiles.find((t) => t.title === name);
    check(`${name}: same text and width (${b.x},${b.y} ${b.w}px → ${a.x},${a.y} ${a.w}px)`, a && b && a.text === b.text && a.w === b.w, a?.text === b?.text ? '' : 'TEXT CHANGED');
  }
  const shift = la.grid.h - lb.grid.h;
  const off = la.sections.filter((s) => { const b = lb.sections.find((x) => x.id === s.id); return !b || b.x !== s.x || b.w !== s.w || Math.abs(s.y - b.y - shift) > 2; });
  check(`nothing else moved: ${la.sections.length} later sections keep x and width and shift by the tile area's height change only (${shift}px)`, !off.length, off.map((s) => s.id).join(', '));
  check(`decision alert at the top only when a decision waits (now: ${la.alert ? 'shown' : 'none'}, Needs Alan reads "${(la.tiles.find((t) => t.title === 'Needs Alan')?.text || '').slice(10, 40)}")`, la.alert === !/No decisions waiting/.test(la.tiles.find((t) => t.title === 'Needs Alan')?.text || ''));
}
async function clickCheck(page) {
  await page.locator('#mk-channels [data-mkch-row="linkedin"]').click();
  await page.waitForTimeout(1200);
  const v = await page.evaluate(() => (typeof window.mkScheduleView === 'function' ? window.mkScheduleView() : null));
  check(`click LinkedIn → schedule filtered to LinkedIn (channel "${v?.channel}")`, v?.channel === 'linkedin');
  await page.evaluate(() => document.querySelector('#mk-schedule [data-mks-channel="all"]')?.click());
}

const before = await dbState();
if (!LIVE) API.summary = await localSummary();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const a = await render(browser, false);
const lb = await a.page.evaluate(layoutOf);
await a.page.locator('#mk-overview-tiles .mko-grid').screenshot({ path: `outputs/channel-tile-overview-before-${TAG}-1700px-20261110.png` });
await a.ctx.close();
const b = await render(browser, true);
if (LIVE) {
  const tags = await b.page.evaluate((f) => f.map((x) => document.querySelector(`script[src^="${x}"]`)?.getAttribute('src')), FILES);
  check(`production serves the ?v=${V} tags`, tags.every((s) => String(s).endsWith(`?v=${V}`)), tags.join(' '));
  const clean = (t) => t.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const served = await b.page.evaluate(async (list) => Promise.all(list.map(async (s) => (await fetch(s, { cache: 'no-store' })).text())), tags);
  const same = tags.map((s, i) => clean(served[i]) === clean(execSync(`git show ${COMMIT}:${s.split('?')[0].slice(1)}`, { encoding: 'utf8' })));
  check(`both served files are identical to ${COMMIT}`, same.every(Boolean), tags.map((s, i) => `${s.split('?')[0]} ${same[i] ? 'same' : 'DIFFERS'}`).join(' · '));
  const items = await b.page.evaluate(async () => (await (await fetch('/api/aigeo/strategy-summary')).json()).quarter_plan?.purpose_mix?.items?.length ?? null);
  check(`production strategy summary returns purpose_mix.items (${items})`, items > 0);
}
const la = await b.page.evaluate(layoutOf);
const c = await b.page.evaluate(channelOf);
await b.page.locator('#mk-overview-tiles .mko-grid').screenshot({ path: `outputs/channel-tile-overview-after-${TAG}-1700px-20261110.png` });
await b.page.locator('#mk-channels').screenshot({ path: `outputs/channel-tile-${TAG}-1700px-20261110.png` });
tileChecks(c);
orderChecks(lb, la);
await clickCheck(b.page);
await b.ctx.close();
await browser.close();
const after = await dbState();
const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
check('viewing writes nothing (row counts + newest timestamps)', !changed.length, changed.map((k) => `${k}: ${before[k]} → ${after[k]}`).join(' | ') || `${Object.keys(TABLES).length} tables unchanged`);
check('every non-GET refused', true, `${refused.length} refused: ${[...new Set(refused)].join(', ') || 'none attempted'}`);
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
fs.writeFileSync(`outputs/_channel-tile-${TAG}-result.json`, JSON.stringify({ results, channel: c, before: lb, after: la }, null, 1));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);
process.exit(0);

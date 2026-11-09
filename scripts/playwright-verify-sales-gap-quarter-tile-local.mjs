/**
 * Sales gap quarter tile v2 (QUESTION-2026-11-09 (n)) on LIVE data with the LOCAL code, 1700px. Read-only: serves the
 * local strategy scripts, answers /api/aigeo/strategy-summary and /api/aigeo/prospects with the local handlers, refuses
 * every non-GET, and compares DB row counts + newest timestamps before / after.
 *   PHASE=before node scripts/playwright-verify-sales-gap-quarter-tile-local.mjs   (committed browser files: layout + screenshots of the old tile)
 *   PHASE=after  node scripts/playwright-verify-sales-gap-quarter-tile-local.mjs   (checks + diff against the before run)
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
Object.assign(process.env, { SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: ENV.SUPABASE_SERVICE_ROLE_KEY, ARP_ADMIN_KEY: ENV.ARP_ADMIN_KEY });
const PHASE = process.env.PHASE === 'after' ? 'after' : 'before';
const BASE = 'https://ai-geo-audit.vercel.app';
const OUT = 'outputs';
const STAMP = '20261109';
const LOCAL_FILES = ['strategy-tab.js', 'strategy-layout.js', 'strategy-sales-gap.js', 'strategy-prospects.js', 'strategy-quarter-plan.js'];
const TABLES = { prospect_enquiry: 'updated_at', prospect_enquiry_history: 'at', prospect_stage_config: 'stage', strategy_event_snapshots: 'created_at', strategy_campaign_steps: 'last_seen_at', strategy_quarter_actions: 'updated_at', marketing_decisions: 'decided_at', business_targets: 'updated_at' };
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const blocked = [];
const errors = [];

async function dbState() {
  const out = {};
  for (const [t, c] of Object.entries(TABLES)) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true });
    const { data, error } = await sb.from(t).select(c).not(c, 'is', null).order(c, { ascending: false }).limit(1);
    Object.assign(out, { [`${t}.rows`]: count, [`${t}.max(${c})`]: error ? 'n/a' : data?.[0]?.[c] || null });
  }
  return out;
}
const fakeRes = (set) => ({ status() { return this; }, setHeader() {}, json(j) { set(JSON.stringify(j)); return this; }, send(t) { set(typeof t === 'string' ? t : JSON.stringify(t)); return this; } });
let summaryBody = null;
async function localSummary() {
  if (summaryBody) return summaryBody;
  const { default: handler } = await import('../api/aigeo/strategy-summary.js');
  await handler({ method: 'GET', query: {}, headers: {} }, fakeRes((b) => { summaryBody = b; }));
  return summaryBody;
}
async function localProspects() {
  const { default: handler } = await import('../api/aigeo/prospects.js');
  let body = null;
  await handler({ method: 'GET', query: {}, headers: { 'x-arp-admin-key': ENV.ARP_ADMIN_KEY } }, fakeRes((b) => { body = b; }));
  return body;
}
async function routes(page) {
  await page.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); }, ENV.ARP_ADMIN_KEY);
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() !== 'GET') { if (url.pathname.startsWith('/api/')) blocked.push(`${req.method()} ${url.pathname}`); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' }); }
    const file = LOCAL_FILES.find((f) => url.pathname === `/lib/${f}`);
    if (file) return route.fulfill({ status: 200, contentType: 'application/javascript', body: PHASE === 'before' ? execSync(`git show HEAD:lib/${file}`, { encoding: 'utf8' }) : fs.readFileSync(`lib/${file}`, 'utf8') });
    if (url.pathname === '/api/aigeo/prospects') return route.fulfill({ status: 200, contentType: 'application/json', body: await localProspects() });
    if (url.pathname === '/api/aigeo/strategy-summary') return route.fulfill({ status: 200, contentType: 'application/json', body: await localSummary() });
    return route.fallback();
  });
}

/** Position + text of every block on the Strategy page except the quarter tile (the only thing allowed to change). */
function layoutOf() {
  const panel = document.querySelector('section[data-panel="strategy"]');
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) }; };
  const txt = (el) => (el.innerText || '').replace(/\s+/g, ' ').trim();
  const blocks = [...panel.querySelectorAll('[id^="st-"]')].filter((el) => el.offsetParent !== null && el.id !== 'st-sales-gap').map((el) => ({ id: el.id, ...box(el), text: txt(el) }));
  const months = [...document.querySelectorAll('#st-sales-gap [data-sg-month]')].map((el) => ({ id: el.dataset.sgMonth, ...box(el), text: txt(el) }));
  const outside = [...document.querySelectorAll('#st-sales-gap > *:not(.sg-grid):not(style)')].map((el, i) => ({ id: `gap-${i}-${el.tagName}`, ...box(el), text: txt(el) }));
  const q = document.querySelector('#st-sales-gap .sg-q');
  return { blocks, months, outside, quarter: q ? { ...box(q), text: txt(q) } : null, height: Math.round(panel.getBoundingClientRect().height) };
}
function tileOf() {
  const q = document.querySelector('#st-sales-gap .sg-q');
  const rows = (sel) => [...q.querySelectorAll(`${sel} tr`)].map((tr) => [...tr.cells].map((c) => c.innerText.trim()));
  return {
    head: q.querySelector('.sg-h')?.innerText.replace(/\s+/g, ' ').trim(), big: q.querySelector('.sg-big')?.innerText.replace(/\s+/g, ' ').trim(), bar: q.querySelector('.sg-bar')?.innerText.replace(/\s+/g, ' ').trim(),
    dated: rows('.sg-cat'), nondated: rows('.sg-nd'), note: q.querySelector('.sg-ndnote')?.innerText.trim(), pipe: q.querySelector('.sg-pipe')?.innerText.replace(/\s+/g, ' ').trim(),
    verdict: !!q.querySelector('.sg-v'), details: q.querySelector('details.sg-qd > summary')?.innerText.trim(), rulesLink: !!q.querySelector('[data-sg-rules]')
  };
}

const k1 = (v) => `£${(Math.round((Number(v) || 0) / 100) / 10).toFixed(1)}k`;
const gbpK = (v) => (Math.abs(v) >= 1000 ? `£${(Math.round(Math.abs(v) / 100) / 10).toLocaleString('en-GB')}k` : `£${Math.round(Math.abs(v)).toLocaleString('en-GB')}`);
const num = (t) => Number(String(t).replace(/[£k,%]/g, '')) * (/k$/.test(t) ? 1000 : 1);
function faceChecks(tile, r) {
  check('face: header, £ still to sell, bar labels (mock-up)', /^Quarter · 9 Nov → 31 Jan revenue$/.test(tile.head) && tile.big === `${k1(r.still_to_sell)} still to sell` && tile.bar === `${k1(r.likely)} likely dated ${k1(r.non_dated_needed)} non-dated`, `${tile.head} · ${tile.big} · bar "${tile.bar}"`);
  check('face: yellow verdict box retired; "details" fold + Rules link; Rules link opens the Rules fold', !tile.verdict && tile.details === 'details' && tile.rulesLink && tile.rulesOpen, `verdict ${tile.verdict} · summary "${tile.details}" · rules opened ${tile.rulesOpen}`);
  check('pipeline line reads the prospects tables: £0 / £0 / £0 until enquiries are loaded', tile.pipe === `Prospects pipeline: ${gbpK(r.pipeline.weighted)} weighted · dated ${gbpK(r.pipeline.dated)} · undated ${gbpK(r.pipeline.undated)}` && r.pipeline.weighted === 0, tile.pipe);
}
function datedChecks(tile, r) {
  const [head, ...body] = tile.dated;
  const rows = body.slice(0, -1);
  const tot = body[body.length - 1];
  const col = (i) => rows.reduce((a, x) => a + num(x[i]), 0);
  check('Dated events columns: Category / Events / Unsold places / If all sold / Fill rate / Likely £', head.join('|') === 'Category|Events|Unsold places|If all sold|Fill rate|Likely £', head.join(' | '));
  check(`category rows sum to the total row and "stock on sale now" (${r.stock.events} events / ${r.stock.places} places / ${k1(r.stock.gbp)})`, col(1) === Number(tot[1]) && Number(tot[1]) === r.stock.events && col(2) === Number(tot[2]) && Number(tot[2]) === r.stock.places && tot[3] === k1(r.stock.gbp) && r.categories.adds_up, body.map((x) => x.join(' ')).join(' · '));
  check(`Likely £ rows add up to the tile's likely total (${k1(r.likely)}; unrounded rows ${r.categories.rows.map((x) => Math.round(x.likely)).join(' + ')} = ${Math.round(r.categories.rows.reduce((a, x) => a + x.likely, 0))})`, tot[5] === k1(r.likely) && Math.abs(r.categories.rows.reduce((a, x) => a + x.likely, 0) - r.likely) < 0.5, `shown ${rows.map((x) => x[5]).join(' + ')} → ${tot[5]}`);
}
function nonDatedChecks(tile, r, sg, layout) {
  const [, row] = tile.nondated;
  const cells = row.slice(1, -1);
  const monthsOk = sg.months.every((m, i) => cells[i] === k1(m.non_dated_needed) && layout.months[i].text.includes(`Non-dated needed (likely) ${gbpK(m.non_dated_needed)}`));
  check(`Non-dated needed: Nov / Dec / Jan sum to the total (${k1(r.non_dated.total)}), each = its monthly tile`, monthsOk && row[row.length - 1] === k1(r.non_dated_needed) && Math.abs(r.non_dated.months.reduce((a, m) => a + m.gbp, 0) - r.non_dated.total) < 0.01, `${row.join(' ')} · monthly tiles ${sg.months.map((m) => `${m.label} ${gbpK(m.non_dated_needed)} (${Math.round(m.non_dated_needed)})`).join(' · ')}`);
  check('note line under non-dated', tile.note === 'From gift vouchers, Pick n Mix, 1-2-1s, mentoring, Academy, commissions, prints & royalties.', tile.note);
}
function movedChecks(layout, prior) {
  const key = (b) => `${b.x},${b.y},${b.w},${b.h}|${b.text}`;
  const diff = (a, b) => a.filter((x) => { const y = b.find((z) => z.id === x.id); return !y || key(x) !== key(y); }).map((x) => x.id);
  const moved = [...diff(layout.blocks, prior.blocks), ...diff(layout.months, prior.months), ...diff(layout.outside, prior.outside)];
  check('nothing else moved: every other block and the 3 monthly tiles have the same position, size and text as before', !moved.length && layout.blocks.length === prior.blocks.length, moved.join(', ') || `${layout.blocks.length} blocks + ${layout.months.length} month tiles + ${layout.outside.length} sales-gap lines identical · quarter tile ${prior.quarter.w}×${prior.quarter.h} → ${layout.quarter.w}×${layout.quarter.h}`);
}

const before = await dbState();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
page.on('pageerror', (e) => errors.push(e.message));
await routes(page);
await page.goto(`${BASE}/audit-dashboard.html#strategy`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#st-sales-gap .sg-q') && document.querySelector('#st-fold-why'), null, { timeout: 240000 });
await page.waitForFunction(() => !/Loading enquiries|Loading prospects/.test(document.getElementById('st-prospects')?.textContent || 'Loading'), null, { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(4000);
const layout = await page.evaluate(layoutOf);
await page.evaluate(() => [...document.querySelectorAll('body *')].filter((el) => getComputedStyle(el).position === 'fixed' && el.getBoundingClientRect().top > window.innerHeight / 2).forEach((el) => { el.style.visibility = 'hidden'; }));
const shot = (name) => `${OUT}/sales-gap-quarter-tile-v2-${name}-${PHASE}-local-1700px-${STAMP}.png`;
await page.locator('#st-sales-gap').screenshot({ path: shot('tiles') });
await page.locator('#st-sales-gap .sg-q').screenshot({ path: shot('quarter') });
await page.evaluate(() => window.scrollTo(0, 0));
await page.screenshot({ path: shot('page'), fullPage: true });
let tile = null;
if (PHASE === 'after') {
  tile = await page.evaluate(tileOf);
  await page.evaluate(() => { const d = document.querySelector('#st-sales-gap details.sg-qd'); if (d) d.open = true; });
  await page.waitForTimeout(300);
  await page.locator('#st-sales-gap .sg-q').screenshot({ path: shot('quarter-details-open') });
  tile.detailsText = await page.evaluate(() => document.querySelector('#st-sales-gap details.sg-qd')?.innerText.replace(/\s+/g, ' ').trim());
  await page.evaluate(() => document.querySelector('#st-sales-gap [data-sg-rules]')?.click());
  tile.rulesOpen = await page.evaluate(() => !!document.getElementById('sg-rules')?.open);
  await page.evaluate(() => { const d = document.querySelector('#st-sales-gap details.sg-qd'); if (d) d.open = false; const r = document.getElementById('sg-rules'); if (r) r.open = false; });
}
await browser.close();
const after = await dbState();
const changed = Object.keys(before).filter((x) => before[x] !== after[x]);
check('viewing writes nothing (row counts + newest timestamps)', !changed.length, changed.map((x) => `${x}: ${before[x]} → ${after[x]}`).join(' | ') || `${Object.keys(TABLES).length} tables unchanged`);
check('every non-GET refused', true, `${blocked.length} refused: ${[...new Set(blocked)].join(', ') || 'none attempted'}`);
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));

const snap = { layout, tile, summary: JSON.parse(summaryBody || '{}').sales_gap?.rolling || null };
fs.writeFileSync(`${OUT}/_qt2-${PHASE}-layout.json`, JSON.stringify(snap, null, 1));
if (PHASE === 'after') {
  const sg = JSON.parse(summaryBody).sales_gap;
  faceChecks(tile, sg.rolling);
  datedChecks(tile, sg.rolling);
  nonDatedChecks(tile, sg.rolling, sg, layout);
  movedChecks(layout, JSON.parse(fs.readFileSync(`${OUT}/_qt2-before-layout.json`, 'utf8')).layout);
  const ken = sg.months.flatMap((m) => [...m.prime.list, ...m.outside.list]).find((e) => /Kenilworth/.test(e.title) && e.date === '2027-03-22');
  check('Long Exposure - Kenilworth 22/03 is a one-day workshop in the split', ken?.type === 'day', JSON.stringify(ken));
  console.log('details:', tile.detailsText);
}
fs.writeFileSync(`${OUT}/_qt2-${PHASE}-result.json`, JSON.stringify({ results, before, after }, null, 1));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
process.exit(0);

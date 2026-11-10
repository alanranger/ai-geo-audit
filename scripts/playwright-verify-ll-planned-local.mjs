/**
 * QUESTION-2026-11-10 light-and-logic-not-on-hold, LIVE data, 1700px. Read-only: every non-GET refused.
 *   PHASE=before  production as is      PHASE=after  local browser files + local board / strategy summary on a
 *   Supabase client whose writes are blocked and logged (LIVE=1: production after deploy). PAGE=marketing|strategy.
 * Checks: gpt-ll steps "Planned — content to prepare" (List, grid card, Campaign steps, Strategy), no "On hold" text,
 * the 19 Nov card has no Light & Logic label, the 17 Dec module still shows, content mix / channel tile drafts.
 * Screenshots: outputs/ll-planned-<page>-<phase>-<local|live>-1700px-20261110.png
 */
import fs from 'node:fs';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
Object.assign(process.env, { SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: ENV.SUPABASE_SERVICE_ROLE_KEY });
const PHASE = process.env.PHASE || 'after';
const PAGE = process.env.PAGE || 'marketing';
const LIVE = process.env.LIVE === '1';
const LOCAL = PHASE === 'after' && !LIVE;
const TAG = `${PAGE}-${PHASE}-${LIVE ? 'live' : 'local'}`;
const FILES = ['marketing-schedule-list.js', 'marketing-delivery.js', 'strategy-board.js'];
const refused = [];
const blocked = [];
const errors = [];
const W = new Set(['insert', 'upsert', 'update', 'delete']);
const inert = (l) => { blocked.push(l); const p = new Proxy(() => {}, { get: (_t, k) => (k === 'then' ? (ok) => ok({ data: null, error: null }) : () => p), apply: () => p }); return p; };
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ro = new Proxy(sb, { get: (t, k) => (k === 'from' ? (tb) => new Proxy(t.from(tb), { get: (x, m) => (W.has(m) ? () => inert(`${tb}.${String(m)}`) : (typeof x[m] === 'function' ? x[m].bind(x) : x[m])) }) : (k === 'rpc' ? (n) => inert(`rpc ${n}`) : (typeof t[k] === 'function' ? t[k].bind(t) : t[k]))) });
const cache = {};
async function local(name) {
  if (cache[name]) return cache[name];
  if (name === 'board') { const { buildStatusBoard } = await import('../lib/marketing/delivery-status-board.mjs'); cache[name] = JSON.stringify({ ok: true, ...(await buildStatusBoard(ro)) }); }
  if (name === 'summary') { const { buildStrategySummary } = await import('../lib/strategy-summary.mjs'); cache[name] = JSON.stringify({ ok: true, ...(await buildStrategySummary(ro, 'https://www.alanranger.com', { noBackfill: true, insights: true })) }); }
  return cache[name];
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); localStorage.setItem('mks-layout', 'list'); localStorage.setItem('mks-lrange', '9'); localStorage.setItem('mks-channel', 'all'); }, ENV.ARP_ADMIN_KEY);
await page.route('**/*', async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  if (req.method() !== 'GET') { if (url.pathname.startsWith('/api/')) refused.push(`${req.method()} ${url.pathname}`); return route.fulfill({ status: 403, contentType: 'application/json', body: '{"ok":false}' }); }
  if (!LOCAL) return route.fallback();
  const file = FILES.find((f) => url.pathname === `/lib/${f}`);
  if (file) return route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`lib/${file}`, 'utf8') });
  if (url.pathname === '/api/aigeo/marketing' && url.searchParams.get('action') === 'delivery-status') return route.fulfill({ status: 200, contentType: 'application/json', body: await local('board') });
  if (url.pathname === '/api/aigeo/strategy-summary') return route.fulfill({ status: 200, contentType: 'application/json', body: await local('summary') });
  return route.fallback();
});
await page.goto(`https://ai-geo-audit.vercel.app/audit-dashboard.html#${PAGE}`, { waitUntil: 'domcontentloaded' });
const ready = PAGE === 'marketing'
  ? () => !document.querySelector('#mk-planned.mkw-loading') && /Tasks/.test(document.querySelector('#mk-schedule .mks-body')?.textContent || '') && document.querySelector('#mk-campaign-host #st-campaign-table')
  : () => /Next:/.test(document.querySelector('#st-quarter-plan')?.textContent || '');
await page.waitForFunction(ready, null, { timeout: 55000 }).catch(() => null);
await page.waitForTimeout(2500);

const out = { phase: TAG, refused: refused.length, blocked_writes: [...new Set(blocked)], page_errors: errors.slice(0, 3) };
if (PAGE === 'marketing') {
  Object.assign(out, await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#mk-schedule .mkl-row, #mk-schedule .mkl-block li')];
    const rowText = (re) => rows.filter((r) => re.test(r.textContent)).map((r) => r.innerText.replace(/\s+/g, ' ').slice(0, 230));
    const nov19 = rows.filter((r) => /Small details, new possibilities/.test(r.textContent));
    const visible = (el) => el.innerText.replace(/\s+/g, ' ');
    const host = document.getElementById('mk-campaign-host');
    const steps = [...(host?.querySelectorAll('#st-campaign-table tbody tr.st-row') || [])].filter((tr) => /Light & Logic/.test(tr.textContent)).map((tr) => tr.textContent.replace(/\s+/g, ' ').slice(0, 160));
    const tiles = document.getElementById('mk-overview-tiles')?.innerText || '';
    return {
      ll_list: rowText(/Light & Logic/), nov19_card: nov19.map(visible), nov19_has_ll_label: nov19.some((r) => /Light & Logic/.test(r.innerText)),
      dec17_module: rowText(/Light & Logic Dec edition module/).length > 0,
      on_hold_text: /On hold|on hold/.test(document.getElementById('marketing-root')?.innerText || ''),
      campaign_steps_ll: steps, mix_line: (tiles.match(/content mix[\s\S]{0,140}/) || [''])[0].replace(/\s+/g, ' '), channels_rec: document.querySelector('[data-mkch-rec]')?.textContent || ''
    };
  }));
  await page.evaluate(() => [...document.querySelectorAll('#mk-schedule .mkl-row')].find((r) => /Light & Logic newsletter/.test(r.textContent))?.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `outputs/ll-planned-list-${PHASE}-${LIVE ? 'live' : 'local'}-1700px-20261110.png` });
  await page.evaluate(() => [...document.querySelectorAll('#mk-schedule .mkl-row, #mk-schedule .mkl-block')].find((r) => /Small details, new possibilities/.test(r.textContent))?.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `outputs/ll-planned-19nov-${PHASE}-${LIVE ? 'live' : 'local'}-1700px-20261110.png` });
  await page.evaluate(() => { const el = document.getElementById('st-campaign-table'); for (let d = el?.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true; [...(el?.querySelectorAll('tr') || [])].find((tr) => /Light & Logic/.test(tr.textContent))?.scrollIntoView({ block: 'center' }); });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `outputs/ll-planned-campaign-steps-${PHASE}-${LIVE ? 'live' : 'local'}-1700px-20261110.png` });
} else {
  Object.assign(out, await page.evaluate(() => {
    const panel = document.querySelector('section[data-panel="strategy"]')?.innerText || '';
    return { next_ll: [...document.querySelectorAll('#st-quarter-plan .qp-l')].map((e) => e.textContent.trim()).filter((t) => /Light & Logic/.test(t)), on_hold_text: /On hold|on hold \(Alan\)/.test(panel), planned_text: /Planned — content to prepare/.test(panel) };
  }));
  await page.evaluate(() => [...document.querySelectorAll('#st-quarter-plan .qp-l')].find((e) => /Light & Logic/.test(e.textContent))?.scrollIntoView({ block: 'center' }) || document.getElementById('st-quarter-plan')?.scrollIntoView());
  await page.waitForTimeout(400);
  await page.screenshot({ path: `outputs/ll-planned-strategy-${PHASE}-${LIVE ? 'live' : 'local'}-1700px-20261110.png` });
}
await browser.close();
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync(`outputs/_llp-${TAG}.json`, JSON.stringify(out, null, 1));

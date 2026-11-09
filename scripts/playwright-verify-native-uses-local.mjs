/**
 * Native Facebook / Instagram uses on the negative-space-woodland content record, LIVE data with LOCAL code, 1700px.
 * Read-only: serves the local lib/marketing-schedule-list.js, answers GET ?action=delivery-status with the local board
 * on a Supabase client whose writes are blocked and logged; every non-GET refused. LIVE=1 = production as is.
 * Screenshot: outputs/nsu-content-record-{local|live}-1700px-20261109.png
 */
import fs from 'node:fs';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
const LIVE = process.env.LIVE === '1';
const W = new Set(['insert', 'upsert', 'update', 'delete']);
const blocked = [];
const refused = [];
const errors = [];
const inert = (l) => { blocked.push(l); const p = new Proxy(() => {}, { get: (_t, k) => (k === 'then' ? (ok) => ok({ data: null, error: null }) : () => p), apply: () => p }); return p; };
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ro = new Proxy(sb, { get: (t, k) => (k === 'from' ? (tb) => new Proxy(t.from(tb), { get: (x, m) => (W.has(m) ? () => inert(`${tb}.${String(m)}`) : (typeof x[m] === 'function' ? x[m].bind(x) : x[m])) }) : (k === 'rpc' ? (n) => inert(`rpc ${n}`) : (typeof t[k] === 'function' ? t[k].bind(t) : t[k]))) });
const { buildStatusBoard } = await import('../lib/marketing/delivery-status-board.mjs');

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); localStorage.setItem('mks-layout', 'list'); }, ENV.ARP_ADMIN_KEY);
await page.route('**/*', async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  if (req.method() !== 'GET') { if (url.pathname.startsWith('/api/')) refused.push(`${req.method()} ${url.pathname}`); return route.fulfill({ status: 403, contentType: 'application/json', body: '{"ok":false}' }); }
  if (!LIVE && url.pathname === '/lib/marketing-schedule-list.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync('lib/marketing-schedule-list.js', 'utf8') });
  if (!LIVE && url.pathname === '/api/aigeo/marketing' && url.searchParams.get('action') === 'delivery-status') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ...(await buildStatusBoard(ro)) }) });
  return route.fallback();
});
await page.goto('https://ai-geo-audit.vercel.app/audit-dashboard.html#marketing', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.mkOpenContent === 'function' && window.mkOpenContent('video|short|negative-space-woodland'), null, { timeout: 55000, polling: 1000 }).catch(() => null);
await page.waitForSelector('#mks-panel .mkl-uses', { timeout: 15000 }).catch(() => null);
await page.waitForTimeout(800);
const rows = await page.evaluate(() => [...document.querySelectorAll('#mks-panel .mkl-uses tr[data-mkl-use]')].map((tr) => ({ use: tr.getAttribute('data-mkl-use'), text: tr.innerText.replace(/\s+/g, ' ').trim(), links: [...tr.querySelectorAll('a')].map((a) => `${a.textContent} → ${a.href.slice(0, 60)}`) })));
await page.screenshot({ path: `outputs/nsu-content-record-${LIVE ? 'live' : 'local'}-1700px-20261109.png` });
await browser.close();
const native = rows.filter((r) => /^(facebook|instagram)\|/.test(r.use));
const dec = native.filter((r) => /2026-12-04/.test(r.use));
const ok = dec.length === 2 && dec.every((r) => /Scheduled on platform/.test(r.text) && !r.links.some((l) => /YouTube/.test(l))) && native.every((r) => !/In preparation/.test(r.text) && !r.links.some((l) => /YouTube/.test(l)));
console.log(JSON.stringify({ pass: ok, rows, refused: refused.length, blocked_writes: [...new Set(blocked)], page_errors: errors.slice(0, 3) }, null, 1));

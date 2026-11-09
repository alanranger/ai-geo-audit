/**
 * QUESTION-2026-11-09 (w): Marketing › Campaign steps (w/c 9 Nov) before / after on LIVE data, 1700px. Read-only:
 * every non-GET refused; PHASE=after serves the local lib/strategy-board.js and answers /api/aigeo/strategy-summary
 * with the local builder on a Supabase client whose writes are blocked and logged. PHASE=before = production as is.
 *   PHASE=before node scripts/playwright-verify-w-campaign-steps-local.mjs
 *   PHASE=after  node scripts/playwright-verify-w-campaign-steps-local.mjs      (LIVE=1: production files + APIs)
 * Screenshots: outputs/w-campaign-steps-{before,after}-{local|live}-1700px-20261109.png (+ "-superseded-shown" after).
 */
import fs from 'node:fs';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
Object.assign(process.env, { SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: ENV.SUPABASE_SERVICE_ROLE_KEY });
const PHASE = process.env.PHASE || 'after';
const LIVE = process.env.LIVE === '1';
const LOCAL = PHASE === 'after' && !LIVE;
const SHOT = (x = '') => `outputs/w-campaign-steps-${PHASE}${x}-${LIVE ? 'live' : 'local'}-1700px-20261109.png`;
const refused = [];
const blocked = [];
const errors = [];
const log = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);

const W = new Set(['insert', 'upsert', 'update', 'delete']);
const inert = (l) => { blocked.push(l); const p = new Proxy(() => {}, { get: (_t, k) => (k === 'then' ? (ok) => ok({ data: null, error: null }) : () => p), apply: () => p }); return p; };
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ro = new Proxy(sb, { get: (t, k) => (k === 'from' ? (tb) => new Proxy(t.from(tb), { get: (x, m) => (W.has(m) ? () => inert(`${tb}.${String(m)}`) : (typeof x[m] === 'function' ? x[m].bind(x) : x[m])) }) : (k === 'rpc' ? (n) => inert(`rpc ${n}`) : (typeof t[k] === 'function' ? t[k].bind(t) : t[k]))) });
let summary = null;
async function localSummary() {
  if (summary) return summary;
  const { buildStrategySummary } = await import('../lib/strategy-summary.mjs');
  summary = JSON.stringify({ ok: true, ...(await buildStrategySummary(ro, 'https://www.alanranger.com', { noBackfill: true, insights: true })) });
  return summary;
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); localStorage.setItem('mks-layout', 'list'); localStorage.setItem('mks-lrange', 'this'); localStorage.setItem('mks-channel', 'all'); }, ENV.ARP_ADMIN_KEY);
await page.route('**/*', async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  if (req.method() !== 'GET') { if (url.pathname.startsWith('/api/')) refused.push(`${req.method()} ${url.pathname}`); return route.fulfill({ status: 403, contentType: 'application/json', body: '{"ok":false,"error":"read-only verification"}' }); }
  if (LOCAL && url.pathname === '/lib/strategy-board.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync('lib/strategy-board.js', 'utf8') });
  if (LOCAL && url.pathname === '/api/aigeo/strategy-summary') return route.fulfill({ status: 200, contentType: 'application/json', body: await localSummary() });
  return route.fallback();
});
await page.goto('https://ai-geo-audit.vercel.app/audit-dashboard.html#marketing', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#mk-campaign-host #st-campaign-table'), null, { timeout: 55000 }).catch(() => null);
await page.waitForFunction(() => !document.querySelector('#mk-planned.mkw-loading') && /Tasks/.test(document.querySelector('#mk-schedule .mks-body')?.textContent || ''), null, { timeout: 40000 }).catch(() => null);
log('loaded');

const read = () => page.evaluate(() => {
  const host = document.getElementById('mk-campaign-host');
  const rows = [...host.querySelectorAll('#st-campaign-table tbody tr.st-row')].map((tr) => {
    const td = tr.querySelectorAll('td');
    return { status: td[0]?.textContent.replace(/\s+/g, ' ').trim(), day: td[1]?.textContent.trim(), channel: td[2]?.textContent.replace(/\s+/g, ' ').trim(), step: td[3]?.querySelector('.st-step')?.textContent.trim(), sub: td[3]?.querySelector('.st-sub')?.textContent.trim(), ticks: tr.querySelectorAll('input[type=checkbox]').length };
  });
  const week = (host.textContent.match(/This week:[^.]*\./) || [''])[0];
  const list = [...document.querySelectorAll('#mk-schedule .mkl-row')].map((r) => r.innerText.replace(/\s+/g, ' '));
  return { rows, week, views: window.stStepViews ? window.stStepViews() : null, list };
});
async function shoot(path) {
  await page.evaluate(() => { for (let d = document.getElementById('mk-campaign-host')?.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true; document.getElementById('mk-campaign-host')?.scrollIntoView({ block: 'start' }); });
  await page.waitForTimeout(600);
  await page.evaluate(() => { const t = document.getElementById('st-campaign-table'); if (t) window.scrollBy(0, t.getBoundingClientRect().top - 140); });
  await page.waitForTimeout(300);
  await page.screenshot({ path });
}
const r = await read();
await shoot(SHOT());
let shown = null;
if (PHASE === 'after') {
  await page.evaluate(() => document.querySelector('#mk-campaign-host [data-st-show-sup]')?.click());
  await page.waitForTimeout(400);
  shown = await read();
  await shoot(SHOT('-superseded-shown'));
}
await browser.close();

const GPT_TITLES = ['What focus bracketing actually helps with', 'Give your photography a direction', 'Norfolk: offer ends Saturday', 'Norfolk coastal workshop'];
const todo = r.rows.filter((x) => /^to do\b/.test(x.status || ''));
const gptRows = r.rows.filter((x) => GPT_TITLES.some((t) => (x.step || '').startsWith(t)));
const out = {
  phase: PHASE, live: LIVE, rows: r.rows.length, to_do: todo.length, to_do_rows: todo.map((x) => `${x.day} ${x.channel} ${x.step}`),
  gpt_rows: gptRows.map((x) => `${x.step} → ${x.status} (ticks ${x.ticks})`), stale_draft_visible: r.rows.filter((x) => /DRAFT — Alan review required/.test(x.sub || '')).length,
  week_line: r.week, views: r.views?.counts || null, rows_with_superseded_shown: shown ? shown.rows.length : null,
  list_week: r.list.filter((t) => /Scheduled|Published|Sent|On hold/.test(t)).map((t) => t.slice(0, 110)),
  refused: refused.length, blocked_writes: [...new Set(blocked)], page_errors: errors.slice(0, 3)
};
console.log(JSON.stringify(out, null, 1));
for (const x of r.rows) console.log(`  ${x.day} | ${x.channel} | ${x.status} | ${x.step} | ticks ${x.ticks}`);
fs.writeFileSync(`outputs/_w-${PHASE}-${LIVE ? 'live' : 'local'}.json`, JSON.stringify({ ...out, all_rows: r.rows, shown_rows: shown?.rows || null }, null, 1));

/**
 * QUESTION-2026-11-10 part 3 (step follows its placement), LIVE data, 1700px. Read-only: every non-GET refused.
 *   PHASE=before  production page + production strategy summary (as is)
 *   PHASE=after   local lib/strategy-board.js + lib/marketing-delivery.js and the local strategy summary built on a
 *                 Supabase client whose writes are blocked and logged          (LIVE=1: production after deploy)
 * Each phase records every step's state (this week + carried) and the step counts to outputs/_stepsync-<phase>.json,
 * so the after run can list exactly what changed. Screenshots: outputs/step-follows-placement-<phase>-*-1700px-20261110.png
 */
import fs from 'node:fs';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
Object.assign(process.env, { SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: ENV.SUPABASE_SERVICE_ROLE_KEY });
const PHASE = process.env.PHASE || 'after';
const LIVE = process.env.LIVE === '1';
const LOCAL = PHASE === 'after' && !LIVE;
const TAG = `${PHASE}-${LIVE ? 'live' : 'local'}`;
const LOCAL_FILES = ['strategy-board.js', 'marketing-delivery.js'];
const refused = [];
const blocked = [];
const errors = [];

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
let seen = null;

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); localStorage.setItem('mks-layout', 'list'); localStorage.setItem('mks-lrange', 'this'); localStorage.setItem('mks-channel', 'all'); }, ENV.ARP_ADMIN_KEY);
await page.route('**/*', async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  if (req.method() !== 'GET') { if (url.pathname.startsWith('/api/')) refused.push(`${req.method()} ${url.pathname}`); return route.fulfill({ status: 403, contentType: 'application/json', body: '{"ok":false}' }); }
  const file = LOCAL && LOCAL_FILES.find((f) => url.pathname === `/lib/${f}`);
  if (file) return route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`lib/${file}`, 'utf8') });
  if (LOCAL && url.pathname === '/api/aigeo/strategy-summary') return route.fulfill({ status: 200, contentType: 'application/json', body: await localSummary() });
  if (url.pathname === '/api/aigeo/strategy-summary' && !seen) { const res = await route.fetch(); seen = await res.text(); return route.fulfill({ response: res, body: seen }); }
  return route.fallback();
});
await page.goto('https://ai-geo-audit.vercel.app/audit-dashboard.html#marketing', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#mk-campaign-host #st-campaign-table'), null, { timeout: 55000 }).catch(() => null);
await page.waitForTimeout(2500);

async function shoot(name, target) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    for (let d = el?.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true;
    el?.scrollIntoView({ block: 'start' });
  }, target);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `outputs/step-follows-placement-${name}-${TAG}-1700px-20261110.png` });
}
await shoot('campaign-steps', '#st-campaign-table');
await page.evaluate(() => [...document.querySelectorAll('#mk-schedule .mkl-row')].find((r) => /What focus bracketing/.test(r.textContent))?.scrollIntoView({ block: 'center' }));
await page.waitForTimeout(400);
await page.screenshot({ path: `outputs/step-follows-placement-list-${TAG}-1700px-20261110.png` });
const ui = await page.evaluate(() => ({
  week: (document.querySelector('#st-week-count')?.textContent || (document.querySelector('#mk-campaign-host')?.textContent.match(/This week:[^.]*\./) || [''])[0]).trim(),
  rows: [...document.querySelectorAll('#st-campaign-table tbody tr.st-row')].map((tr) => `${tr.querySelectorAll('td')[1]?.textContent.trim()} | ${tr.querySelector('.st-step')?.textContent.trim().slice(0, 50)} | ${tr.querySelectorAll('td')[0]?.textContent.replace(/\s+/g, ' ').trim()}`),
  macroList: [...document.querySelectorAll('#mk-schedule .mkl-row')].find((r) => /What focus bracketing/.test(r.textContent))?.innerText.replace(/\s+/g, ' ').slice(0, 160) || ''
}));
await browser.close();

const body = JSON.parse(LOCAL ? summary : seen);
const c = body.campaign || {};
const all = [...(c.carried?.late || []), ...(c.weeks?.[0]?.steps || [])];
const states = Object.fromEntries(all.map((s) => [s.key, { status: s.state?.status, by: s.state?.by || null, evidence: s.state?.evidence || s.state?.reason || null }]));
const counts = { this_week: c.step_status?.this_week, late: c.step_status?.late, late_campaign: c.step_status?.late_campaign, auto_done: c.step_status?.auto_done, carried_late: (c.carried?.late || []).length };
fs.writeFileSync(`outputs/_stepsync-${TAG}.json`, JSON.stringify({ states, counts, ui }, null, 1));
const out = { phase: TAG, counts, week_line: ui.week, macro_list_row: ui.macroList, refused: refused.length, blocked_writes: [...new Set(blocked)], page_errors: errors.slice(0, 3) };
const prevFile = 'outputs/_stepsync-before-local.json';
if (PHASE === 'after' && fs.existsSync(prevFile)) {
  const prev = JSON.parse(fs.readFileSync(prevFile, 'utf8')).states;
  out.changed = Object.keys({ ...prev, ...states }).filter((k) => prev[k]?.status !== states[k]?.status).map((k) => `${k}: ${prev[k]?.status || '—'} → ${states[k]?.status || '—'}${states[k]?.evidence ? ` (${String(states[k].evidence).slice(0, 110)})` : ''}`);
  out.unchanged = Object.keys(states).filter((k) => prev[k]?.status === states[k]?.status).length;
}
console.log(JSON.stringify(out, null, 1));
for (const r of ui.rows) console.log(`  ${r}`);

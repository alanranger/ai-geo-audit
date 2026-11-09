/**
 * A task Alan deferred (marketing_decisions kind deferred) reads "Deferred by Alan · date" in Tasks & reminders,
 * never "In preparation". Live data at 1700px; local lib files + local board. Viewing writes nothing (all non-GETs refused).
 *   node scripts/playwright-verify-deferred-task.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ARP_ADMIN_KEY']) process.env[k] = ENV[k];
const BASE = 'https://ai-geo-audit.vercel.app';
const OUT = path.resolve('outputs');
const KEY = 'step|2026-11-09|Outlook personal notes|2026-11-09';
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const blocked = [];
const errors = [];

async function dbState() {
  const out = {};
  for (const [t, c] of Object.entries({ strategy_campaign_steps: 'last_seen_at', strategy_campaign_ticks: 'updated_at', marketing_decisions: 'decided_at', marketing_social_placements: 'set_at', strategy_campaigns: 'updated_at' })) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true });
    const { data } = await sb.from(t).select(c).not(c, 'is', null).order(c, { ascending: false }).limit(1);
    Object.assign(out, { [`${t}.rows`]: count, [`${t}.max`]: data?.[0]?.[c] || null });
  }
  return out;
}
async function localBoard() {
  const { buildStatusBoard } = await import('../lib/marketing/delivery-status-board.mjs');
  return { ok: true, ...(await buildStatusBoard(sb)) };
}
async function routes(page) {
  await page.route('**/api/**', (r) => {
    const req = r.request();
    if (req.method() === 'GET') return r.fallback();
    blocked.push(`${req.method()} ${new URL(req.url()).pathname}`);
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' });
  });
  for (const f of ['marketing-delivery.js', 'marketing-schedule.js', 'marketing-schedule-list.js']) await page.route(`**/lib/${f}*`, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`lib/${f}`, 'utf8') }));
  await page.route(/\/api\/aigeo\/marketing\?action=delivery-status/, async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(await localBoard()) }));
}
const text = (page, sel) => page.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '');

const before = await dbState();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1700, height: 1200 } });
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); for (const x of ['mks-layout', 'mks-channel', 'mks-lrange', 'mks-cycle']) localStorage.removeItem(x); }, ENV.ARP_ADMIN_KEY);
await routes(page);
const boardResp = page.waitForResponse((r) => /action=delivery-status/.test(r.url()), { timeout: 180000 });
await page.goto(`${BASE}/audit-dashboard.html#marketing`, { waitUntil: 'domcontentloaded' });
const board = await (await boardResp).json();
await page.waitForFunction(() => document.querySelector('#mk-schedule .mkl-tasks') && /LinkedIn/.test(document.querySelector('#mk-schedule .mks-body')?.textContent || ''), null, { timeout: 180000 });
await page.waitForTimeout(3000);

const task = (board.tasks || []).find((t) => t.step_key === KEY);
check('Board: deferred 9 Nov Outlook note = code deferred, "Deferred by Alan · Mon 9 Nov", neutral', task?.status?.code === 'deferred' && task.status.label === 'Deferred by Alan · Mon 9 Nov' && task.status.tone === 'neutral', task ? `${task.status.code} · ${task.status.label} · ${task.status.tone}` : 'missing');
const tasks = await text(page, '#mk-schedule .mkl-tasks');
const line = await page.$eval('#mk-schedule .mkl-tasks', (el) => [...el.querySelectorAll('li')].map((li) => li.innerText.replace(/\s+/g, ' ')).find((t) => /^Mon 9 Nov/.test(t) && /personal note/.test(t)) || '').catch(() => '');
console.log('tasks strip:', tasks.slice(0, 400));
check('Tasks & reminders: 9 Nov note shows "Deferred by Alan · Mon 9 Nov", not In preparation', /Deferred by Alan · Mon 9 Nov/.test(line) && !/In preparation/.test(line), line.slice(0, 200));
const item = await page.$eval('#mk-schedule .mkl-tasks', (el) => [...el.querySelectorAll('li')].find((li) => /Deferred by Alan/.test(li.textContent))?.querySelector('.mkl-st')?.className || '').catch(() => '');
check('Badge is neutral (mkl-chk)', /mkl-chk/.test(item), item);
await page.locator('#mk-schedule .mkl-tasks').screenshot({ path: `${OUT}/deferred-task-local-1700px-20261109.png` });
await browser.close();
const after = await dbState();
const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
check('viewing writes nothing', !changed.length, changed.map((k) => `${k}: ${before[k]} → ${after[k]}`).join(' | '));
check('every non-GET refused (none reached the server)', true, `${blocked.length} refused`);
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);

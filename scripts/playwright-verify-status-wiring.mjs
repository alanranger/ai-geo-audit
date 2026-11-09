/**
 * Schedule views render M's ONE status (board: GET /api/aigeo/marketing?action=delivery-status), the Google Business
 * weekly review is a GPT task, and one real "Refresh status" press. Live data at 1700px.
 *   node scripts/playwright-verify-status-wiring.mjs           local files + local board / extras (before deploy)
 *   LOCAL=0 node scripts/playwright-verify-status-wiring.mjs   deployed
 * Viewing is checked to write nothing; then ONE Refresh press (POST action=status-refresh only: the queue row).
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ARP_ADMIN_KEY']) process.env[k] = ENV[k];
const BASE = 'https://ai-geo-audit.vercel.app';
const LOCAL = process.env.LOCAL !== '0';
const MODE = LOCAL ? 'local' : 'live';
const OUT = path.resolve('outputs');
const BLUR = '#mk-review-table td:first-child, #mk-cust-body, .mk-detail, #mk-cleanup table td.left, #mk-query table td:first-child, #mk-client-health table td:first-child, #mk-exp-review, #mk-snap-review { filter: blur(6px) !important; }';
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const blocked = [];
const allowed = [];
const errors = [];
let allowRefresh = false;

async function dbState() {
  const out = {};
  for (const [t, c] of Object.entries({ strategy_campaign_steps: 'last_seen_at', strategy_campaign_ticks: 'updated_at', strategy_campaigns: 'updated_at', marketing_social_placements: 'set_at', marketing_collector_runs: 'started_at' })) {
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
async function localExtras() {
  const { default: handler } = await import('../api/aigeo/marketing-schedule-extras.js');
  let out = null;
  const res = { status() { return this; }, setHeader() {}, json(j) { out = j; return this; } };
  await handler({ method: 'GET', query: {}, headers: { 'x-arp-admin-key': ENV.ARP_ADMIN_KEY } }, res);
  return out;
}
async function routes(page) {
  await page.route('**/api/**', (r) => {
    const req = r.request();
    if (req.method() === 'GET') return r.fallback();
    const body = req.postData() || '';
    if (allowRefresh && /\/api\/aigeo\/marketing$/.test(new URL(req.url()).pathname) && /"action":"status-refresh"/.test(body)) { allowed.push('POST status-refresh'); return r.fallback(); }
    blocked.push(`${req.method()} ${new URL(req.url()).pathname}`);
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' });
  });
  if (!LOCAL) return;
  for (const f of ['marketing-schedule.js', 'marketing-schedule-list.js']) await page.route(`**/lib/${f}*`, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`lib/${f}`, 'utf8') }));
  await page.route(/\/api\/aigeo\/marketing\?action=delivery-status/, async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(await localBoard()) }));
  await page.route('**/api/aigeo/marketing-schedule-extras*', async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(await localExtras()) }));
}
const text = (page, sel) => page.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
const clickIn = async (page, sel) => { await page.click(`#mk-schedule ${sel}`); await page.waitForTimeout(700); };

const before = await dbState();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1700, height: 1200 } });
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); for (const x of ['mks-layout', 'mks-channel', 'mks-lrange', 'mks-cycle']) localStorage.removeItem(x); }, ENV.ARP_ADMIN_KEY);
await routes(page);
const boardResp = page.waitForResponse((r) => /action=delivery-status/.test(r.url()), { timeout: 180000 });
await page.goto(`${BASE}/audit-dashboard.html#marketing`, { waitUntil: 'domcontentloaded' });
const board = await (await boardResp).json();
await page.waitForFunction(() => document.querySelector('#mk-schedule .mkl') && /LinkedIn/.test(document.querySelector('#mk-schedule .mks-body')?.textContent || '') && /Last checked/.test(document.querySelector('#mk-schedule .mks-refresh')?.textContent || ''), null, { timeout: 180000 });
await page.waitForTimeout(4000);
await page.addStyleTag({ content: BLUR });

const list = await text(page, '#mk-schedule .mkl');
const em = (board.emails || []).filter((e) => e.status?.code !== 'cancelled' && /^2026-11-1[0-5]|^2026-11-09/.test(e.send_at || e.send_day || ''));
const shown = em.filter((e) => list.includes(e.status.label));
check('List: email rows show M\'s status labels', em.length > 0 && shown.length === em.length, em.map((e) => `${e.title.slice(0, 24)}: ${e.status.label}`).join(' | '));
const pls = (board.placements || []).filter((p) => p.step_key === 'gpt-event-2026-11-09-norfolk-li');
check('List: Norfolk LinkedIn 9 Nov = M\'s placement status (Published + link)', pls[0]?.status?.code === 'published' && /Norfolk coastal workshop[^]{0,80}Published/.test(list) && /View post/.test(list), pls.map((p) => p.status.label).join(','));
const lc = await text(page, '#mk-schedule .mks-refresh');
check('Refresh button enabled + "Last checked … (Europe/London)" from M\'s board', /Refresh status/.test(lc) && /Last checked .* \(Europe\/London\)/.test(lc) && !(await page.$('#mk-schedule [data-mks-refresh][disabled]')), lc.slice(0, 160));
await page.locator('#mk-schedule').screenshot({ path: `${OUT}/status-wiring-list-${MODE}-1700px-20261109.png` });

const tasks = await text(page, '#mk-schedule .mkl-tasks');
check('Google Business: "Weekly Google Business review · owner GPT" in Tasks & reminders only, task status, no Scheduled / Published', /Weekly Google Business review · owner GPT/.test(tasks) && !/Google Business check/.test(list) && /(Due|In progress|Checked|Needs attention)/.test(tasks) && !/Weekly Google Business review[^·]*·[^·]*·[^·]*·\s*(Scheduled|Published)/.test(tasks), tasks.slice(0, 260));
await page.locator('#mk-schedule .mkl-tasks li', { hasText: 'Weekly Google Business review' }).first().click();
await page.waitForSelector('#mks-panel:not([hidden]) .mks-pitem', { timeout: 10000 });
const gp = await text(page, '#mks-panel');
check('GBP panel: owner GPT, next action, last automatic collection + last GPT review shown apart, weekly history, no publication / approve / Done controls', /Owner GPT/.test(gp) && /Next action Review latest posts and reviews/.test(gp) && /Last automatic collection/.test(gp) && /Last GPT review/.test(gp) && /Weekly history/.test(gp) && !(await page.$('#mks-panel .st-step-done, #mks-panel [data-mks-render], #mks-panel .st-skip-save')), gp.slice(0, 300));
await page.screenshot({ path: `${OUT}/status-wiring-gbp-task-${MODE}-1700px-20261109.png` });
await page.click('#mks-panel [data-mks-close]');

await clickIn(page, '[data-mks-view="days"]');
const cards = await page.$$eval('#mk-schedule .mks-body .mks-card[data-mks-item^="email|"]', (els) => els.map((e) => [e.dataset.mksItem, e.querySelector('.mkl-st')?.textContent || '']));
const mism = cards.filter(([id, t]) => { const e = (board.emails || []).find((x) => `email|${x.key}` === id); return e && !t.includes(e.status.label); });
check('Grid by days: email cards carry the same status words as M\'s board', cards.length > 0 && !mism.length, `${cards.length} email cards; mismatches ${mism.map((x) => x.join(':')).join(', ') || 'none'}`);
await page.locator('#mk-schedule').screenshot({ path: `${OUT}/status-wiring-grid-days-${MODE}-1700px-20261109.png` });
await clickIn(page, '[data-mks-view="list"]');
await clickIn(page, '[data-mks-channel="email"]');
const ev = await text(page, '#mk-schedule .mkl-email');
const evMatch = (board.emails || []).filter((e) => ev.includes(e.title)).every((e) => ev.includes(e.status.label));
check('Email view: send rows show M\'s status', evMatch, ev.slice(0, 200));
await page.locator('#mk-schedule').screenshot({ path: `${OUT}/status-wiring-email-${MODE}-1700px-20261109.png` });
await clickIn(page, '[data-mks-channel="all"]');

const mid = await dbState();
const changed = Object.keys(before).filter((k) => before[k] !== mid[k]);
check('viewing writes nothing (before the Refresh press)', !changed.length, changed.map((k) => `${k}: ${before[k]} → ${mid[k]}`).join(' | '));

allowRefresh = true;
const lcBefore = await text(page, '#mk-schedule .mks-refresh');
await page.click('#mk-schedule [data-mks-refresh]');
await page.waitForTimeout(1500);
const disabled = !!(await page.$('#mk-schedule [data-mks-refresh][disabled]'));
await page.waitForFunction(() => /Done\.|Still waiting|Refresh failed/.test(document.querySelector('#mk-modal')?.textContent || ''), null, { timeout: 780000 }).catch(() => null);
const modal = await text(page, '#mk-modal');
await page.screenshot({ path: `${OUT}/status-wiring-refresh-${MODE}-1700px-20261109.png` });
await page.waitForTimeout(2000);
const lcAfter = await text(page, '#mk-schedule .mks-refresh');
check('Refresh press: disabled while running, a real check ran, nothing sent / published', disabled && /Nothing was sent, retried or published|Still waiting|Refresh failed/.test(modal), `modal: ${modal.slice(0, 260)}`);
check('Refresh: "Last checked" re-rendered after mk-status-refreshed', /Last checked/.test(lcAfter), `${lcBefore.slice(0, 80)} → ${lcAfter.slice(0, 80)}`);
await browser.close();
const after = await dbState();
const changed2 = Object.keys(mid).filter((k) => mid[k] !== after[k]);
check('Refresh wrote only the queue row (marketing_collector_runs) — no ticks / campaigns / placements / steps changed', changed2.every((k) => k.startsWith('marketing_collector_runs')), changed2.map((k) => `${k}: ${mid[k]} → ${after[k]}`).join(' | ') || 'no change');
check('non-GETs: only the one status-refresh POST allowed', allowed.length === 1, `${allowed.join(', ')} · ${blocked.length} refused`);
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);

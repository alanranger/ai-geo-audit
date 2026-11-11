/**
 * Survival Cockpit refresh after "Upload Booking Sheet" — LIVE data, LOCAL code, 1700px. Read-only: every non-GET is
 * refused (the upload POST answers {"ok":true,"dry_run":true}), so no Booking Sheet is imported and nothing is written.
 * Notes the cockpit MTD, marks the cockpit as stale, clicks Upload (simulated file), then checks the cockpit re-rendered
 * from the fresh revenue-funnel-summary response, the result window lists the refreshed sections, and no other section
 * changed. DB row counts + newest timestamps compared before / after.
 *   node scripts/playwright-verify-cockpit-refresh-local.mjs     (LIVE=1 = deployed code, shows the pre-fix behaviour)
 */
import fs from 'node:fs';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
const LIVE = process.env.LIVE === '1';
const BASE = 'https://ai-geo-audit.vercel.app';
const TAG = LIVE ? 'live-deployed' : 'local';
const OUT = 'outputs';
const STAMP = '20261111';
const LOCAL_LIB = ['revenue-truth-controller.mjs', 'booking-upload-refresh.mjs'];
const TABLES = { booking_sheet_transactions: 'imported_at', booking_sheet_monthly_category: 'imported_at', booking_sheet_sheet_presence: 'seen_at', revenue_truth_payload_cache: 'computed_at', strategy_event_snapshots: 'created_at', revenue_snapshots: 'created_at' };
const SECTIONS = {
  'Where we are now': '#rt-position-body', 'What the numbers say': '#rt-exec-body', 'Category breakdown': '#rt-category .rt-table-scroll',
  'Market split': '#rt-market .rt-table-scroll', 'Channel mix': '#rt-channel-section .rt-table-scroll', 'New vs existing': '#rt-clients-section .rt-table-scroll',
  'Funding & fees': '#rt-funding-section .rt-table-scroll', 'Product breakdown': '#rt-product-breakdown .rt-table-scroll', 'Page breakdown': '#rt-page-breakdown .rt-table-scroll',
  'Revenue snapshot': '#rf-rev-latest', 'Revenue by source': '#rf-source-mix-table', '§9 status': '#rt-diag-status', 'Survival Cockpit': '#rf-survival-table'
};
const COCKPIT_TIERS = ['academy', 'courses', 'workshops_nonres', 'workshops_residential', 'services', 'hire'];
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const blocked = [];
const errors = [];
const apiLog = [];

async function dbState() {
  const out = {};
  for (const [t, c] of Object.entries(TABLES)) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true });
    const { data, error } = await sb.from(t).select(c).not(c, 'is', null).order(c, { ascending: false }).limit(1);
    Object.assign(out, { [`${t}.rows`]: count, [`${t}.max(${c})`]: error ? 'n/a' : data?.[0]?.[c] || null });
  }
  return out;
}

async function routes(page) {
  await page.addInitScript((k) => sessionStorage.setItem('arp_admin_key', k), ENV.ARP_ADMIN_KEY);
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() !== 'GET') { if (url.pathname.startsWith('/api/')) blocked.push(`${req.method()} ${url.pathname}`); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' }); }
    if (LIVE) return route.fallback();
    const file = LOCAL_LIB.find((f) => url.pathname === `/lib/${f}`);
    if (file) return route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`lib/${file}`, 'utf8') });
    if (url.pathname === '/audit-dashboard.html') {
      const res = await route.fetch();
      return route.fulfill({ response: res, body: fs.readFileSync('audit-dashboard.html', 'utf8'), headers: { ...res.headers(), 'content-type': 'text/html; charset=utf-8' } });
    }
    return route.fallback();
  });
  page.on('response', async (res) => {
    const u = new URL(res.url());
    if (!u.pathname.startsWith('/api/aigeo/')) return;
    const entry = { t: Date.now(), path: u.pathname, method: res.request().method(), status: res.status(), cc: res.headers()['cache-control'] || '' };
    if (u.pathname === '/api/aigeo/revenue-funnel-summary') entry.body = await res.json().catch(() => null);
    apiLog.push(entry);
  });
}

const sectionTexts = (page) => page.evaluate((map) => Object.fromEntries(Object.entries(map).map(([k, sel]) => [k, (document.querySelector(sel)?.textContent || '').replace(/\s+/g, ' ').replace(/Last updated: [\d-]+ [\d:]+ UTC/, 'Last updated: <render time>').trim()])), SECTIONS);
const cockpitMtd = (page) => page.evaluate(() => (document.querySelector('#rf-survival-tfoot td:nth-child(2)')?.textContent || '').trim());
const num = (t) => Number(String(t || '').replace(/[^\d.-]/g, ''));

async function run(browser) {
  const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await routes(page);
  await page.goto(`${BASE}/audit-dashboard.html#revenue-truth`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#rf-survival-tfoot td') && document.querySelector('#rt-category table') && (document.getElementById('rt-diag-status')?.textContent || '').trim(), null, { timeout: 240000 });
  await page.waitForTimeout(5000);
  const mtdBefore = await cockpitMtd(page);
  const before = await sectionTexts(page);
  await page.locator('#rt-tiers-cockpit').screenshot({ path: `${OUT}/cockpit-refresh-before-${TAG}-1700px-${STAMP}.png` });
  await page.evaluate(() => {
    const cell = document.querySelector('#rf-survival-tfoot td:nth-child(2)');
    cell.textContent = '£250';
    document.querySelectorAll('#rf-survival-tbody tr').forEach((tr) => tr.setAttribute('data-stale-marker', '1'));
  });
  await page.locator('#rt-tiers-cockpit').screenshot({ path: `${OUT}/cockpit-refresh-stale-marked-${TAG}-1700px-${STAMP}.png` });
  const t0 = Date.now();
  const chooser = page.waitForEvent('filechooser', { timeout: 20000 });
  await page.click('#rt-upload-booking-btn');
  await (await chooser).setFiles({ name: 'Booking Sheet 2026 (simulated, POST refused).xlsm', mimeType: 'application/octet-stream', buffer: Buffer.from('simulated upload - never sent to the server') });
  await page.waitForFunction(() => /is-(success|error)/.test(document.getElementById('rt-upload-progress')?.className || ''), null, { timeout: 240000 });
  await page.waitForTimeout(LIVE ? 15000 : 3000);
  const mtdAfter = await cockpitMtd(page);
  const after = await sectionTexts(page);
  const stale = await page.evaluate(() => document.querySelectorAll('#rf-survival-tbody tr[data-stale-marker]').length);
  const win = await page.evaluate(() => ({ cls: document.getElementById('rt-upload-progress').className, step: document.getElementById('rt-upload-progress-step').textContent.trim(), log: [...document.querySelectorAll('#rt-upload-progress-log div')].map((d) => d.textContent.trim()) }));
  await page.locator('#rt-upload-progress').screenshot({ path: `${OUT}/cockpit-refresh-result-window-${TAG}-1700px-${STAMP}.png` });
  await page.locator('#rt-tiers-cockpit').screenshot({ path: `${OUT}/cockpit-refresh-after-${TAG}-1700px-${STAMP}.png` });
  const url = await page.url();
  await page.close();
  return { mtdBefore, mtdAfter, before, after, stale, win, t0, url };
}

const dbBefore = await dbState();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const r = await run(browser);
await browser.close();
const dbAfter = await dbState();

const post = apiLog.filter((e) => e.t >= r.t0);
const funnel = post.filter((e) => e.path === '/api/aigeo/revenue-funnel-summary' && e.method === 'GET');
const fresh = funnel.at(-1)?.body;
const apiMtd = (fresh?.tier_history || []).filter((s) => COCKPIT_TIERS.includes(s.tier_id)).reduce((a, s) => a + (Number(s.current_month?.revenue_gbp) || 0), 0);
check('cockpit MTD noted on load', r.mtdBefore, `MTD on load ${r.mtdBefore}`);
check('upload click re-fetched revenue-funnel-summary (fresh GET, no-store, 200)', funnel.length >= 1 && funnel.every((e) => e.status === 200 && /no-store/.test(e.cc)), `${funnel.length} GET(s) after the click: ${funnel.map((e) => `${e.status} cache-control "${e.cc}"`).join(', ') || 'none'}`);
check('cockpit re-rendered without reload: stale marker gone, MTD = fresh API figure', r.stale === 0 && r.mtdAfter !== '£250' && Math.round(num(r.mtdAfter)) === Math.round(apiMtd), `after ${r.mtdAfter} · fresh API sum £${apiMtd.toFixed(2)} · stale rows left ${r.stale}`);
check('the other booking-sheet reads were re-fetched too', ['revenue-truth-summary', 'revenue-truth-findings', 'revenue-funnel-diagnosis', 'revenue-sync-status'].every((p) => post.some((e) => e.path === `/api/aigeo/${p}`)), [...new Set(post.map((e) => e.path.replace('/api/aigeo/', '')))].join(', '));
check('result window lists the refreshed sections (Survival Cockpit among them)', /is-success/.test(r.win.cls) && r.win.log.some((l) => /Refreshed: Survival Cockpit/.test(l)) && r.win.log.some((l) => /Refreshed: Where we are now/.test(l)), `${r.win.step} | ${r.win.log.join(' | ')}`);
const changed = Object.keys(SECTIONS).filter((k) => r.before[k] !== r.after[k]);
check('API calls after the click', true, [...new Set(post.map((e) => `${e.method} ${e.path.replace('/api/aigeo/', '')}`))].join(', '));
check('nothing else changed (13 sections, text before vs after, "Last updated" render time masked; data unchanged so every section must match)', !changed.length, changed.map((k) => `${k}: "${r.before[k].slice(0, 80)}" → "${r.after[k].slice(0, 80)}"`).join(' | ') || 'all identical');
check('no page reload (same URL, same document)', r.url.endsWith('#revenue-truth'), r.url);
const dbChanged = Object.keys(dbBefore).filter((k) => dbBefore[k] !== dbAfter[k]);
check(`writes nothing (row counts + newest timestamps, ${Object.keys(TABLES).length} tables)`, !dbChanged.length, dbChanged.map((k) => `${k}: ${dbBefore[k]} → ${dbAfter[k]}`).join(' | ') || 'no change');
check('every non-GET refused (upload POST never reached the server)', blocked.includes('POST /api/aigeo/booking-sheet-upload'), `${blocked.length} refused: ${[...new Set(blocked)].join(', ')}`);
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
fs.writeFileSync(`${OUT}/_cockpit-refresh-${TAG}-result.json`, JSON.stringify({ results, mtd_before: r.mtdBefore, mtd_after: r.mtdAfter, fresh_api_mtd: apiMtd, window: r.win, db_before: dbBefore, db_after: dbAfter }, null, 1));
for (const x of results) console.log(`${x.ok ? 'PASS' : 'FAIL'}  ${x.name}${x.note ? ` (${x.note})` : ''}`);

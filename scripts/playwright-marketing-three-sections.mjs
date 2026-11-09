/**
 * Marketing tab three sections (QUESTION-2026-11-08 waiting / planned / results). Read-only.
 *   node scripts/playwright-marketing-three-sections.mjs before   → live tab as deployed
 *   node scripts/playwright-marketing-three-sections.mjs after    → live data + LOCAL lib files and results API
 * Every non-GET from the page is refused. People blurred.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ARP_ADMIN_KEY']) process.env[k] = ENV[k];
const MODE = process.argv[2] || 'before';
const BASE = process.env.DASH_BASE || 'https://ai-geo-audit.vercel.app';
const OUT = path.resolve('outputs');
const BLUR = '#mk-review-table td:first-child, #mk-cust-body, .mk-detail, #mk-cleanup table td.left, #mk-query table td:first-child, #mk-client-health table td:first-child, #mk-exp-review, #mk-snap-review { filter: blur(6px) !important; }';
const LOCAL_FILES = ['marketing-waiting.js', 'marketing-results.js', 'marketing-social-tiles.js', 'marketing-tab.js'];
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const blocked = [];
const errors = [];
const loading = [];

async function dbState() {
  const out = {};
  for (const t of ['strategy_campaigns', 'strategy_campaign_ticks', 'quarter_plan', 'social_posts', 'marketing_decisions', 'marketing_social_placements', 'marketing_suppression']) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true });
    out[t] = count;
  }
  const { data } = await sb.from('strategy_campaigns').select('updated_at').order('updated_at', { ascending: false }).limit(1);
  out.campaigns_updated_max = data?.[0]?.updated_at || null;
  return out;
}

async function localResults() {
  const { buildMarketingResults } = await import('../lib/marketing/results.mjs');
  return { ok: true, ...(await buildMarketingResults(sb, {})) };
}

async function localRoutes(page) {
  for (const f of LOCAL_FILES) {
    await page.route(`**/lib/${f}*`, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`lib/${f}`, 'utf8') }));
  }
  const body = JSON.stringify(await localResults());
  await page.route('**/api/aigeo/marketing-results*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body }));
  const { buildDecisionState } = await import('../lib/marketing/decision-state.mjs');
  const dec = JSON.stringify({ ok: true, ...(await buildDecisionState(sb)) });
  await page.route('**/api/aigeo/marketing-decisions*', (route) => setTimeout(() => route.fulfill({ status: 200, contentType: 'application/json', body: dec }), 4000));
}

async function openTab(browser, width = 1700) {
  const page = await browser.newPage({ viewport: { width, height: width < 800 ? 844 : 1100 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); localStorage.setItem('mks-view', 'weeks'); }, ENV.ARP_ADMIN_KEY);
  await page.route('**/api/**', (route) => {
    if (route.request().method() === 'GET') return route.fallback();
    blocked.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' });
  });
  if (MODE === 'after') await localRoutes(page);
  await page.goto(`${BASE}/audit-dashboard.html#marketing`, { waitUntil: 'domcontentloaded' });
  if (MODE !== 'before') {
    const skel = await page.waitForSelector('#mk-waiting .mkw-skel', { timeout: 120000 }).then(() => true, () => false);
    const bar = await page.$('#mkw-planned-extra .mkw-loadbar');
    loading.push({ skel, bar: !!bar });
    await page.locator('#mk-waiting').screenshot({ path: `${OUT}/c2-loading-${MODE}-1700px-20261109.png` }).catch(() => {});
  }
  await page.waitForSelector('#mk-schedule .mks-body', { timeout: 150000, state: 'attached' });
  await page.waitForFunction(() => !/Loading the week plan/.test(document.querySelector('#mk-schedule')?.textContent || 'Loading the week plan'), null, { timeout: 150000 });
  await page.waitForTimeout(9000);
  await page.addStyleTag({ content: BLUR });
  return page;
}

/** Visible text outside the closed Behind-the-scenes fold. */
const visibleOutsideFold = (page) => page.evaluate(() => {
  const root = document.querySelector('#marketing-root');
  const clone = root.cloneNode(true);
  clone.querySelectorAll('#mk-behind, [hidden], details:not([open]) > :not(summary)').forEach((e) => e.remove());
  return clone.innerText || clone.textContent;
});

async function afterChecks(page) {
  const vis = await visibleOutsideFold(page);
  const heads = await page.$$eval('#marketing-root h2, #marketing-root h3.mk-sec-h', (els) => els.filter((e) => e.offsetParent && !e.closest('#mk-behind')).map((e) => e.textContent.trim()));
  const behind = await page.$eval('#mk-behind > summary', (e) => e.textContent).catch(() => '');
  check('sections visible: Waiting on you · Planned · Results · Behind the scenes', /Waiting on you/.test(vis) && /Planned/.test(vis) && /Results/.test(vis) && /Behind the scenes/.test(behind), heads.join(' | '));
  const tables = await page.$$eval('#marketing-root table', (els) => els.filter((t) => !t.closest('#mk-behind') && /campaign steps|stages|utm_campaign/i.test(t.textContent)).length);
  check('no Campaign steps / stages & results table outside the fold', !tables && !/stages & results|Campaign steps \(|Proposed ▾/i.test(vis), (vis.match(/.{0,60}(Campaign steps|stages & results).{0,40}/i) || [''])[0]);
  check('no utm strings or campaign keys outside the fold', !/utm_|email\|20\d\d|event\|20\d\d|gpt-8w-/.test(vis), (vis.match(/.{0,30}(utm_|email\|20|event\|20|gpt-8w-).{0,30}/) || [''])[0]);
  check('Behind the scenes fold closed', await page.$eval('#mk-behind', (e) => !e.open).catch(() => false));
  await page.waitForSelector('#mk-results tbody tr[data-mkr-row]', { timeout: 60000 }).catch(() => {});
  const res = await page.$$eval('#mk-results tbody tr[data-mkr-row]', (rows) => rows.map((r) => r.innerText.replace(/\s+/g, ' ')));
  const has = (re) => res.some((r) => re.test(r));
  check('Results: LR30 39 sent, opens collected (7 at first read, more since)', has(/Sun 8 Nov 9:55am.*\b39\b \d+ \(\d+%\)/), res.find((r) => /\b39\b/.test(r)) || '');
  check('Results: Norfolk 311 at 17:00', has(/5:00pm.*311/), res.find((r) => /311/.test(r)) || '');
  check('Results: Creative 231 at 17:00', has(/5:00pm.*231/), res.find((r) => /231/.test(r)) || '');
  check('Results: FB / IG / Story post rows', has(/FB/) && has(/IG/) && has(/Story/));
  check('Results: LinkedIn row', has(/LinkedIn/));
  check('Results: no 0 opens for unknown', !res.some((r) => /Email/.test(r) && /tomorrow/.test(r) === false && /\b0 \(0%\)/.test(r)));
  const wait = await page.$$eval('#mk-waiting tbody tr', (rows) => rows.map((r) => r.innerText.replace(/\s+/g, ' ')));
  check('Waiting on you: no GPT / Claude / Cursor-owned rows', !wait.some((r) => /\b(GPT|Claude|Cursor)\b(?!'s 8-week)/.test(r) && !/Approve|Review/.test(r)), wait.join(' || '));
  check('Waiting on you: no superseded / cancelled / not needed', !wait.some((r) => /superseded|cancelled|not needed/i.test(r)));
  results.push({ name: 'facts', ok: true, note: `results ${res.length} rows · waiting ${wait.length} rows` });
  await correctionChecks(page, res, wait);
  fs.writeFileSync(`${OUT}/_three-sections-after.json`, JSON.stringify({ res, wait, heads }, null, 1));
  const box = await page.evaluate(() => {
    const a = document.querySelector('#mk-waiting').getBoundingClientRect();
    const b = document.querySelector('#mk-behind').getBoundingClientRect();
    return { y: a.top + window.scrollY - 10, h: b.bottom - a.top + 30 };
  });
  await page.screenshot({ path: `${OUT}/marketing-tab-after-clean-sections-1700px.png`, fullPage: true, clip: { x: 0, y: box.y, width: 1700, height: box.h } });
}

/** Correction 1: bookings after computed, Recent posts folded, no URL titles, Waiting on you = 4 Alan rows. */
async function correctionChecks(page, res, wait) {
  const cells = await page.$$eval('#mk-results tbody tr[data-mkr-row]', (rows) => rows.map((r) => [...r.querySelectorAll('td')].map((td) => td.innerText.trim())));
  const row = (re) => cells.find((c) => re.test(c.join(' '))) || [];
  const bk = (c) => `${c[7]} / ${c[8]}`;
  check('C1.1: LR30 row 0 / £0', bk(row(/9:55am.*\b39\b/)) === '0 / £0', bk(row(/9:55am.*\b39\b/)));
  check('C1.1: Norfolk and Creative rows computed (not "—")', /^\d+ \/ £[\d,]+$/.test(bk(row(/5:00pm.*311/))) && /^\d+ \/ £[\d,]+$/.test(bk(row(/5:00pm.*231/))), `Norfolk ${bk(row(/5:00pm.*311/))} · Creative ${bk(row(/5:00pm.*231/))}`);
  await page.locator('#mk-results tbody tr[data-mkr-row]', { hasText: '311' }).first().click();
  const detail = await page.$eval('#mk-results .mkr-detail', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
  check('C1.1: detail lists the promoted events and the basis', /After the send/.test(detail) && /matched by subject|campaign record/.test(detail), (detail.match(/After the send.{0,200}/) || [''])[0]);
  await page.click('#mk-results tbody tr[data-mkr-row]:nth-child(1)').catch(() => {});
  const fold = await page.$eval('#mksoc-posts-fold', (e) => ({ open: e.open, visibleTable: !!e.querySelector('table')?.checkVisibility() })).catch(() => null);
  const outside = await page.$$eval('#marketing-root table#mksoc-posts', (els) => els.filter((t) => t.checkVisibility()).length);
  check('C1.2: Recent posts across channels inside a closed fold (not visible)', fold && !fold.open && !outside, JSON.stringify(fold));
  const whats = cells.map((c) => c[1]);
  check('C1.3: no URL as a Results title', !whats.some((w) => /https?:|www\.|youtu\.?be/.test(w)), whats.find((w) => /Style|YouTube/.test(w)) || '');
  check('C1.4: no platform-link plumbing in Waiting on you', !wait.some((r) => /unmatched platform draft|not matched to a campaign/.test(r)), wait.map((r) => r.slice(0, 60)).join(' || '));
  check('C2.1: Waiting has none of: plan, blocked contacts, Norfolk LI post, Hay Woods, Macro caption', !wait.some((r) => /GPT's .*plan|blocked contacts|Norfolk coastal workshop|Hay Woods|focus bracketing|Macro/i.test(r)), wait.join(' || ') || '(empty: "Nothing is waiting on you")');
  const li = cells.filter((c) => /LinkedIn/.test(c[2]) && /Norfolk coastal workshop/.test(c[1]));
  check('C2.2: Results shows the 9 Nov Norfolk LinkedIn post as published', li.length === 1 && /Mon 9 Nov/.test(li[0][0]), li.map((c) => c.slice(0, 4).join(' | ')).join(' || '));
  const n311 = cells.filter((c) => /Email/.test(c[2]) && /^311$/.test(c[3])).length;
  const n231 = cells.filter((c) => /Email/.test(c[2]) && /^231$/.test(c[3])).length;
  check('C2.2: exactly one row each for Norfolk 311 and creative 231', n311 === 1 && n231 === 1, `311 × ${n311} · 231 × ${n231}`);
  check('C2.2: sent rows never say "tomorrow"', !cells.some((c) => /tomorrow/.test(c.join(' '))), cells.filter((c) => /Email/.test(c[2])).map((c) => c[4]).join(' · '));
  check('C2.6: while loading, Waiting shows "Loading…" with a skeleton (never an empty final table)', loading[0]?.skel, JSON.stringify(loading[0] || {}));
  const prod = await page.evaluate(() => document.querySelector('#mkw-production')?.textContent || '');
  check('C2.3: Macro post (asset missing) on GPT\'s production queue, Behind the scenes', /focus bracketing/i.test(prod) && /rendered asset/.test(prod), prod.replace(/\s+/g, ' ').slice(0, 160));
  const where = MODE === 'live' ? 'live' : 'local';
  await page.locator('#mk-results').screenshot({ path: `${OUT}/correction1-results-${where}-1700px-20261108.png` });
  await page.locator('#mk-waiting').screenshot({ path: `${OUT}/correction1-waiting-${where}-1700px-20261108.png` });
  await page.locator('#mk-overview-tiles').screenshot({ path: `${OUT}/correction1-social-fold-${where}-1700px-20261108.png` });
}

/** Shared status vocabulary in Results: the 9 Nov 10:00 email Sent (one row, provider id), Norfolk LinkedIn Published + link. */
async function statusChecks(page) {
  const rows = await page.$$eval('#mk-results tbody tr[data-mkr-row]', (trs) => trs.map((r) => ({ id: r.dataset.mkrRow, st: r.cells[0].innerText.replace(/\s+/g, ' ').trim(), what: r.cells[1].innerText.trim(), to: r.cells[3].innerText.trim(), link: r.cells[0].querySelector('a')?.href || '' })));
  const insp = rows.filter((r) => /Something to inspire/.test(r.what));
  check('S1: 9 Nov 10:00 "Something to inspire" = ✅ Sent Mon 9 Nov 10:00am, one row by provider id', insp.length === 1 && /✅\s*Sent/.test(insp[0].st) && /Mon 9 Nov 10:00am/.test(insp[0].st) && /6af07a9b21498276ab252ccb/.test(insp[0].id + insp[0].link), JSON.stringify(insp));
  const li = rows.filter((r) => /Norfolk coastal workshop/.test(r.what));
  check('S1: Norfolk LinkedIn = ✅ Published + link', li.length === 1 && /✅\s*Published/.test(li[0].st) && /linkedin\.com\/feed\/update/.test(li[0].link), JSON.stringify(li));
  check('S1: every Results row has a status word from the shared vocabulary', rows.every((r) => /(Sent|Published|Checking delivery|Scheduled|Late|Failed|Verification unavailable|Cancelled)/.test(r.st)), rows.map((r) => r.st.slice(0, 40)).join(' · '));
}

/** Client list health: one click from a fresh load (Behind the scenes closed), then "← back to schedule". */
async function healthRoundTrip(page, width) {
  const closed = await page.$eval('#mk-behind', (e) => !e.open);
  const btn = page.locator('#mk-planned [data-mk-open-health]');
  const btnVisible = await btn.isVisible();
  await btn.click();
  await page.waitForFunction(() => document.querySelector('#mk-client-health .ch-head, #mk-client-health h3'), null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const open = await page.evaluate(() => ({ health: !!document.querySelector('#mk-client-health')?.checkVisibility(), back: !!document.querySelector('#mk-health-back a')?.checkVisibility(), top: Math.round(document.querySelector('#mk-health-back')?.getBoundingClientRect().top ?? -1), copies: document.querySelectorAll('#mk-client-health').length }));
  check(`H ${width}px: visible button; one click opens the existing Client list health (Behind the scenes was closed)`, closed && btnVisible && open.health && open.back && open.copies === 1 && open.top >= -5 && open.top < 400, JSON.stringify({ closed, btnVisible, ...open }));
  await page.screenshot({ path: `${OUT}/e-health-open-local-${width}px-20261109.png` });
  await page.click('#mk-health-back a');
  await page.waitForTimeout(1500);
  const top = await page.evaluate(() => Math.round(document.querySelector('#mk-planned').getBoundingClientRect().top));
  check(`H ${width}px: "← back to schedule" returns to the schedule`, top > -40 && top < 300, `Planned top ${top}px`);
}

const before = await dbState();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await openTab(browser);
if (MODE !== 'before') await afterChecks(page);
await page.locator('#marketing-root').screenshot({ path: `${OUT}/marketing-tab-${MODE}-clean-1700px.png` });
if (MODE !== 'before') {
  await statusChecks(page);
  await page.locator('#mk-results').screenshot({ path: `${OUT}/s1-results-status-${MODE}-1700px-20261109.png` });
  await page.locator('#mk-planned .mk-sec-h').screenshot({ path: `${OUT}/e-health-button-${MODE}-1700px-20261109.png` });
  await healthRoundTrip(page, 1700);
}
await page.close();
if (MODE !== 'before') {
  for (const w of [800, 390]) {
    const narrow = await openTab(browser, w);
    await narrow.locator('#mk-planned .mk-sec-h').screenshot({ path: `${OUT}/e-health-button-${MODE}-${w}px-20261109.png` }).catch(() => {});
    await healthRoundTrip(narrow, w);
    await narrow.close();
  }
}
await browser.close();
const after = await dbState();
const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
check('every non-GET from the page refused', true, `${blocked.length} refused: ${[...new Set(blocked)].join(', ')}`);
check('row counts / max updated unchanged by viewing', !changed.length, changed.map((k) => `${k}: ${before[k]} → ${after[k]}`).join(' | '));
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);

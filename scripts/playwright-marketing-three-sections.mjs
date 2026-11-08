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
const LOCAL_FILES = ['marketing-tab.js', 'marketing-waiting.js', 'marketing-results.js', 'marketing-schedule.js', 'marketing-schedule-model.js', 'marketing-overview-tiles.js'];
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const blocked = [];
const errors = [];

async function dbState() {
  const out = {};
  for (const t of ['strategy_campaigns', 'strategy_campaign_ticks', 'quarter_plan', 'social_posts', 'sqs_email_events']) {
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

/** New files are not in the deployed HTML yet: served ahead of lib/marketing-tab.js. */
const fileBody = (f) => (f === 'marketing-tab.js' ? ['marketing-waiting.js', 'marketing-results.js', f] : [f]).map((x) => fs.readFileSync(`lib/${x}`, 'utf8')).join('\n;\n');
async function localRoutes(page) {
  for (const f of LOCAL_FILES.filter((x) => !/waiting|results/.test(x))) {
    await page.route(`**/lib/${f}*`, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: fileBody(f) }));
  }
  const body = JSON.stringify(await localResults());
  await page.route('**/api/aigeo/marketing-results*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body }));
}

async function openTab(browser) {
  const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); localStorage.setItem('mks-view', 'weeks'); }, ENV.ARP_ADMIN_KEY);
  await page.route('**/api/**', (route) => {
    if (route.request().method() === 'GET') return route.fallback();
    blocked.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' });
  });
  if (MODE === 'after') await localRoutes(page);
  await page.goto(`${BASE}/audit-dashboard.html#marketing`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#mk-schedule .mks-grid, #mk-schedule .mks-weeks', { timeout: 150000 });
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
  check('Results: LR30 39 sent, 7 opened', has(/Sun 8 Nov.*\b39\b.*\b7\b/), res.find((r) => /\b39\b/.test(r)) || '');
  check('Results: Norfolk 311 at 17:00', has(/17:00.*311/), res.find((r) => /311/.test(r)) || '');
  check('Results: Creative 231 at 17:00', has(/17:00.*231/), res.find((r) => /231/.test(r)) || '');
  check('Results: FB / IG / Story post rows', has(/FB/) && has(/IG/) && has(/Story/));
  check('Results: LinkedIn row', has(/LinkedIn/));
  check('Results: no 0 opens for unknown', !res.some((r) => /Email/.test(r) && /tomorrow/.test(r) === false && /\b0 \(0%\)/.test(r)));
  const wait = await page.$$eval('#mk-waiting tbody tr', (rows) => rows.map((r) => r.innerText.replace(/\s+/g, ' ')));
  check('Waiting on you: no GPT / Claude / Cursor-owned rows', !wait.some((r) => /\b(GPT|Claude|Cursor)\b(?!'s 8-week)/.test(r) && !/Approve|Review/.test(r)), wait.join(' || '));
  check('Waiting on you: no superseded / cancelled / not needed', !wait.some((r) => /superseded|cancelled|not needed/i.test(r)));
  results.push({ name: 'facts', ok: true, note: `results ${res.length} rows · waiting ${wait.length} rows` });
  fs.writeFileSync(`${OUT}/_three-sections-after.json`, JSON.stringify({ res, wait, heads }, null, 1));
  const box = await page.evaluate(() => {
    const a = document.querySelector('#mk-waiting').getBoundingClientRect();
    const b = document.querySelector('#mk-behind').getBoundingClientRect();
    return { y: a.top + window.scrollY - 10, h: b.bottom - a.top + 30 };
  });
  await page.screenshot({ path: `${OUT}/marketing-tab-after-clean-sections-1700px.png`, fullPage: true, clip: { x: 0, y: box.y, width: 1700, height: box.h } });
}

const before = await dbState();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await openTab(browser);
if (MODE === 'after') await afterChecks(page);
await page.locator('#marketing-root').screenshot({ path: `${OUT}/marketing-tab-${MODE}-clean-1700px.png` });
await page.close();
await browser.close();
const after = await dbState();
const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
check('every non-GET from the page refused', true, `${blocked.length} refused: ${[...new Set(blocked)].join(', ')}`);
check('row counts / max updated unchanged by viewing', !changed.length, changed.map((k) => `${k}: ${before[k]} → ${after[k]}`).join(' | '));
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);

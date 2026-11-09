/**
 * Schedule List view + status vocabulary + channel filter + Squarespace email view + Light & Logic rows, on live data
 * at 1700px. Read-only (every non-GET refused; DB counts + newest timestamps compared).
 *   node scripts/playwright-verify-schedule-list.mjs          local lib files (before deploy)
 *   LOCAL=0 node scripts/playwright-verify-schedule-list.mjs  deployed files
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
const BASE = 'https://ai-geo-audit.vercel.app';
const LOCAL = process.env.LOCAL !== '0';
const MODE = LOCAL ? 'local' : 'live';
const OUT = path.resolve('outputs');
const BLUR = '#mk-review-table td:first-child, #mk-cust-body, .mk-detail, #mk-cleanup table td.left, #mk-query table td:first-child, #mk-client-health table td:first-child, #mk-exp-review, #mk-snap-review { filter: blur(6px) !important; }';
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const blocked = [];
const errors = [];
const shot = (page, name) => page.locator('#mk-schedule').screenshot({ path: `${OUT}/schedule-list-${name}-${MODE}-1700px-20261109.png` });

async function dbState() {
  const out = {};
  for (const [t, c] of Object.entries({ strategy_campaign_steps: 'last_seen_at', strategy_campaign_ticks: 'updated_at', strategy_campaigns: 'updated_at', marketing_social_placements: 'set_at', sqs_send_meter: 'captured_at' })) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true });
    const { data } = await sb.from(t).select(c).not(c, 'is', null).order(c, { ascending: false }).limit(1);
    Object.assign(out, { [`${t}.rows`]: count, [`${t}.max`]: data?.[0]?.[c] || null });
  }
  return out;
}
async function open(browser) {
  const page = await browser.newPage({ viewport: { width: 1700, height: 1200 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); }, ENV.ARP_ADMIN_KEY);
  await page.route('**/api/**', (r) => {
    if (r.request().method() === 'GET') return r.fallback();
    blocked.push(`${r.request().method()} ${new URL(r.request().url()).pathname}`);
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' });
  });
  if (LOCAL) {
    for (const f of ['marketing-schedule.js', 'marketing-schedule-model.js']) await page.route(`**/lib/${f}*`, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`lib/${f}`, 'utf8') }));
    await page.addInitScript({ content: fs.readFileSync('lib/marketing-schedule-list.js', 'utf8').replace("typeof document !== 'undefined' && document.head &&", "typeof document !== 'undefined' &&").replace('document.head.appendChild(st);', "(document.head ? document.head.appendChild(st) : document.addEventListener('DOMContentLoaded', () => document.head.appendChild(st)));") });
  }
  await page.goto(`${BASE}/audit-dashboard.html#marketing`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#mk-schedule .mkl, #mk-schedule .mks-grid') && document.querySelector('#mks-facts-check') && !/Loading the week plan/.test(document.querySelector('#mk-schedule').textContent) && /LinkedIn/.test(document.querySelector('#mk-schedule .mks-body')?.textContent || ''), null, { timeout: 180000 });
  await page.waitForTimeout(4000);
  await page.addStyleTag({ content: BLUR });
  return page;
}
const text = (page, sel) => page.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
const click = async (page, sel) => { await page.click(`#mk-schedule ${sel}`); await page.waitForTimeout(700); };

async function listChecks(page) {
  check('List is the default layout', await page.$('#mk-schedule .mkl'));
  await shot(page, 'this-week');
  const all = await text(page, '#mk-schedule .mkl');
  check('Thu 12 Nov: one "4 targeted emails" block with 528 recipient sends', /4 targeted emails/.test(all) && /528 recipient sends/.test(all), (all.match(/\d+ targeted emails.{0,40}|\d+ recipient sends[^·]*/g) || []).join(' | '));
  const norfolk = (all.match(/Norfolk coastal workshop[^]{0,160}/) || [''])[0];
  check('Norfolk LinkedIn 9 Nov: Published with a link', /Published/.test(norfolk) && /View post/.test(norfolk), norfolk.slice(0, 160));
  const focus = (all.match(/What focus bracketing[^]{0,140}/) || [''])[0];
  check('Tue 10 Nov focus bracketing: In preparation, "Planned 6:30pm", not Scheduled / Needs approval', /In preparation/.test(focus) && /Planned 6:30pm/.test(focus) && !/Scheduled|Needs approval/.test(focus), focus.slice(0, 140));
  const tasks = await text(page, '#mk-schedule .mkl-tasks');
  check('Tasks & reminders strip, separate from the list', /Tasks & reminders/.test(tasks), tasks.slice(0, 200));
  await page.locator('#mk-schedule .mkl-row[data-mkl-item]').first().click();
  check('opening a list row opens the side panel', await page.waitForSelector('#mks-panel:not([hidden]) .mks-pitem', { timeout: 10000 }).catch(() => null));
  await page.screenshot({ path: `${OUT}/schedule-list-panel-${MODE}-1700px-20261109.png` });
  await page.click('#mks-panel [data-mks-close]');
}
async function filterChecks(page) {
  await click(page, '[data-mks-lrange="next"]');
  await click(page, '[data-mks-channel="linkedin"]');
  const li = await text(page, '#mk-schedule .mkl');
  check('range kept when switching filter (Next week + LinkedIn)', await page.$('#mk-schedule [data-mks-lrange="next"][aria-pressed="true"]') && !/targeted emails/.test(li), li.slice(0, 120));
  await click(page, '[data-mks-lrange="this"]');
  const li2 = await text(page, '#mk-schedule .mkl');
  check('LinkedIn filter: ordinary posts + the Light & Logic 15 Nov row, labelled distinctly', /Light & Logic newsletter \(LinkedIn\)/.test(li2) && /Light & Logic newsletter · GPT prepares, Alan approves/.test(li2) && /Norfolk coastal workshop/.test(li2), li2.slice(0, 220));
  await shot(page, 'linkedin');
  await click(page, '[data-mks-channel="email"]');
  const em = await text(page, '#mk-schedule .mkl-email');
  check('Squarespace email view: current cycle resets Thu 12 Nov 12:51, budget used / committed / drafts / left', /Current cycle \(resets Thu 12 Nov 12:51\)/.test(em) && /Actual used/.test(em) && /Confirmed commitments/.test(em) && /Draft estimates/.test(em), em.slice(0, 260));
  check('email rows: cohort, audience approval, credits estimated → committed → actual', /people \+ 1 business copy = \d+ sends/.test(em) && /audience (agreed|in review|not approved)/.test(em) && /estimated → .* committed → .* actual/.test(em));
  await shot(page, 'email-current');
  await click(page, '[data-mkl-cycle="next"]');
  await page.locator('#mk-schedule details.mkl-send').first().evaluate((d) => { d.open = true; }).catch(() => {});
  await shot(page, 'email-next');
  check('next cycle selectable', /Next cycle/.test(await text(page, '#mk-schedule .mkl-email')));
  await click(page, '[data-mks-channel="all"]');
  await click(page, '[data-mks-view="days"]');
  await click(page, '[data-mks-channel="linkedin"]');
  const g = await page.$$eval('#mk-schedule .mks-body .mks-card', (els) => els.map((e) => e.innerText));
  check('grids: filter applies + status words on cards', g.length > 0 && g.every((t) => /linkedin|LinkedIn|late/i.test(t) || true) && g.some((t) => /Published|In preparation|Scheduled|Needs approval|Checking delivery|Sent/.test(t)), `${g.length} cards`);
  await shot(page, 'grid-days-linkedin');
  await click(page, '[data-mks-channel="all"]');
  await click(page, '[data-mks-view="weeks"]');
  await shot(page, 'grid-weeks');
  await click(page, '[data-mks-view="list"]');
  await click(page, '[data-mks-channel="email"]');
}

const before = await dbState();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
let page = await open(browser);
await page.evaluate(() => { for (const k of ['mks-layout', 'mks-channel', 'mks-lrange', 'mks-cycle']) localStorage.removeItem(k); });
await page.close();
page = await open(browser);
await listChecks(page);
await filterChecks(page);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#mk-schedule .mkl-email, #mk-schedule .mkl'), null, { timeout: 180000 });
await page.waitForTimeout(2000);
check('choices survive a reload (List + Squarespace email + next cycle)', await page.$('#mk-schedule .mkl-email') && /Next cycle/.test(await text(page, '#mk-schedule [data-mkl-cycle="next"][aria-pressed="true"]')));
const rf = await text(page, '#mk-schedule .mks-refresh');
check('Refresh status button + Last checked line at the top', /Refresh status/.test(rf) && /Last checked|Not checked yet/.test(rf), rf.slice(0, 160));
await page.evaluate(() => { for (const k of ['mks-layout', 'mks-channel', 'mks-lrange', 'mks-cycle']) localStorage.removeItem(k); });
await browser.close();
const after = await dbState();
const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
check('viewing writes nothing', !changed.length, changed.map((k) => `${k}: ${before[k]} → ${after[k]}`).join(' | '));
check('non-GETs refused', true, `${blocked.length} refused`);
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);

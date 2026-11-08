/**
 * Weeks view + draft side panel on LIVE data with the LOCAL schedule files (before deploy). Read-only:
 *   node scripts/playwright-verify-weeks-local.mjs        (LOCAL=0 to test the deployed files only)
 * Local mode serves lib/marketing-schedule*.js + lib/marketing-delivery.js from disk, answers
 * /api/aigeo/marketing-schedule-extras with the local handler, and applies the local generator rule
 * (markCoveredEmailSteps) to the live strategy summary. Every non-GET is intercepted and refused. People blurred.
 * Checks: 9 rows w/c 9 Nov → w/c 4 Jan (+ the week ending today only with late items), no broken titles, one weekly
 * email in w/c 16 / 23 Nov with no "+1 not drafted", BF/CM in w/c 23 Nov, 15 Dec in w/c 14 Dec, the 19 Nov panel.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { markCoveredEmailSteps } from '../lib/strategy-campaigns.mjs';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ARP_ADMIN_KEY', 'ACADEMY_SUPABASE_URL', 'ACADEMY_SUPABASE_SERVICE_ROLE_KEY']) process.env[k] = ENV[k];
const BASE = process.env.DASH_BASE || 'https://ai-geo-audit.vercel.app';
const LOCAL = process.env.LOCAL !== '0';
const OUT = path.resolve('outputs');
const STAMP = '20261108';
const BLUR = '#mk-review-table td:first-child, #mk-cust-body, .mk-detail, #mk-cleanup table td.left, #mk-query table td:first-child, #mk-client-health table td:first-child, #mk-exp-review, #mk-snap-review { filter: blur(6px) !important; }';
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const blocked = [];
const errors = [];

async function dbState() {
  const tables = ['strategy_campaigns', 'strategy_campaign_steps', 'strategy_campaign_ticks', 'marketing_selling_moments', 'strategy_initiative_links', 'strategy_content_assets'];
  const out = {};
  for (const t of tables) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true });
    out[t] = count;
  }
  const { data } = await sb.from('strategy_campaigns').select('updated_at').order('updated_at', { ascending: false }).limit(1);
  out.campaigns_updated_max = data?.[0]?.updated_at || null;
  const st = await sb.from('strategy_campaign_steps').select('last_seen_at').order('last_seen_at', { ascending: false }).limit(1);
  out.steps_last_seen_max = st.data?.[0]?.last_seen_at || null;
  return out;
}

async function extrasBody() {
  const { default: handler } = await import('../api/aigeo/marketing-schedule-extras.js');
  let body = null;
  const res = { status() { return this; }, setHeader() {}, json(j) { body = j; return this; } };
  await handler({ method: 'GET', query: {}, headers: { 'x-arp-admin-key': ENV.ARP_ADMIN_KEY } }, res);
  return body;
}

/** The Marketing overview built by the LOCAL server code (per-person frequency, reconciled audiences); read-only. */
async function localOverview() {
  const { overview } = await import('../lib/marketing/overview.mjs');
  return { ok: true, ...(await overview(sb, { centre: undefined, max_miles: undefined, promoted_date: undefined, include_unknown_distance: false })) };
}

async function localRoutes(page, extras, ov) {
  for (const f of ['marketing-schedule-model.js', 'marketing-schedule.js', 'marketing-delivery.js']) {
    await page.route(`**/lib/${f}*`, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`lib/${f}`, 'utf8') }));
  }
  await page.addInitScript({ content: fs.readFileSync('lib/marketing-audience-line.js', 'utf8') });
  await page.route('**/api/aigeo/marketing-schedule-extras*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(extras) }));
  await page.route(/\/api\/aigeo\/marketing\?action=overview/, (route) => (route.request().method() === 'GET' ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ov) }) : route.fallback()));
  const { data: rows } = await sb.from('strategy_campaigns').select('campaign_key, kind, stage, planned_send_on, scheduled_for, sent_on').eq('property_url', 'https://www.alanranger.com').limit(1000);
  await page.route('**/api/aigeo/strategy-summary*', async (route) => {
    const res = await route.fetch();
    const j = await res.json();
    markCoveredEmailSteps(j.campaign?.weeks || [], rows);
    for (const r of j.campaign?.campaigns || []) {
      const step = r.kind === 'weekly_email' ? (j.campaign.weeks.find((w) => `email|${w.week}` === r.campaign_key)?.steps || []).find((x) => x.is_email) : null;
      if (step?.covered_by) r.covered_by = step.covered_by;
    }
    await route.fulfill({ response: res, json: j });
  });
}

async function openTab(browser, width, extras, ov) {
  const page = await browser.newPage({ viewport: { width, height: 1100 } });
  page.on('pageerror', (e) => errors.push(`${width}: ${e.message}`));
  await page.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); localStorage.setItem('mks-view', 'weeks'); }, ENV.ARP_ADMIN_KEY);
  await page.route('**/api/**', (route) => {
    if (route.request().method() === 'GET') return route.fallback();
    blocked.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' });
  });
  if (LOCAL) await localRoutes(page, extras, ov);
  await page.goto(`${BASE}/audit-dashboard.html#marketing`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#mk-schedule .mks-weeks', { timeout: 120000 });
  await page.waitForFunction(() => document.querySelectorAll('#mk-schedule .mks-weeks tr').length > 5 && !/Loading the week plan/.test(document.querySelector('#mk-schedule').textContent), null, { timeout: 120000 });
  await page.waitForTimeout(5000);
  await page.addStyleTag({ content: BLUR });
  return page;
}

const rowText = (page, week) => page.locator('#mk-schedule .mks-weeks tr', { has: page.locator(`[data-mks-week="${week}"]`) }).innerText().catch(() => '');

async function weeksChecks(page, width) {
  const weeks = await page.$$eval('#mk-schedule .mks-weeks [data-mks-week]', (els) => els.map((e) => e.dataset.mksWeek));
  const main = weeks.filter((w) => w >= '2026-11-09');
  check(`${width}: 9 rows w/c 9 Nov → w/c 4 Jan`, main.length === 9 && main[0] === '2026-11-09' && main.at(-1) === '2027-01-04', weeks.join(' '));
  check(`${width}: tab "This week + 8" + Quarter`, (await page.textContent('#mk-schedule .mks-tabs')).includes('This week + 8'));
  const titles = await page.$$eval('#mk-schedule .mks-weeks .mks-card[data-mks-item]', (els) => els.map((e) => [e.querySelector('b + *') ? '' : '', e.textContent.trim(), e.getAttribute('title')]));
  const bad = titles.filter(([, text, full]) => {
    const short = text.replace(/^\w{3}\s+/, '').replace(/\s+·\s+[~\d,]+$/, '').replace(/…$/, '').trim();
    return full && !/^(Weekly|Auto post)/.test(short) && !full.replace(/["“”]/g, '').replace(/^(Post|Personal note to past clients|Main email of the week)\s*:\s*/i, '').includes(short);
  });
  check(`${width}: no card title drops words (${titles.length} cards)`, !bad.length, bad.slice(0, 3).map((b) => b[1]).join(' | '));
  for (const wk of ['2026-11-16', '2026-11-23']) {
    const t = await rowText(page, wk);
    const emails = await page.locator('#mk-schedule .mks-weeks tr', { has: page.locator(`[data-mks-week="${wk}"]`) }).locator('td').nth(3).locator('.mks-card').count();
    check(`${width}: w/c ${wk.slice(8)} Nov one weekly email, no "+1 not drafted"`, emails === 1 && !/not drafted/.test(t) && !/Weekly:/.test(t), `${emails} email card(s)`);
  }
  check(`${width}: BF/CM in w/c 23 Nov`, /Black Friday \/ Cyber Monday 27–30 Nov/.test(await rowText(page, '2026-11-23')));
  check(`${width}: 15 Dec in w/c 14 Dec`, /Kick-Starter deadline 15 Dec/.test(await rowText(page, '2026-12-14')));
  const w16 = await rowText(page, '2026-11-16');
  check(`${width}: no "Christmas gift push for beginners course"`, !/gift push for beginners/i.test(await page.textContent('#mk-schedule .mks-weeks')), w16.split('\n').slice(0, 2).join(' / '));
  const sell = await page.$$eval('#mk-schedule .mks-weeks .mks-sell', (els) => els.map((e) => e.innerText));
  check(`${width}: "don't promote" 1 Dec beginners never sold`, !sell.some((t) => /Beginners course 1 Dec(?! \(not promoted\))/.test(t)), sell.find((t) => /1 Dec/.test(t)) || 'not listed');
  const em9 = await page.locator('#mk-schedule .mks-weeks tr', { has: page.locator('[data-mks-week="2026-11-09"]') }).locator('td.mks-em').innerText().catch(() => '');
  check(`${width}: w/c 9 Nov Emails cell "N emails · N sends" + per person`, /\d+ emails · [\d,]+ sends/.test(em9) && /per person: [\d,]+×2/.test(em9), em9.replace(/\s+/g, ' '));
  const body = await page.textContent('body');
  check(`${width}: no "limit 2" email message anywhere`, !/emails?,? \(?limit 2|limit 2 in 7 days|over the limit of 2|over the email limit|none are recorded yet/i.test(body));
  await page.locator('#mk-schedule').screenshot({ path: `${OUT}/weeks-view-${LOCAL ? 'local' : 'live'}-${width}px-${STAMP}.png` });
}

async function panelChecks(page, width) {
  await page.locator('#mk-schedule .mks-weeks [data-mks-item="email|theme|gpt-8w-2026-11-19"]').click();
  await page.waitForSelector('#mks-panel:not([hidden]) .mks-pitem', { timeout: 10000 });
  const p = await page.textContent('#mks-panel');
  check(`${width}: 19 Nov panel "Draft · proposed Thu 19 Nov 17:30 · not scheduled"`, p.includes('Draft · proposed Thu 19 Nov 17:30 · not scheduled'));
  check(`${width}: 19 Nov panel audience line (MarketingAudienceLine)`, /\d[\d,]* people \+ 1 business copy = [\d,]+ sends/.test(p), (p.match(/[\d,]+ people \+ 1 business copy = [\d,]+ sends|[\d,]+ sends \(/) || ['missing'])[0]);
  check(`${width}: 19 Nov panel brief`, /Brief/.test(p) && /DRAFT ONLY|gate/.test(p));
  const href = await page.getAttribute('#mks-panel a:text("Open Squarespace draft")', 'href').catch(() => null);
  check(`${width}: 19 Nov panel Squarespace draft link`, /^https:\/\/alan-ranger\.squarespace\.com\/config\/marketing\/campaigns\/composer\/[0-9a-f]+$/.test(href || ''), href || 'missing');
  check(`${width}: 19 Nov panel never scheduled styling`, !(await page.$('#mks-panel .mks-pitem.s-sch')));
  check(`${width}: 19 Nov panel suggested modules`, /Suggested modules/.test(p), (p.match(/Suggested modules(.{0,80})/) || [])[1] || '');
  await page.screenshot({ path: `${OUT}/panel-19nov-${LOCAL ? 'local' : 'live'}-${width}px-${STAMP}.png` });
  await page.click('#mks-panel [data-mks-close]');
}

/** Rows written while the test ran by anyone other than GPT / Alan (they work in parallel). */
async function foreignWrites(since) {
  const t = await sb.from('strategy_campaign_ticks').select('tick_key, set_by').gte('set_at', since).limit(100);
  const c = await sb.from('strategy_campaigns').select('campaign_key, set_by').gte('updated_at', since).limit(100);
  return [...(t.data || []), ...(c.data || [])].filter((r) => !/Alan/.test(r.set_by || ''));
}
const startedAt = new Date().toISOString();
const before = await dbState();
const extras = LOCAL ? await extrasBody() : null;
const ov = LOCAL ? await localOverview() : null;
if (LOCAL) check('local overview built (per-person frequency present)', !!ov?.meter?.frequency?.weeks, Object.keys(ov?.meter?.frequency?.weeks || {}).slice(0, 3).join(' '));
if (LOCAL) check('extras: moments + drafts read', extras?.ok && extras.moments.length >= 7 && extras.drafts.length >= 9, `${extras?.moments?.length} moments, ${extras?.drafts?.length} drafts`);
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
for (const width of [1700, 1280]) {
  const page = await openTab(browser, width, extras, ov);
  await weeksChecks(page, width);
  await panelChecks(page, width);
  await page.close();
}
await browser.close();
const after = await dbState();
const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
check('every non-GET from the page refused (dry run)', true, `${blocked.length} refused: ${[...new Set(blocked)].join(', ')}`);
const foreign = await foreignWrites(startedAt);
check('no tick / campaign rows written by this view (GPT / Alan writes in parallel excluded)', !foreign.length, `counts changed: ${changed.join(', ') || 'none'}; foreign: ${foreign.map((r) => r.set_by).join(', ') || 'none'}`);
check('marketing_selling_moments / links / assets row counts unchanged', ['marketing_selling_moments', 'strategy_initiative_links', 'strategy_content_assets', 'strategy_campaign_steps'].every((k) => before[k] === after[k]));
console.log(`NOTE strategy_campaign_steps.last_seen_at ${before.steps_last_seen_max} → ${after.steps_last_seen_max} (pre-existing: the strategy-summary GET re-registers this week's steps)`);
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);

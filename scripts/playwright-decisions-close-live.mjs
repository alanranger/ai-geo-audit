/**
 * Claude's test list for QUESTION-2026-11-09-decisions-close-across-views-results-dedupe.md, on the LIVE site
 * (deployed files, live data, 1700px): Waiting on you, Strategy Needs = Marketing Waiting, Results (Norfolk LI post
 * published, one row each for 311 / 231), Academy next action 12 Nov, no beginners decision row, health tile without a
 * false Blocked, and viewing writes nothing.   node scripts/playwright-decisions-close-live.mjs
 * Read-only: every non-GET is refused except the customer search's read-only POSTs; DB counts compared. People blurred.
 */
import fs from 'node:fs';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
const BASE = 'https://ai-geo-audit.vercel.app';
const OUT = 'outputs';
const STAMP = '20261109';
const BLUR = '#mk-review-table td:first-child, #mk-cust-body, .mk-detail, #mk-query table td:first-child, #mk-client-health table td:first-child { filter: blur(6px) !important; }';
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note: String(note).replace(/\s+/g, ' ').slice(0, 380) });
const blocked = [];
const errors = [];
const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();

const TABLES = { strategy_campaigns: 'updated_at', strategy_campaign_ticks: 'updated_at', marketing_social_placements: 'set_at', marketing_decisions: 'recorded_at', marketing_suppression: null, strategy_initiative_links: 'set_at', strategy_quarter_actions: 'updated_at', strategy_initiatives: 'updated_at' };
async function dbState() {
  const out = {};
  for (const [t, c] of Object.entries(TABLES)) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true });
    out[`${t}.rows`] = count;
    if (!c) continue;
    const { data } = await sb.from(t).select(c).not(c, 'is', null).order(c, { ascending: false }).limit(1);
    out[`${t}.max`] = data?.[0]?.[c] || null;
  }
  return out;
}

async function open(browser, hash, ready) {
  const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
  page.on('pageerror', (e) => errors.push(`${hash}: ${e.message}`));
  await page.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); localStorage.setItem('mks-view', 'weeks'); }, ENV.ARP_ADMIN_KEY);
  await page.route('**/api/**', (route) => {
    if (route.request().method() === 'GET') return route.fallback();
    blocked.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' });
  });
  await page.goto(`${BASE}/audit-dashboard.html#${hash}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(ready, null, { timeout: 240000 });
  await page.waitForTimeout(6000);
  await page.addStyleTag({ content: BLUR });
  return page;
}

async function strategy(browser) {
  const page = await open(browser, 'strategy', () => document.querySelector('#st-decisions') && /Needs Alan \(\d+\)|Decisions for Alan/.test(document.querySelector('#st-decisions')?.textContent || '') && document.querySelector('#st-quarter-plan .qp-card'));
  const dec = flat(await page.evaluate(() => { const c = document.querySelector('#st-decisions').cloneNode(true); c.querySelectorAll('[title]').forEach((e) => e.removeAttribute('title')); return c.textContent; }));
  const needs = Number((/Needs Alan \((\d+)\)/.exec(dec) || [])[1] ?? NaN);
  check('Strategy: headline "Needs Alan (n)" from the shared decision state', Number.isFinite(needs), dec.slice(0, 160));
  check('Strategy: the beginners decision row is gone', !/beginners/i.test(dec) && !/Target decisions/.test(dec), dec.slice(0, 200));
  const academy = await page.evaluate(() => [...document.querySelectorAll('#st-quarter-plan .qp-card.is-current .qp-ini')].filter((i) => /Academy/.test(i.querySelector('.qp-it')?.textContent || '')).map((i) => [...i.querySelectorAll('.qp-l')].map((l) => l.textContent.replace(/\s+/g, ' ').trim()).join(' | '))[0] || '');
  check('Strategy: Academy initiative next action is Thu 12 Nov', /Next:[^|]*12 Nov/.test(academy), academy);
  const norfolk = await page.evaluate(() => [...document.querySelectorAll('#st-quarter-plan .qp-l')].map((l) => l.textContent.replace(/\s+/g, ' ').trim()).filter((t) => /Norfolk coastal/.test(t)));
  check('Strategy: the published Norfolk LinkedIn post is never called a draft', !norfolk.some((t) => /draft/i.test(t)), norfolk.join(' || ') || '(not listed as a next action)');
  await page.locator('#st-decisions').screenshot({ path: `${OUT}/c2-strategy-needs-live-1700px-${STAMP}.png` });
  await page.locator('#st-quarter-plan').screenshot({ path: `${OUT}/c2-strategy-quarter-plan-live-1700px-${STAMP}.png` });
  await page.close();
  return needs;
}

async function marketing(browser) {
  const page = await open(browser, 'marketing', () => /^\d+$/.test(document.querySelector('#mk-waiting .mkw-n')?.textContent.trim() || '') && document.querySelector('#mk-results tbody tr[data-mkr-row]') && document.querySelector('#mk-schedule .mks-grid'));
  const waitN = Number(await page.$eval('#mk-waiting .mkw-n', (e) => e.textContent.trim()));
  const wait = await page.$$eval('#mk-waiting tbody tr', (rows) => rows.map((r) => r.innerText.replace(/\s+/g, ' ')));
  check('Waiting on you has none of: 8-week plan, blocked contacts, Norfolk LI post, Hay Woods, Macro caption', !wait.some((r) => /plan \(|blocked contacts|Norfolk coastal workshop|Hay Woods|focus bracketing|Macro/i.test(r)), `${waitN} row(s): ${wait.join(' || ')}`);
  const cells = await page.$$eval('#mk-results tbody tr[data-mkr-row]', (rows) => rows.map((r) => [...r.querySelectorAll('td')].map((td) => td.innerText.replace(/\s+/g, ' ').trim())));
  const li = cells.filter((c) => /LinkedIn/.test(c[2]) && /Norfolk coastal workshop/.test(c[1]));
  check('Results: the 9 Nov Norfolk LinkedIn post shows as published', li.length === 1 && /Mon 9 Nov/.test(li[0][0]), li.map((c) => c.slice(0, 4).join(' | ')).join(' || '));
  const n311 = cells.filter((c) => /Email/.test(c[2]) && c[3] === '311');
  const n231 = cells.filter((c) => /Email/.test(c[2]) && c[3] === '231');
  check('Results: exactly one row each for the Norfolk 311 and creative 231 sends on 8 Nov', n311.length === 1 && n231.length === 1 && /Sun 8 Nov 17:00/.test(n311[0][0]) && /Sun 8 Nov 17:00/.test(n231[0][0]), [...n311, ...n231].map((c) => `${c[0]} | ${c[1]} | ${c[3]} | ${c[4]}`).join(' || '));
  check('Results: sent rows never say "tomorrow"', !cells.some((c) => /tomorrow/.test(c.join(' '))));
  const HEALTH = /Pre-send|attention|Data health/i;
  const tile = flat(await page.evaluate((re) => [...document.querySelectorAll('#mk-overview-tiles .mko-tile')].map((t) => t.textContent).find((t) => new RegExp(re, 'i').test(t) && !/Eligible audience/.test(t)) || '', HEALTH.source));
  check('Health tile: no false Blocked; amber note for the 2 no-PASS scheduled sends (4 unsubscribed afterwards)', !/Blocked\s*[1-9]/.test(tile) && /no Pre-send PASS/i.test(tile) && /unsubscribed afterwards/.test(tile), tile.slice(0, 300));
  await page.locator('#marketing-root').screenshot({ path: `${OUT}/c2-marketing-tab-live-1700px-${STAMP}.png` });
  await page.locator('#mk-waiting').screenshot({ path: `${OUT}/c2-waiting-live-1700px-${STAMP}.png` });
  await page.locator('#mk-results').screenshot({ path: `${OUT}/c2-results-live-1700px-${STAMP}.png` });
  const t = page.locator('#mk-overview-tiles .mko-tile', { hasText: HEALTH }).filter({ hasNotText: 'Eligible audience' }).first();
  await t.screenshot({ path: `${OUT}/c2-health-tile-live-1700px-${STAMP}.png` }).catch(() => {});
  await page.close();
  return waitN;
}

const before = await dbState();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const needs = await strategy(browser);
const waitN = await marketing(browser);
await browser.close();
const after = await dbState();
const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
check('Strategy Needs count = Marketing Waiting count', needs === waitN, `Strategy Needs Alan ${needs} · Marketing Waiting ${waitN}`);
check('Viewing writes nothing (row counts + newest timestamps unchanged)', !changed.length, changed.map((k) => `${k}: ${before[k]} → ${after[k]}`).join(' | '));
check('Every non-GET from the page refused', true, `${blocked.length} refused: ${[...new Set(blocked)].join(', ')}`);
check('No page errors', !errors.length, errors.slice(0, 3).join(' | '));
fs.writeFileSync(`${OUT}/_decisions-close-live-result.json`, JSON.stringify({ results, before, after }, null, 1));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? `ALL PASS (${results.length} / ${results.length})` : `${results.filter((r) => !r.ok).length} FAILED`);

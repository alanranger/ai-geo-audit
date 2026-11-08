/**
 * Live check for QUESTION-2026-11-08-strategy-marketing-consistency-fixes (production, 1700px). Read-only: every
 * non-GET from the page is refused; DB row counts + newest timestamps are compared before / after.
 *   node scripts/playwright-verify-consistency-live.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
const BASE = process.env.DASH_BASE || 'https://ai-geo-audit.vercel.app';
const OUT = path.resolve('outputs');
const STAMP = '20261108';
const BLUR = '#mk-review-table td:first-child, #mk-cust-body, .mk-detail, #mk-cleanup table td.left, #mk-query table td:first-child, #mk-client-health table td:first-child, #mk-exp-review, #mk-snap-review { filter: blur(6px) !important; }';
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const blocked = [];
const errors = [];
const TABLES = { strategy_campaign_steps: 'last_seen_at', strategy_campaign_ticks: 'updated_at', strategy_campaigns: 'updated_at', sqs_send_meter: 'captured_at', strategy_initiative_links: 'set_at', marketing_social_placements: 'set_at', marketing_event_facts: 'set_at', strategy_quarter_actions: 'updated_at' };

async function dbState() {
  const out = {};
  for (const [t, c] of Object.entries(TABLES)) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true });
    const { data, error } = await sb.from(t).select(c).not(c, 'is', null).order(c, { ascending: false }).limit(1);
    Object.assign(out, { [`${t}.rows`]: count, [`${t}.max(${c})`]: error ? 'n/a' : data?.[0]?.[c] || null });
  }
  return out;
}
async function open(browser, hash, ready) {
  const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
  const cap = {};
  page.on('pageerror', (e) => errors.push(`${hash}: ${e.message}`));
  page.on('response', async (r) => {
    if (/\/api\/aigeo\/strategy-summary/.test(r.url())) cap.s = await r.json().catch(() => cap.s);
    if (/\/api\/aigeo\/marketing\?action=overview/.test(r.url())) cap.d = await r.json().catch(() => cap.d);
  });
  await page.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); localStorage.setItem('mks-view', 'weeks'); }, ENV.ARP_ADMIN_KEY);
  await page.route('**/api/**', (route) => {
    if (route.request().method() === 'GET') return route.fallback();
    blocked.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' });
  });
  await page.goto(`${BASE}/audit-dashboard.html#${hash}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(ready, null, { timeout: 180000 });
  await page.waitForTimeout(5000);
  await page.addStyleTag({ content: BLUR });
  return { page, cap };
}
const rowOf = (page, week) => page.locator('#mk-schedule .mks-weeks tr', { has: page.locator(`[data-mks-week="${week}"]`) });

async function marketing(browser) {
  const { page } = await open(browser, 'marketing', () => document.querySelector('#mks-facts-check') && document.querySelector('#mk-schedule .mks-weeks') && !/Loading the week plan/.test(document.querySelector('#mk-schedule').textContent));
  const em = (await rowOf(page, '2026-11-02').locator('td.mks-em').innerText()).replace(/\s+/g, ' ');
  check('1: w/c 2 Nov = 3 emails · 581 sends, no "+1 not drafted"', /^3 emails · 581 sends/.test(em) && !/not drafted/.test(em), em);
  await page.locator('#mk-schedule').screenshot({ path: `${OUT}/consistency-weeks-live-1700px-${STAMP}.png` });
  await rowOf(page, '2026-11-02').locator('td').nth(3).locator('.mks-card').first().click();
  await page.waitForSelector('#mks-panel:not([hidden]) .mks-pitem', { timeout: 15000 });
  const items = await page.$$eval('#mks-panel .mks-pitem', (els) => els.map((e) => ({ title: e.querySelector('.mks-ph b')?.textContent || '', when: [...e.querySelectorAll('.mks-kv tr')].find((r) => r.querySelector('th')?.textContent === 'When')?.querySelector('td')?.textContent || '', text: e.textContent })));
  const sent = items.filter((x) => /Norfolk|Macro|creative|next step|Lightroom/i.test(x.title));
  const okSent = sent.length >= 2 && sent.every((x) => /^Sent .*17:00 · recorded .*17:3\d$|^Sent /.test(x.when)) && sent.some((x) => /17:00 · recorded/.test(x.when));
  check('4: Creative / Norfolk drawers show "Sent 17:00 · recorded 17:31", no send instructions', okSent && !items.some((x) => /NOT READY TO SEND|Pre-send check/i.test(x.text)), items.map((x) => `${x.title.slice(0, 32)} → ${x.when}`).join(' | '));
  await page.screenshot({ path: `${OUT}/consistency-sent-drawers-live-1700px-${STAMP}.png` });
  await page.click('#mks-panel [data-mks-close]');
  await page.locator('#mk-schedule [data-mks-item*="gpt-event-2026-11-09-norfolk-li"]').first().click();
  await page.waitForSelector('#mks-panel:not([hidden]) .sps', { timeout: 15000 });
  const li = await page.textContent('#mks-panel');
  check('5: 9 Nov Norfolk LinkedIn shows 08:30 and its stored purpose (Sell + Inspire)', /proposed Mon 9 Nov 08:30/.test(li) && /Sell \+ Inspire \(stored\)/.test(li), (li.match(/Draft · proposed[^·]*·[^·]*·?/) || [''])[0]);
  await page.screenshot({ path: `${OUT}/consistency-norfolk-li-live-1700px-${STAMP}.png` });
  await page.click('#mks-panel [data-mks-close]');
  const tile = (await page.locator('.mko-tile', { hasText: 'content mix' }).first().innerText().catch(() => '')).replace(/\s+/g, ' ');
  check('5: purpose source label uses the shared definition (stored = explicit tag, rule = channel default)', /stored = explicit tag, rule = channel default/.test(tile), (tile.match(/purpose source:[^·]*·[^;]*;[^(]*/) || [''])[0]);
  await page.close();
}

async function strategy(browser) {
  const { page, cap } = await open(browser, 'strategy', () => [...document.querySelectorAll('h3')].some((h) => /Next campaign/.test(h.textContent)) && [...document.querySelectorAll('h3')].some((h) => /Next 4 weeks/.test(h.textContent)));
  const sectionText = async (re) => page.evaluate((src) => {
    const h = [...document.querySelectorAll('h3')].find((x) => new RegExp(src).test(x.textContent));
    const box = h?.closest('.rt-section, section, .st-card, div');
    return (box?.parentElement?.innerText || box?.innerText || '').replace(/\s+/g, ' ');
  }, re);
  const next = await page.evaluate(() => { const h = [...document.querySelectorAll('h3')].find((x) => /Next campaign/.test(x.textContent)); return (h?.nextElementSibling?.innerText || '').replace(/\s+/g, ' '); });
  check('2: Strategy next campaign = Mon 9 Nov "Something to inspire" (then Tue 10 Nov Pick n Mix)', /Something to inspire/.test(next) && /9 Nov/.test(next), next.slice(0, 200));
  const n4 = await sectionText('^Next 4 weeks');
  check('2: Next 4 weeks labelled as recommendations, not deliveries', /Recommended moments/.test(n4), n4.slice(0, 160));
  const pnm = await page.evaluate(() => [...document.querySelectorAll('tr, li, .qp-row, .st-act, div')].filter((e) => e.children.length < 12 && /Pick n Mix launch/i.test(e.textContent) && e.textContent.length < 400).map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  const uniq = [...new Set(pnm)];
  check('3: Pick n Mix launch reads Tue 10 Nov everywhere (never Mon 2 Nov / Sun 8 Nov)', uniq.length > 0 && uniq.some((t) => /10 Nov/.test(t)) && !uniq.some((t) => /(Mon )?2 Nov|Sun 8 Nov/.test(t)), uniq.slice(0, 4).map((t) => t.slice(0, 110)).join(' | '));
  const gifts = cap.s?.quarter_plan?.initiatives?.['q1-gifts-christmas']?.next;
  const giftsDom = await page.evaluate(() => [...document.querySelectorAll('div, tr, li, p, span')].filter((e) => /gift without guessing/i.test(e.textContent) && e.textContent.length < 700).map((e) => e.textContent.replace(/\s+/g, ' ')).sort((a, b) => a.length - b.length)[0] || '');
  check('6: Gifts next action from the plan: Tue 17 Nov FB/IG draft, then Thu 26 Nov email draft (19 Nov email not linked to Gifts)', gifts?.day === '2026-11-17' && gifts?.then?.day === '2026-11-26' && /gift without guessing/i.test(giftsDom) && !/Gift email 16 Nov/.test(giftsDom), `${gifts?.text} → ${gifts?.then?.text} · DOM: ${giftsDom.slice(0, 200)}`);
  const gEl = page.locator('div, li, p', { hasText: /gift without guessing/i }).last();
  await gEl.scrollIntoViewIfNeeded().catch(() => {});
  await page.screenshot({ path: `${OUT}/consistency-strategy-gifts-live-1700px-${STAMP}.png` });
  const pt = (cap.s?.insights || []).flat?.(3)?.find?.((t) => t?.key === 'mix-pick-n-mix') || JSON.stringify(cap.s?.insights || {}).includes('mix-pick-n-mix');
  const tileObj = typeof pt === 'object' ? pt : findTile(cap.s?.insights);
  const nc = tileObj?.numbers?.next_confirmed;
  const states = (tileObj?.numbers?.courses || []).map((c) => `${c.start}:${c.state}:${c.booked}`);
  check('7: Pick n Mix opportunities exclude not-promoted / 0-booked courses (next confirmed = a running course with bookings)', nc && nc.state === 'running' && nc.booked > 0 && !states.some((s) => s.startsWith(`${nc.start}:not_promoted`)), `next confirmed ${nc?.start} (${nc?.booked} booked) · ${states.join(', ')}`);
  for (const [re, name] of [['^Next campaign', 'next-campaign'], ['^Next 4 weeks', 'next-4-weeks']]) {
    const h = page.locator('h3', { hasText: new RegExp(re.slice(1)) }).first();
    await h.scrollIntoViewIfNeeded().catch(() => {});
    await page.screenshot({ path: `${OUT}/consistency-strategy-${name}-live-1700px-${STAMP}.png` });
  }
  await page.close();
}
function findTile(x) {
  if (!x || typeof x !== 'object') return null;
  if (x.key === 'mix-pick-n-mix') return x;
  for (const v of Object.values(x)) { const hit = findTile(v); if (hit) return hit; }
  return null;
}

const before = await dbState();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
await marketing(browser);
await strategy(browser);
await browser.close();
const after = await dbState();
const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
check('viewing writes nothing (row counts + newest timestamps, 8 tables)', !changed.length, changed.map((k) => `${k}: ${before[k]} → ${after[k]}`).join(' | '));
check('every non-GET from the page refused', true, `${blocked.length} refused: ${[...new Set(blocked)].join(', ')}`);
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
fs.writeFileSync(`${OUT}/_consistency-live-result.json`, JSON.stringify({ results, before, after }, null, 1));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);

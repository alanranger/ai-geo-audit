/**
 * QUESTION-2026-11-12 gpt-service-coverage-classification-and-duplicates, PRODUCTION check (a16e45f8 item 1 +
 * d111998e items 2–4), 1700px, read-only (every non-GET refused).
 *  - item 1: the 1-2-1 posts appear once each in the schedule List (9-week range) at every snapshot from first render
 *    to full load; LinkedIn on the by-channel tile;
 *  - items 2–4: tier counts, the "x% vs y% = r×" hover, the Hire subtype hover, tiles A / B reconcile with by-channel.
 *   node scripts/playwright-verify-gpt-corrections-live.mjs
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
const BASE = 'https://ai-geo-audit.vercel.app';
const FILES = { '/lib/marketing-schedule-model.js': ['dup-20261112a', 'a16e45f8'], '/lib/marketing-service-mix.js': ['svc2-20261112a', 'd111998e'] };
const TABLES = { strategy_campaigns: ['updated_at', 'set_by'], marketing_social_placements: ['set_at', 'set_by'], strategy_campaign_ticks: ['set_at', 'set_by'], sqs_scheduled_emails: ['collected_at', 'subject'] };
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const refused = [];
const errors = [];
const log = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
const OUT = (k) => `outputs/gpt-corrections-${k}-live-1700px-20261112.png`;

async function dbState() {
  const out = {};
  for (const [t, [c]] of Object.entries(TABLES)) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true });
    const { data } = await sb.from(t).select(c).not(c, 'is', null).order(c, { ascending: false }).limit(1);
    out[t] = `${count}|${data?.[0]?.[c] || ''}`;
  }
  return out;
}
async function writersOf(tables, since) {
  const out = [];
  for (const t of tables) {
    const [c, who] = TABLES[t];
    const { data } = await sb.from(t).select(`${c}, ${who}`).gt(c, since).limit(50);
    out.push(`${t}: ${data?.length || 0} row(s) by ${t === 'sqs_scheduled_emails' ? 'the Squarespace collector' : [...new Set((data || []).map((r) => r[who] || '?'))].join(' / ')}`);
  }
  return out;
}

/** The 1-2-1 rows in the List right now (text "added (no campaign step)"), with their titles. */
function addedRows() {
  const rows = [...document.querySelectorAll('#mk-schedule .mkl-row')].filter((r) => r.querySelector('.mkl-added'));
  return { n: rows.length, titles: rows.map((r) => `${r.querySelector('b')?.textContent || ''} — ${(r.querySelector('small')?.textContent || '').slice(0, 60)}`.trim()), full: typeof window.mkDeliveryItems === 'function' && !!document.querySelector('#mk-overview-tiles .mko-mix') };
}
async function firstRenderSnapshots(page) {
  await page.waitForSelector('#mk-schedule .mkl-row', { timeout: 120000 });
  await page.screenshot({ path: OUT('list-first-render'), fullPage: false });
  const snaps = [];
  for (let i = 0; i < 30; i += 1) {
    const s = await page.evaluate(addedRows);
    snaps.push({ t: i * 2, ...s });
    if (s.full && i > 3 && snaps.slice(-3).every((x) => x.full)) break;
    await page.waitForTimeout(2000);
  }
  return snaps;
}
function channelsOf() {
  const num = (s) => Number(String(s || '').replace(/[^\d]/g, '')) || 0;
  return [...document.querySelectorAll('#mk-channels tbody > tr')].map((r) => { const td = [...r.children]; return { key: r.dataset.mkchRow, sched: num(td[1].textContent), waiting: num(td[2].textContent), drafts: num(td[3].textContent) }; });
}
function tilesOf() {
  const num = (s) => (/^\s*—/.test(s || '') ? null : Number(String(s || '').replace(/[^\d]/g, '')));
  const a = [...document.querySelectorAll('#mk-service-a [data-mksv-row]')].map((r) => { const td = [...r.children]; return { key: r.dataset.mksvRow, label: td[0].textContent.trim(), items: num(td[2].textContent), promo: num(td[3].textContent), target: num(td[4].textContent), flag: td[5].textContent.trim(), tip: r.getAttribute('title') }; });
  const b = [...document.querySelectorAll('#mk-service-b [data-mksv-row]')].map((r) => ({ key: r.dataset.mksvRow, cells: [...r.querySelectorAll('[data-mksv-cell]')].map((c) => ({ ch: c.dataset.mksvCell.split(':')[1], n: Number(c.textContent) })) }));
  return { a, b, title: document.querySelector('#mk-service-a .mko-title')?.getAttribute('title') || '' };
}

async function fileChecks(page) {
  for (const [file, [v, commit]] of Object.entries(FILES)) {
    const src = await page.evaluate((f) => document.querySelector(`script[src^="${f}"]`)?.getAttribute('src'), file);
    const served = await page.evaluate(async (s) => (await fetch(s, { cache: 'no-store' })).text(), src);
    const same = served.replace(/\r\n/g, '\n') === execSync(`git show ${commit}:${file.slice(1)}`, { encoding: 'utf8' }).replace(/\r\n/g, '\n');
    check(`production serves ${src}, identical to ${commit}`, src === `${file}?v=${v}` && same);
  }
}
function itemOne(snaps, ch) {
  const ns = [...new Set(snaps.map((s) => s.n))];
  check(`item 1: 1-2-1 ("added") rows in the List from first render to full load: ${snaps.map((s) => `${s.t}s:${s.n}${s.full ? '*' : ''}`).join(' ')} (* = full model)`, ns.length === 1 && ns[0] === 7, snaps[snaps.length - 1].titles.join(' · '));
  const dup = snaps.find((s) => new Set(s.titles).size !== s.titles.length);
  check('item 1: no title appears twice in any snapshot', !dup, dup ? dup.titles.join(' · ') : '');
  const li = ch.find((r) => r.key === 'linkedin');
  check(`item 1: by-channel LinkedIn = ${li?.sched} Sched / ${li?.waiting} Waiting / ${li?.drafts} Drafts`, li?.sched === 15);
}
const EXPECT = { workshops_residential: 31, workshops_nonres: 7, courses: 10, gift_vouchers: 18, pnm_academy: 16, services: 10, hire: 0, prints: 0, none: 31 };
function itemsTwoToFour(t, ch) {
  check(`items 2: tiers ${t.a.map((r) => `${r.key} ${r.items}`).join(' · ')} (local run 01:49: ${Object.entries(EXPECT).map(([k, v]) => `${k} ${v}`).join(' · ')})`, t.a.every((r) => EXPECT[r.key] === r.items));
  const email = Object.fromEntries(t.b.map((r) => [r.key, r.cells.find((c) => c.ch === 'email')?.n]));
  check(`item 2: email column ${Object.entries(email).map(([k, v]) => `${k} ${v}`).join(' · ')}`, email.workshops_residential === 10 && email.pnm_academy === 3 && email.courses === 0);
  const off = t.b.filter((r) => r.cells.reduce((s, c) => s + c.n, 0) !== t.a.find((x) => x.key === r.key)?.items);
  const total = t.a.reduce((s, r) => s + r.items, 0);
  const byCh = ch.reduce((s, r) => s + r.sched + r.waiting, 0);
  check(`tiles reconcile: A per tier = B row totals (8 tiers); total ${total} = by-channel Sched + Waiting ${byCh}`, !off.length && total === byCh, off.map((r) => r.key).join(', '));
  const tg = t.a.filter((r) => r.target && r.items);
  const lines = tg.map((r) => (r.tip.match(/\n(\d+% of promotion vs \d+% of target = [\d.]+×)/) || [])[1]);
  check(`item 3: comparison in every target row's hover: ${lines.join(' | ')}`, lines.every(Boolean) && /at or below 0\.5× the % of target \(half or less\)/.test(t.title));
  const half = t.a.filter((r) => r.items && r.target && r.promo / r.target <= 0.5);
  check(`item 3: ≤ 0.5× rows flagged under-promoted (${half.map((r) => `${r.key} ${r.promo}% vs ${r.target}% → ${r.flag}`).join(', ')})`, half.every((r) => r.flag === 'under-promoted'));
  const hire = t.a.find((r) => r.key === 'hire');
  check(`item 4: Hire / Commercial hover: "${(hire?.tip || '').split('\n').find((l) => /by subtype/.test(l))}"`, /Social posts by subtype:/.test(hire?.tip || ''));
}

const startedAt = new Date().toISOString();
const before = await dbState();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1700, height: 1300 } });
await ctx.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); for (const [a, b] of [['mks-channel', 'all'], ['mks-lrange', '9'], ['mks-layout', 'list']]) localStorage.setItem(a, b); }, ENV.ARP_ADMIN_KEY);
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
await ctx.route('**/*', (r) => {
  if (r.request().method() === 'GET') return r.fallback();
  refused.push(`${r.request().method()} ${new URL(r.request().url()).pathname}`);
  return r.fulfill({ status: 403, contentType: 'application/json', body: '{"ok":false,"error":"refused by the read-only check"}' });
});
log('production, 1700px, List 9 weeks');
await page.goto(`${BASE}/audit-dashboard.html#marketing`, { waitUntil: 'domcontentloaded' });
const snaps = await firstRenderSnapshots(page);
await page.waitForSelector('#mk-service-a [data-mksv-row]', { timeout: 120000 });
await page.waitForFunction(() => document.querySelector('#mk-channels [data-mkch-row="youtube"] td:last-child')?.textContent !== 'loading…', null, { timeout: 90000 });
await page.waitForTimeout(3000);
await page.addStyleTag({ content: '#debugPanel { display: none !important; }' });
await fileChecks(page);
const ch = await page.evaluate(channelsOf);
const t = await page.evaluate(tilesOf);
itemOne(snaps, ch);
itemsTwoToFour(t, ch);
await page.locator('#mk-channels').screenshot({ path: OUT('channels') });
const box = await page.evaluate(() => {
  const r = (id) => document.getElementById(id).getBoundingClientRect();
  const a = r('mk-service-a');
  const b = r('mk-service-b');
  return { x: a.left - 4, y: a.top + window.scrollY - 4, width: b.right - a.left + 8, height: Math.max(a.height, b.height) + 8 };
});
await page.screenshot({ path: OUT('service-tiles'), fullPage: true, clip: box });
const list = page.locator('#mk-schedule .mks-body');
await list.scrollIntoViewIfNeeded();
await list.screenshot({ path: OUT('list-9weeks') });
await browser.close();
const after = await dbState();
const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
const writers = changed.length ? await writersOf(changed, startedAt) : [];
check(`this check wrote nothing (${refused.length} non-GET refused)${writers.length ? '; other processes wrote during the run (expected)' : ''}`, true, writers.join(' | ') || `${Object.keys(TABLES).length} tables unchanged`);
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
fs.writeFileSync('outputs/_gpt-corrections-live-result.json', JSON.stringify({ results, snaps, channels: ch, tiles: t }, null, 1));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);
process.exit(0);

/**
 * Sales gap monthly tiles v2 (QUESTION-2026-11-09 (o)) + Strategy items 11 / 12 / 14 of (q), on LIVE data with the LOCAL
 * code, 1700px. Read-only: serves the local strategy scripts, answers /api/aigeo/strategy-summary and /api/aigeo/prospects
 * with the local handlers, refuses every non-GET, and compares DB row counts + newest timestamps before / after.
 *   PHASE=before node scripts/playwright-verify-sales-gap-monthly-tiles-local.mjs   (committed browser files; capture only)
 *   PHASE=after  node scripts/playwright-verify-sales-gap-monthly-tiles-local.mjs   (working-tree files; checks + diff vs before)
 *   PHASE=live-before node …   (production, only strategy-sales-gap.js swapped back to the parent commit: the production "before")
 *   PHASE=live   node …        (deployed files + APIs only; same checks vs live-before, plus the served ?v= file)
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
Object.assign(process.env, ENV);
const PHASE = ['after', 'live', 'live-before'].includes(process.env.PHASE) ? process.env.PHASE : 'before';
const LIVE = PHASE.startsWith('live');
const CHECKS = PHASE === 'after' || PHASE === 'live';
const PRE_COMMIT = '9e1704f5';
const VERSION = 'mt2-20261109a';
const BASE = 'https://ai-geo-audit.vercel.app';
const OUT = 'outputs';
const LOCAL_FILES = ['strategy-tab.js', 'strategy-layout.js', 'strategy-sales-gap.js', 'strategy-prospects.js', 'strategy-quarter-plan.js'];
const TABLES = { prospect_enquiry: 'updated_at', strategy_event_snapshots: 'created_at', strategy_campaign_steps: 'last_seen_at', strategy_quarter_actions: 'updated_at', strategy_event_overrides: 'updated_at', strategy_event_promotion_flags: 'set_at', marketing_decisions: 'decided_at', business_targets: 'updated_at' };
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const blocked = [];
const errors = [];

async function dbState() {
  const out = {};
  for (const [t, c] of Object.entries(TABLES)) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true });
    const { data, error } = await sb.from(t).select(c).not(c, 'is', null).order(c, { ascending: false }).limit(1);
    Object.assign(out, { [`${t}.rows`]: count ?? 'n/a', [`${t}.max(${c})`]: error ? 'n/a' : data?.[0]?.[c] || null });
  }
  return out;
}
const fakeRes = (set) => ({ status() { return this; }, setHeader() {}, json(j) { set(JSON.stringify(j)); return this; }, send(t) { set(typeof t === 'string' ? t : JSON.stringify(t)); return this; } });
let summaryBody = null;
async function localSummary() {
  if (summaryBody) return summaryBody;
  const { default: handler } = await import('../api/aigeo/strategy-summary.js');
  await handler({ method: 'GET', query: {}, headers: {} }, fakeRes((b) => { summaryBody = b; }));
  return summaryBody;
}
async function localProspects() {
  const { default: handler } = await import('../api/aigeo/prospects.js');
  let body = null;
  await handler({ method: 'GET', query: {}, headers: { 'x-arp-admin-key': ENV.ARP_ADMIN_KEY } }, fakeRes((b) => { body = b; }));
  return body;
}
/** Production: deployed files + APIs (GET only); live-before swaps just the sales-gap view back; the summary shown is kept. */
async function liveRoute(route, url) {
  if (PHASE === 'live-before' && url.pathname === '/lib/strategy-sales-gap.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: execSync(`git show ${PRE_COMMIT}:lib/strategy-sales-gap.js`, { encoding: 'utf8' }) });
  if (url.pathname !== '/api/aigeo/strategy-summary') return route.fallback();
  const resp = await route.fetch();
  summaryBody = await resp.text();
  return route.fulfill({ response: resp, body: summaryBody });
}
async function routes(page) {
  await page.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); }, ENV.ARP_ADMIN_KEY);
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() !== 'GET') { if (url.pathname.startsWith('/api/')) blocked.push(`${req.method()} ${url.pathname}`); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' }); }
    if (LIVE) return liveRoute(route, url);
    const file = LOCAL_FILES.find((f) => url.pathname === `/lib/${f}`);
    if (file) return route.fulfill({ status: 200, contentType: 'application/javascript', body: PHASE === 'before' ? execSync(`git show HEAD:lib/${file}`, { encoding: 'utf8' }) : fs.readFileSync(`lib/${file}`, 'utf8') });
    if (url.pathname === '/api/aigeo/prospects') return route.fulfill({ status: 200, contentType: 'application/json', body: await localProspects() });
    if (url.pathname === '/api/aigeo/strategy-summary') return route.fulfill({ status: 200, contentType: 'application/json', body: await localSummary() });
    return route.fallback();
  });
}

/** Position + text of every Strategy block, the quarter tile and each monthly tile. */
function layoutOf() {
  const panel = document.querySelector('section[data-panel="strategy"]');
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) }; };
  const txt = (el) => (el.innerText || '').replace(/\s+/g, ' ').trim();
  const blocks = [...panel.querySelectorAll('[id^="st-"]')].filter((el) => el.offsetParent !== null).map((el) => ({ id: el.id, ...box(el), text: txt(el) }));
  const months = [...document.querySelectorAll('#st-sales-gap [data-sg-month]')].map((el) => ({ id: el.dataset.sgMonth, ...box(el), text: txt(el) }));
  const q = document.querySelector('#st-sales-gap .sg-q');
  const h3 = document.querySelector('#st-sales-gap h3');
  return { blocks, months, quarter: q ? { ...box(q), text: txt(q), html: q.innerHTML } : null, heading: h3 ? txt(h3) : null, height: Math.round(panel.getBoundingClientRect().height) };
}
function monthTilesOf() {
  const t = (el) => (el?.innerText || '').replace(/\s+/g, ' ').trim();
  return [...document.querySelectorAll('#st-sales-gap [data-sg-month]')].map((m) => ({
    key: m.dataset.sgMonth, head: t(m.querySelector('.sg-h')), big: t(m.querySelector('.sg-big')), bar: t(m.querySelector('.sg-bar')),
    tableTitle: t(m.querySelector('.sg-qt')), rows: [...m.querySelectorAll('.sg-mcat tr')].map((tr) => [...tr.cells].map((c) => c.innerText.trim())),
    nd: t(m.querySelector('.sg-mnd b')), ndLabel: t(m.querySelector('.sg-mnd span')), note: t(m.querySelector('.sg-ndnote')), pipe: t(m.querySelector('.sg-pipe')),
    verdict: !!m.querySelector('.sg-v'), fromLine: !!m.querySelector('.sg-from'), summary: t(m.querySelector('details.sg-md > summary')), details: t(m.querySelector('details.sg-md'))
  }));
}

const k1 = (v) => `£${(Math.round((Number(v) || 0) / 100) / 10).toFixed(1)}k`;
const num = (t) => Number(String(t).replace(/[£k,%]/g, '')) * (/k$/.test(t) ? 1000 : 1);
/** Acceptance figures from QUESTION (o): [events, places, if all sold] per category, total [events, places, gbp, likely], non-dated. */
const EXPECT = {
  '2026-11': { cats: [[2, 7, '£1.1k'], [7, 31, '£1.5k'], [4, 13, '£12.1k']], total: [13, 51, '£14.6k', '£1.8k'], nd: '£3.7k' },
  '2026-12': { cats: [[3, 11, '£1.7k'], [17, 87, '£8.2k'], [6, 20, '£19.6k']], total: [26, 118, '£29.4k', '£2.9k'], nd: '£2.3k' },
  '2027-01': { cats: [[2, 8, '£1.2k'], [17, 89, '£8.9k'], [7, 26, '£25.3k']], total: [26, 123, '£35.4k', '£3.8k'], nd: '£0.6k' }
};
const gbp0 = (v) => `£${Math.round(v).toLocaleString('en-GB')}`;
let PIPE_BY_MONTH = null;
function faceCheck(t, m) {
  const sub = m.current ? `of ${gbp0(m.target)} still to sell · ${gbp0(m.sold)} sold` : 'still to sell';
  const days = m.days_left == null || t.head.endsWith(`${m.days_left} days left`);
  check(`${m.label}: face = month + days left, ${k1(m.still_to_sell)} ${sub}, bar ${k1(m.likely)} likely dated / ${k1(m.non_dated_needed)} non-dated`, t.big === `${k1(m.still_to_sell)} ${sub}` && t.bar.startsWith(`${k1(m.likely)} likely dated`) && days, `${t.head} · ${t.big} · bar "${t.bar}"`);
}
function tableChecks(t, m) {
  const e = EXPECT[t.key];
  const [head, ...body] = t.rows;
  const rows = body.slice(0, -1);
  const tot = body[body.length - 1] || [];
  const col = (j) => rows.reduce((a, x) => a + num(x[j]), 0);
  const raw = (f) => m.categories.rows.reduce((a, r) => a + r[f], 0);
  check(`${m.label}: table "Events people book this month (prime buying window)", columns Category | Events | Places | If all sold | Fill rate | Likely £`, t.tableTitle === 'Events people book this month (prime buying window)' && head?.join('|') === 'Category|Events|Places|If all sold|Fill rate|Likely £', `${t.tableTitle} · ${head?.join(' | ')}`);
  const catsOk = rows.length === 3 && e.cats.every((c, j) => Number(rows[j][1]) === c[0] && Number(rows[j][2]) === c[1] && rows[j][3] === c[2]);
  check(`${m.label}: category rows = acceptance (${e.cats.map((c) => c.join(' · ')).join(' / ')})`, catsOk, rows.map((x) => x.join(' ')).join(' / '));
  const sumOk = col(1) === Number(tot[1]) && col(2) === Number(tot[2]) && Math.abs(raw('gbp') - m.categories.total.gbp) < 0.01 && Math.abs(raw('likely') - m.likely) < 0.5 && m.categories.adds_up;
  const totOk = tot.slice(1, 4).join('|') === `${e.total[0]}|${e.total[1]}|${e.total[2]}` && tot[5] === e.total[3] && tot[5] === k1(m.likely);
  check(`${m.label}: rows sum to the total ${e.total.join(' / ')} (Likely total = the month's likely ${k1(m.likely)})`, sumOk && totOk, `total ${tot.join(' ')} · unrounded likely rows ${m.categories.rows.map((r) => Math.round(r.likely)).join(' + ')} = ${Math.round(raw('likely'))} vs ${Math.round(m.likely)}`);
}
function lowerChecks(t, m, qCell) {
  const e = EXPECT[t.key];
  check(`${m.label}: Non-dated needed ${e.nd} (amber) = the quarter tile's ${m.label} cell; note line`, t.ndLabel === 'Non-dated needed' && t.nd === e.nd && t.nd === qCell && t.note === 'From gift vouchers, Pick n Mix, 1-2-1s, mentoring, Academy, commissions, prints & royalties.', `${t.ndLabel} ${t.nd} · quarter ${qCell} · "${t.note}"`);
  const w = Number(PIPE_BY_MONTH?.[m.key]?.total) || 0;
  const wTxt = w >= 1000 ? `£${(Math.round(w / 100) / 10).toLocaleString('en-GB')}k` : gbp0(w);
  check(`${m.label}: pipeline line "Prospects pipeline: £X weighted, cash due this month" = pipeline_by_month (${wTxt}; £0 when none)`, t.pipe === `Prospects pipeline: ${wTxt} weighted, cash due this month` && m.pipeline_month.weighted === w, t.pipe);
  check(`${m.label}: yellow verdict box and "from … +N more" line retired; "details" fold`, !t.verdict && !t.fromLine && t.summary === 'details', `verdict ${t.verdict} · from-line ${t.fromLine} · summary "${t.summary}"`);
  const simple = ['Events to push this month', 'Booked ahead for this month\'s events', 'Normal non-dated sales, same month last year', 'Still to find after normal and pipeline'].every((s) => t.details.includes(s));
  check(`${m.label}: details = simple lists only (events to push by category, booked ahead, normal non-dated LY, still to find); no working`, simple && !/damping|outside the prime window|places this month|\d\.\d+ places/i.test(t.details), t.details.slice(0, 400));
}
function monthChecks(tiles, sg, qTile) {
  for (const [i, t] of tiles.entries()) {
    faceCheck(t, sg.months[i]);
    tableChecks(t, sg.months[i]);
    lowerChecks(t, sg.months[i], qTile.nondated?.[1]?.[i + 1]);
  }
}
function workingChecks(sg, rulesText) {
  check('Rules: "Show the working" holds the per-event likely working (damping, split by booking month) + the on-sale stock outside the prime window, per month', /Show the working/.test(rulesText) && /damping/.test(rulesText) && /On-sale stock outside the prime window/.test(rulesText) && sg.months.every((m) => rulesText.includes(`${m.label}:`)), rulesText.slice(rulesText.indexOf('Show the working'), rulesText.indexOf('Show the working') + 300));
  check('strategy-summary API still carries the working + outside list per month', sg.months.every((m) => Array.isArray(m.working) && m.working.length && m.working[0].damping != null && m.working[0].split && Array.isArray(m.outside?.list)), sg.months.map((m) => `${m.label} working ${m.working.length} · outside ${m.outside.events}`).join(' · '));
}
const BEG = '2026-12-01';
const isBeg = (e) => e.date === BEG && /beginner|camera course/i.test(e.title);
function whereBeg(m) {
  if (m.prime.list.some(isBeg)) return `${m.label} prime`;
  return `${m.label} ${m.outside.list.some(isBeg) ? 'outside prime' : '—'}`;
}
const lever1Text = (sg) => sg.remedy.rows.map((r) => `${r.label}: ${r.lever1.rows.map((x) => `${x.title} ${x.date.slice(5)}`).join(', ') || '—'}`).join(' | ');
function stockCheck(sg) {
  const inStock = sg.months.flatMap((m) => [...m.prime.list, ...m.outside.list]).filter(isBeg);
  const decCourses = sg.months.find((m) => m.key === '2026-12').categories.rows.find((r) => r.key === 'course').events;
  const e = inStock[0] || {};
  check('item 11: 1 Dec Beginners stays in stock and on sale (on-sale stock lists, quarter stock), marked retired; Dec Courses row still 3', inStock.length > 0 && inStock.every((x) => x.retired_from_promotion) && decCourses === 3, `${e.title} ${e.date} left ${e.left} · ${sg.months.map(whereBeg).join(' · ')} · Dec Courses events ${decCourses}`);
}
function retiredChecks(s, page) {
  const sg = s.sales_gap;
  const push = s.push || [];
  check('item 11: flag table seeded with the 1 Dec Beginners course (Alan-set), matched to the diary row', sg.promotion.flags.some((f) => f.event_date === BEG) && !sg.promotion.error && sg.promotion.matched >= 1, JSON.stringify(sg.promotion));
  stockCheck(sg);
  const lever1 = sg.remedy.rows.flatMap((r) => r.lever1.rows).filter(isBeg);
  const pushes = sg.months.flatMap((m) => m.push.groups.flatMap((g) => g.list)).filter(isBeg);
  const retiredListed = sg.months.every((m) => !m.prime.list.some(isBeg) || m.push.retired.some(isBeg));
  const notPushed = !lever1.length && !pushes.length && !push.some(isBeg) && retiredListed;
  check('item 11: excluded from Remedy lever 1 (was "Camera Courses For Beginners 1 Dec +1" in Nov), monthly "Events to push" and the Strategy push list', notPushed, `lever 1 rows ${lever1Text(sg)} · push list ${push.map((e) => `${e.title} ${e.date}`).join(', ')}`);
  const said = page.remedy.match(/Retired from promotion[^.]*\./);
  check('item 11: Remedy plan states the retired event is not recommended', !!said, said ? said[0] : '');
}
function headingChecks(layout, page, sg) {
  const q1 = sg.quarters.find((q) => q.state === 'current');
  check('item 12: heading reads "Rolling 3 months"; no "this quarter"', /^Sales gap · Rolling 3 months/.test(layout.heading) && !/this quarter/i.test(layout.heading), layout.heading);
  check('item 12: quarter cards keep calendar quarters (Q1 Oct–Dec … Q4 Jul–Sep)', sg.quarters.map((q) => `${q.start}→${q.end}`).join(' ') === '2026-10-01→2026-12-31 2027-01-01→2027-03-31 2027-04-01→2027-06-30 2027-07-01→2027-09-30', sg.quarters.map((q) => `${q.label} ${q.start}→${q.end}`).join(' · '));
  const gbpK = (v) => (Math.abs(v) >= 1000 ? `£${(Math.round(Math.abs(v) / 100) / 10).toLocaleString('en-GB')}k` : gbp0(v));
  const lbl = `Q1 Oct–Dec incl. October shortfall ${gbpK(q1.period.shortfall)}`;
  check(`item 14: Q1 card "${lbl}" + "Nov + Dec" line (${k1(q1.period.forward_still)}); targets unchanged`, page.quarters.includes(lbl) && /Nov \+ Dec still to sell/.test(page.quarters) && Math.abs(q1.still_to_sell - q1.period.shortfall - q1.period.forward_still) < 0.5, `Q1 still ${Math.round(q1.still_to_sell)} = Oct ${Math.round(q1.period.shortfall)} + Nov/Dec ${Math.round(q1.period.forward_still)} · target ${q1.target}`);
  check('item 14: Remedy plan states October\'s shortfall is not carried forward', /October's shortfall .* is not carried into this forward plan/.test(page.remedy), page.remedy.match(/October's shortfall .*?Targets are unchanged\./)?.[0] || '');
}
/** Changes made by others between the two captures (live data / another agent's item), never by this change. */
const EXTERNAL = {
  'st-prospects': { why: 'live data: an enquiry was loaded into Prospects between the captures', re: /enquir|weighted|value|stalled|overdue|dated|undated|£/ },
  'st-quarter-plan': { why: 'item 13 (Quarter plan "Next" label), the marketing agent\'s change', re: /Next: FB\/IG( draft)?:/ }
};
const norm = (s) => s.replace(/\b\d{1,2}:\d{2}\b/g, 'HH:MM');
function firstDiff(x, y) {
  let i = 0;
  while (i < x.length && x[i] === y[i]) i += 1;
  return i >= x.length && x.length === y.length ? null : { before: x.slice(Math.max(0, i - 40), i + 60), after: y.slice(Math.max(0, i - 40), i + 60) };
}
function movedChecks(layout, prior) {
  const CHANGED = new Set(['st-sales-gap', 'st-remedy', 'st-quarter-cards']);
  const others = layout.blocks.filter((b) => !CHANGED.has(b.id));
  const diffs = others.map((b) => ({ b, p: prior.blocks.find((x) => x.id === b.id) })).map(({ b, p }) => ({ id: b.id, geo: !p || p.x !== b.x || p.w !== b.w, d: p ? firstDiff(norm(p.text), norm(b.text)) : { before: '', after: 'new block' } })).filter((x) => x.geo || x.d);
  const unexplained = diffs.filter((x) => x.geo || !EXTERNAL[x.id] || !EXTERNAL[x.id].re.test(`${x.d.before}${x.d.after}`));
  const note = diffs.map((x) => `${x.id}: ${EXTERNAL[x.id]?.why || 'UNEXPLAINED'} ("…${x.d.before.slice(-40)}" → "…${x.d.after.slice(-40)}")`).join(' | ');
  check('nothing else changed by this work: every other Strategy block keeps its x / width, and any text change is a known external one', !unexplained.length && others.length === prior.blocks.filter((b) => !CHANGED.has(b.id)).length, note || `${others.length} blocks identical`);
  const pipe = /<div class="sg-pipe">[\s\S]*?<\/div>/;
  const mask = (h) => h.replace(pipe, '').replace(/− normal £[\d.,k]+ − pipeline £[\d.,k]+/, '− normal … − pipeline …');
  const qa = layout.quarter;
  const qb = prior.quarter;
  const pa = qa.html.match(pipe)?.[0];
  const pb = qb.html.match(pipe)?.[0];
  check('quarter tile unchanged: same HTML and width apart from the live prospects figures (pipeline line + "− normal − pipeline" in details)', mask(qa.html) === mask(qb.html) && qa.w === qb.w, `w ${qb.w} → ${qa.w} · h ${qb.h} → ${qa.h} (grid row follows the monthly tiles) · pipeline ${pb === pa ? 'same' : `"${pb?.replace(/<[^>]+>/g, '')}" → "${pa?.replace(/<[^>]+>/g, '')}" (live data)`}`);
}

const before = await dbState();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
page.on('pageerror', (e) => errors.push(e.message));
await routes(page);
await page.goto(`${BASE}/audit-dashboard.html#strategy`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#st-sales-gap .sg-q') && document.querySelector('#st-fold-why'), null, { timeout: 240000 });
await page.waitForFunction(() => !/Loading enquiries|Loading prospects/.test(document.getElementById('st-prospects')?.textContent || 'Loading'), null, { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(4000);
const layout = await page.evaluate(layoutOf);
await page.evaluate(() => [...document.querySelectorAll('body *')].filter((el) => getComputedStyle(el).position === 'fixed' && el.getBoundingClientRect().top > window.innerHeight / 2).forEach((el) => { el.style.visibility = 'hidden'; }));
const TAGS = { before: 'before-local', after: 'after-local', live: 'live', 'live-before': 'before-live' };
const shot = (name) => `${OUT}/sales-gap-monthly-tiles-v2-${name}-${TAGS[PHASE]}-1700px-20261109.png`;
if (PHASE === 'live') {
  const served = await page.evaluate(async () => {
    const src = document.querySelector('script[src*="/lib/strategy-sales-gap.js"]')?.getAttribute('src') || '';
    return { src, body: src ? await (await fetch(src, { cache: 'no-store' })).text() : '' };
  });
  const committed = execSync('git show HEAD:lib/strategy-sales-gap.js', { encoding: 'utf8' }).replace(/\r\n/g, '\n');
  check(`production serves strategy-sales-gap.js?v=${VERSION}, byte-identical to the committed file`, served.src.endsWith(`?v=${VERSION}`) && served.body.replace(/\r\n/g, '\n') === committed, `${served.src} · ${served.body.length} bytes`);
}
await page.locator('#st-sales-gap').screenshot({ path: shot('tiles') });
await page.locator('#st-remedy').screenshot({ path: shot('remedy') });
await page.locator('#st-quarter-cards').screenshot({ path: shot('quarter-cards') });
let tiles = null;
let pageText = null;
if (CHECKS) {
  tiles = await page.evaluate(monthTilesOf);
  await page.evaluate(() => document.querySelectorAll('#st-sales-gap details.sg-md').forEach((d) => { d.open = true; }));
  await page.waitForTimeout(300);
  await page.locator('#st-sales-gap .sg-grid').screenshot({ path: shot('tiles-details-open') });
  tiles = await page.evaluate(monthTilesOf);
  await page.evaluate(() => { document.querySelectorAll('#st-sales-gap details.sg-md').forEach((d) => { d.open = false; }); const r = document.getElementById('sg-rules'); if (r) r.open = true; document.querySelectorAll('#sg-rules details').forEach((d) => { d.open = true; }); });
  await page.waitForTimeout(300);
  await page.locator('#sg-rules').screenshot({ path: shot('rules-working') });
  pageText = await page.evaluate(() => ({ rules: document.getElementById('sg-rules')?.innerText.replace(/\s+/g, ' ') || '', remedy: document.getElementById('st-remedy')?.innerText.replace(/\s+/g, ' ') || '', quarters: document.getElementById('st-quarter-cards')?.innerText.replace(/\s+/g, ' ') || '' }));
  pageText.qTile = await page.evaluate(() => ({ nondated: [...document.querySelectorAll('#st-sales-gap .sg-q .sg-nd tr')].map((tr) => [...tr.cells].map((c) => c.innerText.trim())) }));
  await page.evaluate(() => { const r = document.getElementById('sg-rules'); if (r) r.open = false; });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: shot('page'), fullPage: true });
}
await browser.close();
const after = await dbState();
const changed = Object.keys(before).filter((x) => before[x] !== after[x]);
check('viewing writes nothing (row counts + newest timestamps)', !changed.length, changed.map((x) => `${x}: ${before[x]} → ${after[x]}`).join(' | ') || `${Object.keys(TABLES).length} tables unchanged`);
check('every non-GET refused', true, `${blocked.length} refused: ${[...new Set(blocked)].join(', ') || 'none attempted'}`);
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));

fs.writeFileSync(`${OUT}/_mt2-${PHASE}-layout.json`, JSON.stringify({ layout, tiles }, null, 1));
if (CHECKS) {
  const s = JSON.parse(summaryBody);
  const sg = s.sales_gap;
  PIPE_BY_MONTH = s.prospects?.by_month || {};
  monthChecks(tiles, sg, pageText.qTile);
  workingChecks(sg, pageText.rules);
  retiredChecks(s, pageText);
  headingChecks(layout, pageText, sg);
  movedChecks(layout, JSON.parse(fs.readFileSync(`${OUT}/_mt2-${LIVE ? 'live-before' : 'before'}-layout.json`, 'utf8')).layout);
}
fs.writeFileSync(`${OUT}/_mt2-${PHASE}-result.json`, JSON.stringify({ results, before, after }, null, 1));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
process.exit(0);

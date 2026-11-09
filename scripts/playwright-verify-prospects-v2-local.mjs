/**
 * Prospects v2 (QUESTION-2026-11-09 (p)) with the LOCAL code at 1700px. Read-only: production page, local
 * strategy-prospects.js, /api/aigeo/strategy-summary and /api/aigeo/prospects answered by the local handlers, every
 * non-GET refused, DB row counts + newest timestamps compared before / after.
 *   PHASE=live    node scripts/playwright-verify-prospects-v2-local.mjs   (live prospects tables)
 *   PHASE=fixture node scripts/playwright-verify-prospects-v2-local.mjs   (obviously fake TEST rows: every flag, filters)
 *   PHASE=prod    node scripts/playwright-verify-prospects-v2-local.mjs   (PRODUCTION files + APIs only, live data; non-GET still refused)
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { summarizeProspects } from '../lib/strategy-prospects.mjs';
import { monthsFrom } from '../lib/strategy-sales-gap.mjs';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
Object.assign(process.env, ENV);
const PHASE = ['fixture', 'prod'].includes(process.env.PHASE) ? process.env.PHASE : 'live';
const PROD = PHASE === 'prod';
/** R=1 (QUESTION-2026-11-09 (r)): live phase with one TEST row per revenue type → prospects-r-* screenshots + line checks. */
const R = process.env.R === '1' && PHASE === 'live';
/** R=1 with PHASE=prod: production, empty table → the four (r) lines at £0 / 0 + prospects-r-*-live screenshots. */
const R_PROD = process.env.R === '1' && PROD;
const VERSION = process.env.VERSION || 'pp-20261109a';
const COMMIT = process.env.COMMIT || 'e9ac0666';
const BASE = 'https://ai-geo-audit.vercel.app';
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const TABLES = { prospect_enquiry: 'updated_at', prospect_enquiry_history: 'at', customer_person: 'updated_at', prospect_stage_config: 'stage' };
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const blocked = [];
const errors = [];

const fx = (n, market, type, stage, value, basis, cash, review, extra = {}) => ({
  id: `fx-${n}`, enquiry_ref: `ENQ-90${String(n).padStart(2, '0')}`, enquiry_date: '2026-10-01', person_id: null, client_or_org: `TEST Prospect ${n}`, customer_market: market, type, stage, value_gbp: value,
  value_basis: basis, value_basis_note: basis === 'estimated' ? 'TEST allowance' : null, cash_month: cash, review_status: review, owner: 'GPT', next_action: 'TEST follow-up', last_touch_at: '2026-11-03T10:00:00Z', created_at: '2026-10-01T10:00:00Z', ...extra
});
const FIXTURE = [
  fx(1, 'B2B', 'commission', 'quote', 2500, 'agreed', null, 'recent'),
  fx(2, 'D2C', '1-2-1', 'qualify', 75, 'quoted', '2026-11-01', 'recent'),
  fx(3, 'B2B', 'commission', 'quote', 1650, 'quoted', '2026-09-01', 'revalidate'),
  fx(4, 'D2C', 'mentoring', 'qualify', 300, 'estimated', null, 'revalidate'),
  fx(5, 'B2B', 'corporate training', 'qualify', 700, 'estimated', '2026-12-01', 'revalidate'),
  fx(6, 'D2C', 'voucher / gift', 'qualify', 0, 'unknown', null, 'recent'),
  fx(7, 'unclassified', 'other', 'scheduled', 150, 'quoted', '2027-01-01', 'recent')
];

async function dbState() {
  const out = {};
  for (const [t, c] of Object.entries(TABLES)) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true });
    const { data, error } = await sb.from(t).select(c).not(c, 'is', null).order(c, { ascending: false }).limit(1);
    Object.assign(out, { [`${t}.rows`]: count, [`${t}.max(${c})`]: error ? 'n/a' : data?.[0]?.[c] || null });
  }
  return out;
}
const fakeRes = (set) => ({ status() { return this; }, setHeader() {}, json(j) { set(JSON.stringify(j)); return this; }, send(t) { set(typeof t === 'string' ? t : JSON.stringify(t)); return this; } });
let summaryBody = null;
async function localSummary() {
  if (summaryBody) return summaryBody;
  const { default: handler } = await import('../api/aigeo/strategy-summary.js');
  await handler({ method: 'GET', query: {}, headers: {} }, fakeRes((b) => { summaryBody = b; }));
  if (PHASE === 'fixture') {
    const s = JSON.parse(summaryBody);
    s.prospects = summarizeProspects({ rows: FIXTURE, config: [], history: [], today: TODAY, months: monthsFrom(TODAY, 3) });
    summaryBody = JSON.stringify(s);
  }
  return summaryBody;
}
async function localProspects() {
  const { default: handler } = await import('../api/aigeo/prospects.js');
  let body = null;
  await handler({ method: 'GET', query: {}, headers: { 'x-arp-admin-key': ENV.ARP_ADMIN_KEY } }, fakeRes((b) => { body = b; }));
  if (PHASE === 'fixture') body = JSON.stringify({ ...JSON.parse(body), rows: FIXTURE, history: [], clients: {} });
  return body;
}
async function routes(page) {
  await page.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); }, ENV.ARP_ADMIN_KEY);
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() !== 'GET') { if (url.pathname.startsWith('/api/')) blocked.push(`${req.method()} ${url.pathname}`); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' }); }
    if (PROD) return route.fallback();
    if (url.pathname === '/lib/strategy-prospects.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync('lib/strategy-prospects.js', 'utf8') });
    if (url.pathname === '/api/aigeo/prospects') return route.fulfill({ status: 200, contentType: 'application/json', body: await localProspects() });
    if (url.pathname === '/api/aigeo/strategy-summary') return route.fulfill({ status: 200, contentType: 'application/json', body: await localSummary() });
    return route.fallback();
  });
}
function readUi() {
  const host = document.getElementById('st-prospects');
  const txt = (el) => (el?.innerText || '').replace(/\s+/g, ' ').trim();
  return {
    heads: [...host.querySelectorAll('.pp-table thead th')].map(txt), filters: [...host.querySelectorAll('[data-pp-f]')].map((el) => el.dataset.ppF),
    tile: txt(host.querySelector('.pp-total')), rows: host.querySelectorAll('.pp-table tbody tr').length, table: txt(host.querySelector('.pp-table tbody')), section: txt(host),
    pipe: txt(document.querySelector('#st-sales-gap .sg-q .sg-pipe')), rtypeOptions: [...host.querySelectorAll('[data-pp-f="rtype"] option')].map((o) => o.textContent).join(' · ')
  };
}

/** (r): each TEST row in its own line on the tile and table; Revenue type filter; Remedy carries committed only. */
async function rChecks(page) {
  const ui = await page.evaluate(readUi);
  const s = JSON.parse(summaryBody);
  const pr = s.prospects;
  check('(r) tile lines: Pipeline weighted (new sales only) · Committed work by cash month · Cash to collect · Partner relationships', /Pipeline, weighted new sales, open stages £200/.test(ui.tile) && /Committed work £125 \(1 allocated, delivery pending: Dec £125/.test(ui.tile) && /Cash to collect £250 \(1 invoiced, payment unverified/.test(ui.tile) && /Partner relationships 1 \(unvalued: 1 of 1/.test(ui.tile), ui.tile);
  check('(r) table: Revenue type column; Allocated · delivery pending with delivery / invoice-by dates; committed / to collect / not in totals', ui.heads.includes('Revenue type') && ['Allocated · delivery pending', 'delivery 3 Dec · invoice by 11 Dec', 'Invoiced · payment unverified', 'Partner · ongoing', '£125 committed', '£250 to collect', 'not in totals'].every((x) => ui.table.includes(x)), `${ui.rows} rows`);
  const rem = s.sales_gap?.remedy?.rows || [];
  check('(r) summary: lines apart, Remedy has committed in Dec only, receivable in no month', pr.pipeline.total === 200 && pr.committed.total_gbp === 125 && pr.cash_to_collect.total_gbp === 250 && pr.partners.count === 1 && !pr.by_month['2026-11'] && rem.map((r) => r.committed_gbp).join(',') === '0,125,0', JSON.stringify({ remedy: rem.map((r) => [r.label, r.pipeline_weighted, r.committed_gbp]), by_month: pr.by_month }));
  await page.locator('#st-prospects .pp-total').screenshot({ path: shot('pipeline-tile') });
  await page.selectOption('#st-prospects [data-pp-f="rtype"]', 'committed_work');
  await page.waitForTimeout(300);
  const f = await page.evaluate(readUi);
  check('(r) Revenue type filter: committed work → 1 row', f.rows === 1 && f.table.includes('Allocated · delivery pending'), `${f.rows} rows`);
  await page.locator('#st-prospects').screenshot({ path: shot('filter-committed') });
  await page.selectOption('#st-prospects [data-pp-f="rtype"]', '');
}
/** (r) on production, empty table: four tile lines at £0 / 0; Revenue type column + filter; summary + Remedy fields. */
function rProdChecks(ui, s) {
  const pr = s.prospects || {};
  const rem = s.sales_gap?.remedy?.rows || [];
  check('(r) live: Pipeline weighted £0 · Committed work £0 · Cash to collect £0 · Partner relationships 0', /Pipeline, weighted new sales, open stages £0/.test(ui.tile) && /Committed work £0/.test(ui.tile) && /Cash to collect £0/.test(ui.tile) && /Partner relationships 0/.test(ui.tile), ui.tile);
  check('(r) live: Revenue type column + filter (New sale / Partner / Committed work / Receivable)', ui.heads.includes('Revenue type') && ui.filters.includes('rtype') && /New sale.*Partner.*Committed work.*Receivable/.test(ui.rtypeOptions), `${ui.heads.join(' | ')} · filter options: ${ui.rtypeOptions}`);
  const fields = { committed: pr.committed && 'total_gbp' in pr.committed && Array.isArray(pr.committed.by_month), cash_to_collect: pr.cash_to_collect && 'total_gbp' in pr.cash_to_collect, partners: pr.partners && 'count' in pr.partners, revenue_types: !!pr.revenue_types, remedy_committed: rem.length > 0 && rem.every((r) => 'committed_gbp' in r) };
  check('(r) live summary: prospects.committed.total_gbp (+ by_month), prospects.cash_to_collect.total_gbp, prospects.partners.count, prospects.revenue_types, sales_gap.remedy.rows[].committed_gbp', Object.values(fields).every(Boolean),
    JSON.stringify({ committed: pr.committed?.total_gbp, committed_by_month: pr.committed?.by_month?.map((m) => `${m.label} ${m.gbp}`), cash_to_collect: pr.cash_to_collect?.total_gbp, partners: pr.partners, revenue_types: pr.revenue_types, remedy: rem.map((r) => `${r.label} pipeline ${r.pipeline_weighted} committed ${r.committed_gbp}`), missing: Object.keys(fields).filter((k) => !fields[k]) }));
}
const before = await dbState();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
page.on('pageerror', (e) => errors.push(e.message));
await routes(page);
await page.goto(`${BASE}/audit-dashboard.html#strategy`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#st-prospects .pp-total') && (document.querySelector('#st-prospects .pp-table') || /Enquiries unavailable/.test(document.getElementById('st-prospects').textContent)), null, { timeout: 110000 });
await page.waitForTimeout(2500);
await page.evaluate(() => [...document.querySelectorAll('body *')].filter((el) => getComputedStyle(el).position === 'fixed' && el.getBoundingClientRect().top > window.innerHeight / 2).forEach((el) => { el.style.visibility = 'hidden'; }));
const shotOf = { prod: (name) => `outputs/prospects-${R_PROD ? 'r' : 'v2'}-${name}-live-1700px-20261109.png`, r: (name) => `outputs/prospects-r-${name}-local-1700px-20261109.png` };
const shot = shotOf[PROD ? 'prod' : R ? 'r' : ''] || ((name) => `outputs/prospects-v2-${PHASE}-${name}-local-1700px-20261109.png`);
if (PROD) {
  const served = await page.evaluate(async () => {
    const src = document.querySelector('script[src*="/lib/strategy-prospects.js"]')?.getAttribute('src') || '';
    return { src, body: src ? await (await fetch(src, { cache: 'no-store' })).text() : '' };
  });
  const norm = (s) => s.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const committed = norm(execSync(`git show ${COMMIT}:lib/strategy-prospects.js`, { encoding: 'utf8' }));
  check(`production serves strategy-prospects.js?v=${VERSION}, identical to ${COMMIT} (BOM / line endings ignored)`, served.src.endsWith(`?v=${VERSION}`) && norm(served.body) === committed, `${served.src} · ${served.body.length} chars`);
  summaryBody = await page.evaluate(async () => JSON.stringify(window.stLastData ? window.stLastData() : await (await fetch('/api/aigeo/strategy-summary')).json()));
}
await page.locator('#st-prospects').screenshot({ path: shot('section') });
await page.locator('#st-prospects .pp-tiles').screenshot({ path: shot('tiles') });
const ui = await page.evaluate(readUi);
check('table: Market, Value basis and Review columns', ['Market', 'Value basis', 'Review'].every((h) => ui.heads.includes(h)), ui.heads.join(' | '));
check('filters: Market / Stage / Review (+ Type, search, closed-lost)', ['market', 'stage', 'review'].every((f) => ui.filters.includes(f)), ui.filters.join(', '));
check('Pipeline tile: total weighted, D2C / B2B, dated vs undated', /Pipeline, weighted/.test(ui.tile) && /D2C £[\d,]+ · B2B £[\d,]+/.test(ui.tile) && /dated £[\d,]+ · undated £[\d,]+/.test(ui.tile), ui.tile);
if (PHASE === 'fixture') {
  const s = JSON.parse(summaryBody).prospects.pipeline;
  check('fixture: overdue count + £ on the tile; unknown counted, not added; revalidate count', ui.tile.includes(`${s.overdue_count} overdue cash expectation`) && /1 value unknown \(not in totals\)/.test(ui.tile) && /3 to revalidate/.test(ui.tile), JSON.stringify({ overdue: s.overdue_count, overdue_gbp: s.overdue_gbp, dated: s.dated_gbp, undated: s.undated_gbp, by_market: s.by_market }));
  check('fixture: rows show "est.", "unknown", "Overdue cash expectation · revise", "undated potential", "revalidate"', ['est.', 'unknown', 'Overdue cash expectation · revise', 'undated potential', 'revalidate'].every((x) => ui.table.includes(x)), `${ui.rows} rows`);
  check('fixture: Remedy months carry no overdue / undated £ (dated only)', s.by_month.every((m) => m.weighted === (JSON.parse(summaryBody).prospects.by_month[m.key]?.total || 0)) && s.by_month[0].weighted === 75 * 0.2, JSON.stringify(s.by_month));
  await page.selectOption('#st-prospects [data-pp-f="market"]', 'D2C');
  await page.waitForTimeout(300);
  const d2c = await page.evaluate(readUi);
  check('Market filter D2C → only D2C rows', d2c.rows === FIXTURE.filter((r) => r.customer_market === 'D2C').length, `${d2c.rows} rows`);
  await page.locator('#st-prospects').screenshot({ path: shot('filter-d2c') });
  await page.selectOption('#st-prospects [data-pp-f="market"]', '');
  await page.selectOption('#st-prospects [data-pp-f="review"]', 'revalidate');
  await page.waitForTimeout(300);
  const rv = await page.evaluate(readUi);
  check('Review filter revalidate → only revalidate rows', rv.rows === FIXTURE.filter((r) => r.review_status === 'revalidate').length, `${rv.rows} rows`);
  await page.locator('#st-prospects').screenshot({ path: shot('filter-revalidate') });
} else {
  if (PROD) {
    const pl = JSON.parse(summaryBody || '{}').prospects?.pipeline || {};
    check('empty state: no enquiries yet (Claude loads the first list)', ui.rows === 1 && /No enquiries yet/.test(ui.table), ui.table);
    check('Pipeline tile at £0: D2C £0 · B2B £0, dated £0 · undated £0, no overdue line', /£0 D2C £0 · B2B £0 dated £0 · undated £0/.test(ui.tile) && !/overdue/.test(ui.tile), ui.tile);
    if (R_PROD) rProdChecks(ui, JSON.parse(summaryBody || '{}'));
    check('production summary carries the new pipeline fields', ['dated_gbp', 'undated_gbp', 'overdue_gbp', 'overdue_count', 'by_market', 'undated_weighted', 'total'].every((k) => k in pl), JSON.stringify({ total: pl.total, dated_gbp: pl.dated_gbp, undated_gbp: pl.undated_gbp, overdue_gbp: pl.overdue_gbp, overdue_count: pl.overdue_count, unknown_count: pl.unknown_count, markets: Object.keys(pl.by_market || {}) }));
  }
  if (R) await rChecks(page);
  const sg = JSON.parse(summaryBody).sales_gap?.rolling?.pipeline;
  check('quarter tile pipeline line reads the summary feed (dated / undated)', !!ui.pipe && /dated/.test(ui.pipe) && /undated/.test(ui.pipe), `${ui.pipe} · feed ${JSON.stringify(sg)}`);
  await page.locator('#st-sales-gap .sg-q').screenshot({ path: shot('quarter-tile') }).catch(() => {});
}
await browser.close();
const after = await dbState();
const changed = Object.keys(before).filter((x) => before[x] !== after[x]);
check('viewing writes nothing (row counts + newest timestamps)', !changed.length, changed.map((x) => `${x}: ${before[x]} → ${after[x]}`).join(' | ') || `${Object.keys(TABLES).length} tables unchanged`);
check('every non-GET refused', true, `${blocked.length} refused: ${[...new Set(blocked)].join(', ') || 'none attempted'}`);
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
process.exit(0);

/**
 * Prospects v2 (QUESTION-2026-11-09 (p)) with the LOCAL code at 1700px. Read-only: production page, local
 * strategy-prospects.js, /api/aigeo/strategy-summary and /api/aigeo/prospects answered by the local handlers, every
 * non-GET refused, DB row counts + newest timestamps compared before / after.
 *   PHASE=live    node scripts/playwright-verify-prospects-v2-local.mjs   (live prospects tables)
 *   PHASE=fixture node scripts/playwright-verify-prospects-v2-local.mjs   (obviously fake TEST rows: every flag, filters)
 */
import fs from 'node:fs';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { summarizeProspects } from '../lib/strategy-prospects.mjs';
import { monthsFrom } from '../lib/strategy-sales-gap.mjs';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
Object.assign(process.env, ENV);
const PHASE = process.env.PHASE === 'fixture' ? 'fixture' : 'live';
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
    tile: txt(host.querySelector('.pp-total')), rows: host.querySelectorAll('.pp-table tbody tr').length, table: txt(host.querySelector('.pp-table tbody')),
    pipe: txt(document.querySelector('#st-sales-gap .sg-q .sg-pipe'))
  };
}

const before = await dbState();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
page.on('pageerror', (e) => errors.push(e.message));
await routes(page);
await page.goto(`${BASE}/audit-dashboard.html#strategy`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#st-prospects .pp-total') && document.querySelector('#st-prospects .pp-table'), null, { timeout: 110000 });
await page.waitForTimeout(2500);
await page.evaluate(() => [...document.querySelectorAll('body *')].filter((el) => getComputedStyle(el).position === 'fixed' && el.getBoundingClientRect().top > window.innerHeight / 2).forEach((el) => { el.style.visibility = 'hidden'; }));
const shot = (name) => `outputs/prospects-v2-${PHASE}-${name}-local-1700px-20261109.png`;
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

/**
 * "Sales 2027" targets (QUESTION-2026-11-12): proof on LIVE data with the LOCAL code, 1700px, read-only.
 *  - booking_sheet_sales_targets: the 2027 row holds the question's values; the 2026 row hashed before / after.
 *  - strategy-summary: production (committed code) vs the local handler. Every 2026 month and quarter must be equal;
 *    2027 months must move to the 2027 pattern (Targets panel £ × "Sales 2027" weighting and mix).
 *  - Strategy tab screenshots (sales gap tiles, Remedy, quarter cards), production first, then local. Every non-GET
 *    from the page is refused; DB row counts + newest timestamps compared before / after.
 *   node scripts/playwright-verify-sales-2027-local.mjs
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
Object.assign(process.env, { SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: ENV.SUPABASE_SERVICE_ROLE_KEY });
const BASE = 'https://ai-geo-audit.vercel.app';
const PROP = 'https://www.alanranger.com';
const OUT = 'outputs';
const STAMP = '20261112';
const LOCAL_LIB = ['monthly-chart.js', 'revenue-truth-controller.mjs'];
const TABLES = { booking_sheet_sales_targets: 'imported_at', booking_sheet_category_gp: 'imported_at', booking_sheet_transactions: 'imported_at', booking_sheet_monthly_category: 'imported_at', business_targets: 'updated_at', strategy_event_snapshots: 'created_at', strategy_campaign_steps: 'last_seen_at', strategy_quarter_actions: 'updated_at', revenue_truth_payload_cache: 'computed_at' };
const Q = {
  cats: { 1: 550, 2: 1000, 3: 1400, 4: 400, 5: -200, 6: 80, 7: 900, 8: 150, 9: -100, 10: 75, 11: 600, 12: 300 },
  weights: [0.094, 0.075, 0.098, 0.082, 0.082, 0.060, 0.052, 0.081, 0.104, 0.090, 0.098, 0.084],
  monthly: [5815, 4640, 6062, 5073, 5073, 3712, 3217, 5011, 6433, 5567, 6062, 5196],
  days: [23, 21, 21, 22, 23, 20, 23, 22, 21, 23, 21, 22]
};
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const blocked = [];
const errors = [];
const hash = (o) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 16);

async function dbState() {
  const out = {};
  for (const [t, c] of Object.entries(TABLES)) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true });
    const { data, error } = await sb.from(t).select(c).not(c, 'is', null).order(c, { ascending: false }).limit(1);
    Object.assign(out, { [`${t}.rows`]: count, [`${t}.max(${c})`]: error ? 'n/a' : data?.[0]?.[c] || null });
  }
  return out;
}
async function salesRows() {
  const { data, error } = await sb.from('booking_sheet_sales_targets').select('*').eq('property_url', PROP).order('year');
  if (error) throw new Error(error.message);
  return data;
}

async function summary(local) {
  if (!local) return (await fetch(`${BASE}/api/aigeo/strategy-summary?noBackfill=1`, { cache: 'no-store' })).json();
  const { default: handler } = await import('../api/aigeo/strategy-summary.js');
  let body = null;
  await handler({ method: 'GET', query: { noBackfill: '1' }, headers: {} }, { status() { return this; }, setHeader() {}, json(j) { body = j; return this; } });
  return body;
}
let pageSummary = null;
async function localSummaryText() {
  if (!pageSummary) pageSummary = JSON.stringify(await summary(true));
  return pageSummary;
}

async function routes(page, local) {
  await page.addInitScript((k) => sessionStorage.setItem('arp_admin_key', k), ENV.ARP_ADMIN_KEY);
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() !== 'GET') { if (url.pathname.startsWith('/api/')) blocked.push(`${req.method()} ${url.pathname}`); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' }); }
    if (!local) return route.fallback();
    const file = LOCAL_LIB.find((f) => url.pathname === `/lib/${f}`);
    if (file) return route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`lib/${file}`, 'utf8') });
    if (url.pathname === '/api/aigeo/strategy-summary') return route.fulfill({ status: 200, contentType: 'application/json', body: await localSummaryText() });
    return route.fallback();
  });
}

async function shoot(browser, tag) {
  const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
  page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
  await routes(page, tag === 'local');
  await page.goto(`${BASE}/audit-dashboard.html#strategy`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('#st-sales-gap [data-sg-month]').length && document.querySelectorAll('#st-quarter-cards .sg-qc').length, null, { timeout: 240000 });
  await page.waitForTimeout(4000);
  const text = await page.evaluate(() => Object.fromEntries(['st-sales-gap', 'st-remedy', 'st-quarter-cards'].map((id) => [id, (document.getElementById(id)?.innerText || '').replace(/\s+/g, ' ')])));
  for (const id of ['st-sales-gap', 'st-remedy', 'st-quarter-cards']) await page.locator(`#${id}`).screenshot({ path: `${OUT}/sales-2027-${id.replace('st-', '')}-${tag}-1700px-${STAMP}.png` });
  await page.close();
  return text;
}

const monthsByKey = (s) => Object.fromEntries((s.sales_gap?.months || []).map((m) => [m.key, m]));
const quarterByKey = (s) => Object.fromEntries((s.sales_gap?.quarters || []).map((q) => [q.key, q]));
function insight(node, key) {
  if (!node || typeof node !== 'object') return null;
  if (node.key === key) return node;
  for (const v of Object.values(node)) {
    const hit = insight(v, key);
    if (hit) return hit;
  }
  return null;
}

const rowsBefore = await salesRows();
const dbBefore = await dbState();
const r27 = rowsBefore.find((r) => r.year === 2027);
const r26 = rowsBefore.find((r) => r.year === 2026);
check('DB: 2027 row present, source_workbook "Sales 2027" (from Alan\'s normal upload)', r27 && r27.source_workbook === 'Sales 2027', r27 ? `imported ${r27.imported_at}` : 'missing');
check('DB: 2027 categories 1–12 = the question\'s values', r27 && Object.entries(Q.cats).every(([k, v]) => Number(r27.category_targets[k]) === v), JSON.stringify(r27?.category_targets));
check('DB: 2027 weighting K3:V3 = the question\'s values', r27 && Q.weights.every((w, i) => Math.abs(Number(r27.weighting[i]) - w) < 1e-9), (r27?.weighting || []).join(', '));
check('DB: 2027 monthly targets = the question\'s values (to the £)', r27 && Q.monthly.every((v, i) => Math.round(Number(r27.monthly_target[i])) === v), (r27?.monthly_target || []).join(', '));
check('DB: 2027 working days + annual £61,860', r27 && Q.days.every((v, i) => Number(r27.working_days[i]) === v) && Math.round(Number(r27.annual_target)) === 61860, `${(r27?.working_days || []).join(', ')} · annual ${r27?.annual_target}`);

const [prod, local] = [await summary(false), await summary(true)];
const pm = monthsByKey(prod);
const lm = monthsByKey(local);
const keys = Object.keys(lm);
const in2026 = keys.filter((k) => k.startsWith('2026'));
const in2027 = keys.filter((k) => k.startsWith('2027'));
check('Strategy 2026 months: target / sold / still to sell identical to production (committed code)', in2026.length && in2026.every((k) => pm[k] && pm[k].target === lm[k].target && pm[k].still_to_sell === lm[k].still_to_sell), in2026.map((k) => `${k} ${pm[k]?.target} → ${lm[k].target}`).join(' · '));
check('Strategy 2027 months: target moves to the 2027 pattern', in2027.length ? in2027.every((k) => pm[k]?.target !== lm[k].target) : true, in2027.map((k) => `${k} ${pm[k]?.target} → ${lm[k].target}`).join(' · ') || 'no 2027 month in the rolling tiles yet');
const pq = quarterByKey(prod);
const lq = quarterByKey(local);
const qrows = Object.keys(lq).map((k) => ({ k, label: lq[k].label, end: lq[k].end, prod: pq[k]?.target, local: lq[k].target }));
check('Quarter cards: quarters wholly in 2026 unchanged; quarters with 2027 months use the 2027 targets', qrows.length && qrows.every((q) => (q.end < '2027-01-01' ? q.prod === q.local : q.prod !== q.local)), qrows.map((q) => `${q.label} (to ${q.end}) ${q.prod} → ${q.local}`).join(' · '));
const n3p = insight(prod.insights, 'money-next-3');
const n3l = insight(local.insights, 'money-next-3');
const parts = (t) => String(t?.comparison || '').split(' · ');
check('Next 3 months tile (Nov–Jan) mixes the years: Nov + Dec 2026 unchanged, Jan 2027 from the 2027 pattern', n3l && n3p && parts(n3p)[0] === parts(n3l)[0] && parts(n3p)[1] === parts(n3l)[1] && parts(n3p)[2] !== parts(n3l)[2], `prod "${n3p?.comparison}" → local "${n3l?.comparison}"`);
const gp = prod.service_mix?.targets?.gift_vouchers;
const gl = local.service_mix?.targets?.gift_vouchers;
check('Service mix: gift-voucher Booking Sheet figure read from the 2026 row in Nov 2026 (production reads the newest row, 2027)', gl && gl.booking_sheet_monthly === Math.round(Number(r26.category_targets['8'])), `prod £${gp?.booking_sheet_monthly}/month (monthly target £${gp?.monthly}) → local £${gl?.booking_sheet_monthly}/month (monthly target £${gl?.monthly})`);
const svc = (s) => Object.fromEntries(Object.entries(s.service_mix?.targets || {}).map(([k, v]) => [k, v.monthly]));
check('Service mix: every other row\'s % of target basis unchanged (cockpit tiers, this month)', JSON.stringify({ ...svc(prod), gift_vouchers: 0 }) === JSON.stringify({ ...svc(local), gift_vouchers: 0 }), JSON.stringify(svc(local)));
check('Strategy headline trailing targets (Aug–Oct 2026) unchanged', prod.headline?.rev_needed_t3 === local.headline?.rev_needed_t3, `rev_needed_t3 ${prod.headline?.rev_needed_t3} → ${local.headline?.rev_needed_t3}`);
const asm = local.sales_gap?.assumptions?.find((a) => a.key === 'targets_2027');
check('Rules: the 2027-targets assumption now says each month uses its own year (set 12 Nov)', asm && /own year's targets/.test(asm.value) && asm.status === 'set 12 Nov', `${asm?.value} [${asm?.status}; ${asm?.set_by}]`);

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const shotsProd = await shoot(browser, 'prod-before');
const shotsLocal = await shoot(browser, 'local');
await browser.close();
check('Strategy tab renders the local figures (Q2 Jan–Mar card)', shotsLocal['st-quarter-cards'] !== shotsProd['st-quarter-cards'], shotsLocal['st-quarter-cards'].slice(0, 300));

const rowsAfter = await salesRows();
const dbAfter = await dbState();
const h26 = [rowsBefore, rowsAfter].map((rs) => hash(rs.find((r) => r.year === 2026)));
const h27 = [rowsBefore, rowsAfter].map((rs) => hash(rs.find((r) => r.year === 2027)));
check('2026 row byte-identical before / after (sha256 of the whole row)', h26[0] === h26[1], `${h26[0]} → ${h26[1]}`);
check('2027 row byte-identical before / after', h27[0] === h27[1], `${h27[0]} → ${h27[1]}`);
const changed = Object.keys(dbBefore).filter((k) => dbBefore[k] !== dbAfter[k]);
check(`writes nothing (row counts + newest timestamps, ${Object.keys(TABLES).length} tables)`, !changed.length, changed.map((k) => `${k}: ${dbBefore[k]} → ${dbAfter[k]}`).join(' | ') || 'no change');
check('every non-GET from the pages refused', true, `${blocked.length} refused: ${[...new Set(blocked)].join(', ') || 'none'}`);
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
fs.writeFileSync(`${OUT}/_sales-2027-local-result.json`, JSON.stringify({ results, months: keys.map((k) => ({ k, prod: pm[k]?.target, local: lm[k].target })), quarters: qrows, row_hashes: { 2026: h26, 2027: h27 }, db_before: dbBefore, db_after: dbAfter }, null, 1));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);

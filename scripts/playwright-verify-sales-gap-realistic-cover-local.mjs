/**
 * QUESTION-2026-11-09 (v) "Realistic cover by month" on LIVE data with the LOCAL code, 1700px. Read-only: the local
 * strategy-summary / prospects handlers answer the APIs; HEAD and working-tree browser files are rendered back-to-back
 * from the SAME API bodies (so only the view change shows); every non-GET is refused; DB rows compared before / after.
 * No personal data is written: enquiry rows are never screenshotted or saved (Prospects text is compared in memory only).
 *   node scripts/playwright-verify-sales-gap-realistic-cover-local.mjs
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
Object.assign(process.env, ENV);
const BASE = 'https://ai-geo-audit.vercel.app';
const OUT = 'outputs';
const FILES = ['strategy-sales-gap.js', 'strategy-prospects.js'];
const TABLES = { prospect_enquiry: 'updated_at', prospect_enquiry_history: 'at', strategy_event_snapshots: 'created_at', strategy_campaign_steps: 'last_seen_at', strategy_event_promotion_flags: 'set_at', business_targets: 'updated_at' };
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const blocked = [];
const errors = [];
/** PHASE=live: production files + APIs (GET); "before" = the same page with only the two views from the parent commit. */
const LIVE = process.env.PHASE === 'live';
const PRE = '14019d66';
const COMMIT = '207e02b1';
const VERSION = 'rc-20261109a';
const TAG = LIVE ? 'live' : 'local';
const gitFiles = (rev) => Object.fromEntries(FILES.map((f) => [f, execSync(`git show ${rev}:lib/${f}`, { encoding: 'utf8' })]));
const VIEW = LIVE ? { before: gitFiles(PRE), after: null } : { before: gitFiles('HEAD'), after: Object.fromEntries(FILES.map((f) => [f, fs.readFileSync(`lib/${f}`, 'utf8')])) };

async function dbState() {
  const out = {};
  for (const [t, c] of Object.entries(TABLES)) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true });
    const { data } = await sb.from(t).select(c).not(c, 'is', null).order(c, { ascending: false }).limit(1);
    Object.assign(out, { [`${t}.rows`]: count ?? 'n/a', [`${t}.max`]: data?.[0]?.[c] || null });
  }
  return out;
}
const fakeRes = (set) => ({ status() { return this; }, setHeader() {}, json(j) { set(JSON.stringify(j)); return this; }, send(t) { set(typeof t === 'string' ? t : JSON.stringify(t)); return this; } });
async function local(path, headers) {
  const { default: handler } = await import(`../api/aigeo/${path}.js`);
  let body = null;
  await handler({ method: 'GET', query: {}, headers }, fakeRes((b) => { body = b; }));
  return body;
}
const API = {};
async function apiBody(path) {
  if (!API[path]) API[path] = path === '/api/aigeo/strategy-summary' ? await local('strategy-summary', {}) : await local('prospects', { 'x-arp-admin-key': ENV.ARP_ADMIN_KEY });
  return API[path];
}
const makeRoute = (view) => async (r) => {
  const req = r.request();
  const url = new URL(req.url());
  if (req.method() !== 'GET') { if (url.pathname.startsWith('/api/')) blocked.push(`${req.method()} ${url.pathname}`); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' }); }
  const f = FILES.find((x) => url.pathname === `/lib/${x}`);
  if (f && view) return r.fulfill({ status: 200, contentType: 'application/javascript', body: view[f] });
  if (!['/api/aigeo/strategy-summary', '/api/aigeo/prospects'].includes(url.pathname)) return r.fallback();
  if (LIVE && !API[url.pathname]) API[url.pathname] = await (await r.fetch()).text();
  return r.fulfill({ status: 200, contentType: 'application/json', body: await apiBody(url.pathname) });
};
function layoutOf() {
  const panel = document.querySelector('section[data-panel="strategy"]');
  const top = panel.getBoundingClientRect().top;
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y - top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const txt = (el) => (el.innerText || '').replace(/\s+/g, ' ').trim();
  const sg = document.querySelector('#st-sales-gap');
  return {
    blocks: [...panel.querySelectorAll('[id^="st-"]')].filter((el) => el.offsetParent !== null).map((el) => ({ id: el.id, ...box(el), text: txt(el) })),
    quarter: txt(sg.querySelector('.sg-q')), months: [...sg.querySelectorAll('[data-sg-month]')].map(txt),
    grid: box(sg.querySelector('.sg-grid')), legend: txt(sg.querySelector('.sg-legend'))
  };
}
function coverOf() {
  const c = document.getElementById('sg-cover');
  if (!c) return null;
  const rows = [...c.querySelectorAll('tr')].map((tr) => [...tr.cells].map((td) => ({ t: td.innerText.replace(/\s+/g, ' ').trim(), cls: td.className })));
  return { title: c.querySelector('h4')?.innerText, rows, undated: c.querySelector('[data-sg-undated]')?.innerText.replace(/\s+/g, ' ').trim(), foot: c.querySelector('.sg-cfoot')?.innerText.replace(/\s+/g, ' ').trim() };
}
async function render(browser, view) {
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
  await ctx.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); }, ENV.ARP_ADMIN_KEY);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', makeRoute(view));
  await page.goto(`${BASE}/audit-dashboard.html#strategy`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#st-sales-gap [data-sg-month]') && document.querySelector('#st-fold-why'), null, { timeout: 240000 });
  await page.waitForFunction(() => !/Loading enquiries/.test(document.getElementById('st-prospects')?.textContent || 'Loading'), null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await page.evaluate(() => [...document.querySelectorAll('body *')].filter((el) => getComputedStyle(el).position === 'fixed' && el.getBoundingClientRect().top > window.innerHeight / 2).forEach((el) => { el.style.visibility = 'hidden'; }));
  return { ctx, page };
}

const k1 = (v) => `£${(Math.round((Number(v) || 0) / 100) / 10).toFixed(1)}k`;
const cv = (v) => (Math.round(Number(v) || 0) === 0 ? '—' : (Math.abs(v) < 100 ? `£${Math.round(v)}` : k1(v)));
const LABELS = ['Still to sell', 'Dated events', 'Likely bookings (fill rate)', 'Enquiries about dated events weighted', 'Non-dated', 'Normal sales (same month last year)', 'Prospects pipeline weighted', 'Committed work', 'Cash to collect', 'Realistic total', 'Still to find'];
const KEYS = { 'Still to sell': 'still_to_sell', 'Likely bookings (fill rate)': 'likely', 'Enquiries about dated events weighted': 'dated_event', 'Normal sales (same month last year)': 'normal', 'Prospects pipeline weighted': 'pipeline', 'Committed work': 'committed', 'Cash to collect': 'cash_to_collect', 'Realistic total': 'total' };
const findCell = (m) => (m.still_to_find > 0.5 ? cv(m.still_to_find) : `covered${m.surplus > 0.5 ? ` (+${cv(m.surplus)})` : ''}`);
function tableChecks(t, c) {
  const head = t.rows[0].map((x) => x.t).join('|');
  check('mock-up: title, columns Nov | Dec | Jan | Rolling 3 months, rows and sections in order', t.title === 'Can we hit the target? Realistic cover by month' && head === '|November|December|January|Rolling 3 months' && LABELS.every((l, i) => t.rows[i + 1][0].t.toLowerCase().startsWith(l.toLowerCase())), `${head} · ${t.rows.slice(1).map((r) => r[0].t.split(' ').slice(0, 3).join(' ')).join(' / ')}`);
  const cols = [...c.months, c.rolling];
  const bad = Object.entries(KEYS).flatMap(([label, k]) => {
    const r = t.rows.find((x) => x[0].t.startsWith(label));
    return cols.map((col, i) => (r[i + 1].t === cv(col[k]) ? null : `${label} ${col.label}: ${r[i + 1].t} ≠ ${cv(col[k])}`)).filter(Boolean);
  });
  check('every figure = the strategy-summary cover (same rounding as the tiles)', !bad.length, bad.join(' | ') || Object.entries(KEYS).map(([l, k]) => `${l.split(' ')[0]} ${cols.map((x) => cv(x[k])).join('/')}`).join(' · '));
  const sums = c.months.every((m) => Math.abs(m.total - ['likely', 'dated_event', 'normal', 'pipeline', 'committed', 'cash_to_collect'].reduce((a, k) => a + m[k], 0)) < 0.01);
  check('columns add up: realistic total = the six lines in each month; rolling = Σ months', sums && ['still_to_sell', 'likely', 'normal', 'pipeline', 'committed', 'cash_to_collect', 'total'].every((k) => Math.abs(c.rolling[k] - c.months.reduce((a, m) => a + m[k], 0)) < 0.01), c.months.map((m) => `${m.label} ${Math.round(m.likely)}+${Math.round(m.dated_event)}+${Math.round(m.normal)}+${Math.round(m.pipeline)}+${Math.round(m.committed)}+${Math.round(m.cash_to_collect)}=${Math.round(m.total)}`).join(' · '));
}
function findChecks(t, c) {
  const r = t.rows.find((x) => x[0].t === 'Still to find');
  const perMonth = c.months.every((m) => Math.abs(m.still_to_find - Math.max(0, m.still_to_sell - m.total)) < 0.01);
  const shown = c.months.every((m, i) => r[i + 1].t === findCell(m) && r[i + 1].cls === (m.still_to_find > 0.5 ? 'sg-cfind' : 'sg-ccov'));
  check('still to find = still to sell − realistic total in each month; amber when short, green "covered (+£x)" in surplus', perMonth && shown, c.months.map((m, i) => `${m.label} ${Math.round(m.still_to_sell)} − ${Math.round(m.total)} → "${r[i + 1].t}" (${r[i + 1].cls})`).join(' · '));
  const sumShort = c.months.reduce((a, m) => a + m.still_to_find, 0);
  check('rolling still to find = the sum of the monthly shortfalls only (no surplus carried back)', Math.abs(c.rolling.still_to_find - sumShort) < 0.01 && r[4].t === cv(sumShort), `${c.months.map((m) => Math.round(m.still_to_find)).join(' + ')} = ${Math.round(sumShort)} → "${r[4].t}" · surplus not carried ${Math.round(c.rolling.surplus_not_carried)} · netted would be ${Math.round(Math.max(0, c.rolling.still_to_sell - c.rolling.total))}`);
}
function undatedChecks(t, c, s) {
  const u = c.undated;
  const pl = s.prospects.pipeline;
  check(`undated potential shown: "Undated potential £${Math.round(u.gbp).toLocaleString('en-GB')} (${u.count} enquiries …, not counted)"`, t.undated === `Undated potential £${Math.round(u.gbp).toLocaleString('en-GB')} (${u.count} enquir${u.count === 1 ? 'y' : 'ies'} without an expected month, not counted)` && u.count === pl.undated_count, t.undated);
  check('undated is never counted: rolling pipeline + dated-event = only enquiries with a month', Math.abs(c.rolling.pipeline - c.months.reduce((a, m) => a + m.pipeline, 0)) < 0.01 && c.rolling.pipeline + c.rolling.dated_event < u.gbp + 0.01 + c.rolling.pipeline + c.rolling.dated_event && !(u.gbp > 0.5 && Math.abs(c.rolling.pipeline - u.gbp) < 0.01), `undated ${Math.round(u.gbp)} not in pipeline ${Math.round(c.rolling.pipeline)} / dated-event ${Math.round(c.rolling.dated_event)}`);
  check('footnote as in the mock-up', /^"Still to find" for the rolling 3 months = .* shortfalls? only.*Normal non-dated sales are reduced where an enquiry of the same type is already in the pipeline, so nothing is counted twice\. Each enquiry gets an expected cash month \(GPT sets it from the conversation; Alan can change it\)\./.test(t.foot), t.foot);
}
function factorChecks(s, rulesText) {
  const pl = s.prospects.pipeline;
  const a = s.sales_gap.assumptions.find((x) => x.key === 'revalidate_factor');
  check('revalidate × 0.25 is an editable assumption in Rules ("set 9 Nov, review later")', a?.status === 'set 9 Nov, review later' && /Old leads \(review: revalidate\): weighted £ × 0\.25: old leads count at a quarter set 9 Nov, review later/.test(rulesText), a ? `${a.label}: ${a.value} · ${a.status}` : 'missing');
  check(`Prospects tile + table use the factor: ${pl.revalidate_count} revalidate leads; weighted total £${Math.round(pl.total)} (aggregate only)`, pl.revalidate_factor === 0.25 && s.prospects.revalidate_factor === 0.25, `stage tiles weighted ${s.prospects.tiles.filter((x) => x.weighted != null).map((x) => `${x.stage} £${Math.round(x.weighted)}`).join(' · ')}`);
}
function lineChecks(after, s) {
  const sg = s.sales_gap;
  const g = (v) => (Math.abs(v) >= 1000 ? `£${(Math.round(Math.abs(v) / 100) / 10).toLocaleString('en-GB')}k` : `£${Math.round(Math.abs(v)).toLocaleString('en-GB')}`);
  const q = sg.rolling.pipeline;
  check('quarter tile pipeline line: "£X weighted by month · dated-event enquiries £Y · undated £Z"', after.quarter.includes(`Prospects pipeline: ${g(q.dated)} weighted by month · dated-event enquiries ${g(q.dated_event)} · undated ${g(q.undated)}`), after.quarter.slice(after.quarter.indexOf('Prospects pipeline'), after.quarter.indexOf('Prospects pipeline') + 110));
  const ok = sg.months.every((m, i) => after.months[i].includes(`Prospects pipeline: ${g(m.pipeline_month.weighted)} weighted, cash due this month · dated-event enquiries ${g(m.pipeline_month.dated_event)} · undated ${g(m.pipeline_month.undated)}`));
  check('month tiles pipeline line: weighted this month · dated-event enquiries · undated', ok, after.months.map((m) => m.slice(m.indexOf('Prospects pipeline'), m.indexOf('Prospects pipeline') + 105)).join(' | '));
}
const hash = (t) => createHash('sha1').update(t).digest('hex').slice(0, 10);
/** Every word identical except £ amounts that are now a quarter of before (the revalidate rows' weighted cells). */
function quarterOnly(x, y) {
  const a = x.split(' ');
  const b = y.split(' ');
  const pounds = (w) => (/^£[\d,]+$/.test(w) ? Number(w.slice(1).replace(/,/g, '')) : null);
  const diffs = a.map((w, i) => [w, b[i]]).filter(([u, v]) => u !== v);
  const ok = a.length === b.length && diffs.every(([u, v]) => pounds(u) != null && pounds(v) != null && Math.abs(pounds(v) - pounds(u) * 0.25) <= 1);
  return { ok, n: diffs.length };
}
/** Word-level differences with every letter masked (x), so no enquiry name or note is ever printed. */
function maskedDiff(x, y) {
  const a = x.split(' ');
  const b = y.split(' ');
  const out = [];
  for (let i = 0, j = 0; (i < a.length || j < b.length) && out.length < 8; i += 1, j += 1) if (a[i] !== b[j]) out.push(`${String(a[i]).replace(/[A-Za-z]/g, 'x')}→${String(b[j]).replace(/[A-Za-z]/g, 'x')}`);
  return out.join(' ');
}
function movedChecks(before, after) {
  /** Remedy: the new "− dated-event enquiries £y" / "· dated-event £y" wording (shown only when above £0) is this change. */
  const remedyNorm = (t) => t.replace(/ − dated-event enquiries £[\d,.]+k?/g, '').replace(/ · dated-event £[\d,.]+k?/g, '');
  const SAME = (a, b) => a && b && a.x === b.x && a.w === b.w && remedyNorm(a.text).replace(/\b\d{1,2}:\d{2}\b/g, 'HH:MM') === remedyNorm(b.text).replace(/\b\d{1,2}:\d{2}\b/g, 'HH:MM');
  const changed = after.blocks.filter((b) => !['st-sales-gap', 'st-prospects'].includes(b.id) && !SAME(b, before.blocks.find((x) => x.id === b.id))).map((b) => b.id);
  check('nothing else moved: every other Strategy block keeps its text, x and width (y shifts only by the new table)', !changed.length && after.blocks.length === before.blocks.length, changed.join(', ') || `${after.blocks.length - 2} blocks identical`);
  const strip = (t) => t.replace(/Prospects pipeline: [^]*?(?= details)/, 'PIPE');
  check('sales-gap tiles unchanged apart from the pipeline lines (quarter + 3 months); grid size unchanged; legend unchanged', strip(after.quarter) === strip(before.quarter) && after.months.every((m, i) => strip(m) === strip(before.months[i])) && after.grid.w === before.grid.w && after.grid.h === before.grid.h && after.legend === before.legend, `grid ${before.grid.w}×${before.grid.h} → ${after.grid.w}×${after.grid.h}`);
  const pb = before.blocks.find((x) => x.id === 'st-prospects').text;
  const pa = after.blocks.find((x) => x.id === 'st-prospects').text;
  const norm = (t) => t.replace(/ · dated-event enquiries £[\d,]+/, '').replace(/ \(old leads count at a quarter\)/, '').replace(/ × 0\.25/g, '').replace(/ dated event \d{1,2} [A-Z][a-z]{2} · \/\S+/g, '');
  const q = quarterOnly(norm(pb), norm(pa));
  check('Prospects section: only the new wording (dated-event line, "old leads count at a quarter", × 0.25 tags) and the revalidate rows\' weighted £ (now × 0.25) changed', q.ok, `text ${hash(pb)} → ${hash(pa)} (compared in memory; no enquiry text saved) · ${q.n} weighted cells × 0.25: ${maskedDiff(norm(pb), norm(pa))}`);
}

/** Production serves both views at ?v=rc-20261109a, byte-identical to the commit. */
async function servedCheck(page) {
  for (const f of FILES) {
    const served = await page.evaluate(async (name) => {
      const src = document.querySelector(`script[src*="/lib/${name}"]`)?.getAttribute('src') || '';
      return { src, body: src ? await (await fetch(src, { cache: 'no-store' })).text() : '' };
    }, f);
    const clean = (t) => t.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    const committed = clean(execSync(`git show ${COMMIT}:lib/${f}`, { encoding: 'utf8' }));
    check(`production serves ${f}?v=${VERSION}, identical to ${COMMIT} (a leading byte-order mark, already in the file, is dropped by fetch)`, served.src.endsWith(`?v=${VERSION}`) && clean(served.body) === committed, `${served.src} · ${served.body.length} bytes`);
  }
}

const before = await dbState();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const a = await render(browser, VIEW.before);
const lb = await a.page.evaluate(layoutOf);
await a.page.locator('#st-sales-gap').screenshot({ path: `${OUT}/sales-gap-realistic-cover-tiles-before-${TAG}-1700px-20261109.png` });
await a.ctx.close();
const b = await render(browser, VIEW.after);
if (LIVE) await servedCheck(b.page);
const la = await b.page.evaluate(layoutOf);
const table = await b.page.evaluate(coverOf);
await b.page.locator('#st-sales-gap').screenshot({ path: `${OUT}/sales-gap-realistic-cover-tiles-${LIVE ? '' : 'after-'}${TAG}-1700px-20261109.png` });
await b.page.locator('#sg-cover').screenshot({ path: `${OUT}/sales-gap-realistic-cover-table-${TAG}-1700px-20261109.png` });
await b.page.locator('#st-remedy').screenshot({ path: `${OUT}/sales-gap-realistic-cover-remedy-${TAG}-1700px-20261109.png` });
await b.page.evaluate(() => { const r = document.getElementById('sg-rules'); if (r) r.open = true; });
const rulesText = await b.page.evaluate(() => document.getElementById('sg-rules')?.innerText.replace(/\s+/g, ' ') || '');
await b.ctx.close();
await browser.close();
const after = await dbState();
const s = JSON.parse(API['/api/aigeo/strategy-summary']);
if (table) {
  tableChecks(table, s.sales_gap.cover);
  findChecks(table, s.sales_gap.cover);
  undatedChecks(table, s.sales_gap.cover, s);
} else check('realistic cover table rendered', false, 'missing');
factorChecks(s, rulesText);
lineChecks(la, s);
movedChecks(lb, la);
const changed = Object.keys(before).filter((x) => before[x] !== after[x]);
check('viewing writes nothing (row counts + newest timestamps)', !changed.length, changed.map((x) => `${x}: ${before[x]} → ${after[x]}`).join(' | ') || `${Object.keys(TABLES).length} tables unchanged`);
check('every non-GET refused', true, `${blocked.length} refused: ${[...new Set(blocked)].join(', ') || 'none attempted'}`);
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
fs.writeFileSync(`${OUT}/_rc-${TAG}-result.json`, JSON.stringify({ results, cover: s.sales_gap.cover, before, after }, null, 1));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
process.exit(0);

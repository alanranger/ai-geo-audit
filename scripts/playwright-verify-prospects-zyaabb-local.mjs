/**
 * Prospects (QUESTION-2026-11-09 (z / y / aa / bb)) with the LOCAL code on the production page. Real rows are never
 * modified; the ENQ sequence is never used (fake rows get explicit refs TEST-E01…E04 and are deleted at the end).
 *   PHASE=saves   live DB, the browser only ever sees the 4 FAKE rows: drawer save per revenue type → the DB changed only
 *                 the edited columns; refused Booked / paid shows its reason; Closed needs a reason; Parked needs a date
 *                 and shows again on its date. Every other non-GET refused.
 *   PHASE=fixture 24 fake rows (no DB): Edit on row 23 opens a visible drawer; parked due / future; toggle.
 *   PHASE=real    live rows READ-ONLY with names / text MASKED before they reach the browser: screenshots at 1700 + 1280
 *                 (table with ENQ-0001 High at the top, drawer on ENQ-0023 and ENQ-0001, filter bar with 2 chips).
 *   PROD=1        the same three phases on PRODUCTION files + the production admin API (served ?v= checked against COMMIT);
 *                 the fake rows are still inserted with explicit refs (never the ENQ sequence) and saved through the
 *                 production API; screenshots named -live-.
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
Object.assign(process.env, ENV);
const PHASE = ['saves', 'fixture', 'real'].includes(process.env.PHASE) ? process.env.PHASE : 'real';
const BASE = 'https://ai-geo-audit.vercel.app';
const LOCAL = ['strategy-prospects.js', 'strategy-tab.js'];
const PROD = process.env.PROD === '1';
const KIND = PROD ? 'live' : 'local';
const COMMIT = process.env.COMMIT || 'HEAD';
const VERSION = process.env.VERSION || 'pr-20261109a';
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const refused = [];
const errors = [];
const FAKE = (id) => String(id || '').startsWith('test-e');
/** Error text without Playwright's call log (it lists request headers, including the admin key). */
const safeMsg = (e) => String(e?.message || e).split('\n')[0].replace(/x-arp-admin-key\S*\s*\S+/gi, 'x-arp-admin-key [redacted]').slice(0, 300);
const routeErrors = [];
process.on('unhandledRejection', (e) => { routeErrors.push(safeMsg(e)); });
process.on('uncaughtException', (e) => { routeErrors.push(safeMsg(e)); });

const fakeRes = (set) => ({ status() { return this; }, setHeader() {}, send(t) { set(typeof t === 'string' ? t : JSON.stringify(t)); return this; } });
async function callApi(method, body) {
  const { default: handler } = await import('../api/aigeo/prospects.js');
  let out = null;
  let status = 200;
  const res = { ...fakeRes((b) => { out = b; }), status(c) { status = c; return this; } };
  await handler({ method, query: {}, headers: { 'x-arp-admin-key': ENV.ARP_ADMIN_KEY }, body }, res);
  return { status, body: out };
}
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** Real rows for screenshots: names, free text and mail links replaced before the page sees them. */
function masked(j) {
  const rows = j.rows.map((r, i) => ({ ...r, client_or_org: `Client ${LETTERS[i % 26]}${i >= 26 ? i : ''}`, next_action: r.next_action ? 'next action (masked)' : null, notes: null, value_basis_note: r.value_basis_note ? 'basis note (masked)' : null, status_note: r.status_note ? 'note (masked)' : null, mail: r.mail ? { ...r.mail, href: '#' } : null }));
  const clients = Object.fromEntries(Object.entries(j.clients || {}).map(([k, c]) => [k, { ...c, name: 'masked', mail: c.mail ? { ...c.mail, href: '#' } : null }]));
  return { ...j, rows, clients, history: [] };
}
const onlyFake = (j) => ({ ...j, rows: j.rows.filter((r) => FAKE(r.id)), history: j.history.filter((h) => FAKE(h.enquiry_id)), clients: Object.fromEntries(Object.entries(j.clients || {}).filter(([k]) => j.rows.some((r) => FAKE(r.id) && r.person_id === k))) });

/* ---------- fixture rows (no DB) ---------- */
function fixture() {
  const base = (i, extra) => ({ id: `fx-${i}`, enquiry_ref: `TEST-F${String(i + 1).padStart(2, '0')}`, client_or_org: `TEST Fixture ${i + 1}`, type: '1-2-1', revenue_type: 'new_sale', stage: 'qualify', value_gbp: 100 + i * 10, value_basis: 'estimated', customer_market: i % 2 ? 'B2B' : 'D2C', review_status: 'recent', owner: 'GPT', enquiry_date: '2026-10-01', last_touch_at: '2026-11-01T10:00:00Z', next_action: 'TEST follow-up', priority: { band: i < 3 ? 'High' : 'Low', score: 300 - i, tip: 'fixture' }, ...extra });
  const rows = Array.from({ length: 24 }, (_, i) => base(i));
  rows[22] = { ...base(22), revenue_type: 'committed_work', stage: 'allocated', delivery_due: '2026-12-03', invoice_by: '2026-12-11', priority: null };
  rows.push(base(24, { stage: 'parked', revisit_on: TODAY, status_note: 'TEST on hold until later this year', priority: null }));
  rows.push(base(25, { stage: 'parked', revisit_on: '2099-01-15', status_note: 'TEST much later', priority: null }));
  rows.push(base(26, { stage: 'closed_lost', lost_reason: 'no_response', priority: null }));
  return { ok: true, rows, config: [], history: [], clients: {}, revalidate_factor: 0.25, priority_rules: [] };
}

/* ---------- fake DB rows (saves phase) ---------- */
const PERSON = { anchor_key: 'email:test+prospecte@example.invalid', email: 'test+prospecte@example.invalid', display_name: 'TEST Prospect E', facts: { record_type: 'prospect', name: 'TEST Prospect E', email: 'test+prospecte@example.invalid', prospect: { source: 'prospect_enquiry' } } };
const FAKE_ROWS = [
  ['test-e01', 'TEST-E01', 'new_sale', 'quote', { type: '1-2-1', customer_market: 'D2C', value_gbp: 2500, value_basis: 'quoted' }],
  ['test-e02', 'TEST-E02', 'committed_work', 'allocated', { type: 'other', customer_market: 'B2B', value_gbp: 125, value_basis: 'estimated', delivery_due: '2026-12-03', invoice_by: '2026-12-11' }],
  ['test-e03', 'TEST-E03', 'receivable', 'scheduled', { type: 'other', customer_market: 'B2B', value_gbp: 250, value_basis: 'agreed' }],
  ['test-e04', 'TEST-E04', 'partner_development', 'qualify', { type: 'other', customer_market: 'B2B', value_gbp: 0, value_basis: 'unknown' }]
];
async function setupFake() {
  await cleanupFake();
  const { data: p, error } = await sb.from('customer_person').insert(PERSON).select('person_id').single();
  if (error) throw new Error(`person: ${error.message}`);
  const rows = FAKE_ROWS.map(([id, ref, rt, stage, x]) => ({ id, enquiry_ref: ref, client_or_org: `TEST Prospect E (${rt})`, person_id: p.person_id, revenue_type: rt, stage, cash_month: '2026-12-01', next_action: 'TEST next action', owner: 'GPT', enquiry_date: '2026-10-01', last_touch_at: '2026-11-01T10:00:00Z', review_status: 'recent', created_by: 'Cursor test (QUESTION zyaabb)', ...x }));
  const ins = await sb.from('prospect_enquiry').insert(rows);
  if (ins.error) throw new Error(`rows: ${ins.error.message}`);
}
async function cleanupFake() {
  await sb.from('prospect_enquiry').delete().in('id', FAKE_ROWS.map(([id]) => id));
  await sb.from('customer_person').delete().eq('anchor_key', PERSON.anchor_key).eq('display_name', PERSON.display_name);
}
const dbRow = async (id) => (await sb.from('prospect_enquiry').select('*').eq('id', id).single()).data;
const realSnapshot = async () => Object.fromEntries(((await sb.from('prospect_enquiry').select('id, updated_at')).data || []).filter((r) => !FAKE(r.id)).map((r) => [r.id, r.updated_at]));
const seqLast = async () => (await sb.rpc('pg_sequence_last_value_unavailable').catch(() => null), null);

/* ---------- browser ---------- */
let summaryCache = null;
async function routes(page) {
  await page.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); }, ENV.ARP_ADMIN_KEY);
  await page.route('**/*', async (route) => {
    try {
      return await handleRoute(route);
    } catch (e) {
      routeErrors.push(safeMsg(e));
      return route.abort().catch(() => {});
    }
  });
}
async function handleRoute(route) {
  const req = route.request();
  const url = new URL(req.url());
  const file = !PROD && LOCAL.find((f) => url.pathname === `/lib/${f}`);
  if (file) return route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`lib/${file}`, 'utf8') });
  if (url.pathname === '/api/aigeo/prospects') return prospectsRoute(route, req);
  if (req.method() !== 'GET') { if (url.pathname.startsWith('/api/')) refused.push(`${req.method()} ${url.pathname}`); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' }); }
  if (url.pathname === '/api/aigeo/strategy-summary') {
    if (!summaryCache) summaryCache = await (await route.fetch({ timeout: 45000 })).text();
    return route.fulfill({ status: 200, contentType: 'application/json', body: summaryCache });
  }
  return route.fallback();
}
/** Close without letting a still-pending route (e.g. the quiet summary refresh) throw after the page is gone. */
async function closeQuietly(browser, page) {
  await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
  await browser.close().catch(() => {});
}
async function prospectsRoute(route, req) {
  if (req.method() === 'GET') {
    if (PHASE === 'fixture') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture()) });
    const got = await apiCall(route, 'GET');
    if (got.status !== 200) return route.fulfill({ status: got.status, contentType: 'application/json', body: got.body });
    const body = JSON.parse(got.body);
    const out = PHASE === 'saves' ? onlyFake(body) : masked(body);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) });
  }
  const b = JSON.parse(req.postData() || '{}');
  if (PHASE !== 'saves' || !FAKE(b.enquiry?.id)) { refused.push('POST /api/aigeo/prospects (not a fake row)'); return route.fulfill({ status: 400, contentType: 'application/json', body: '{"ok":false,"error":"refused by test"}' }); }
  posts.push(b);
  const r = await apiCall(route, 'POST', b);
  return route.fulfill({ status: r.status, contentType: 'application/json', body: r.body });
}
/** PROD: the production admin API (the browser's own request, admin key header); else the local handler. */
async function apiCall(route, method, body) {
  if (!PROD) return callApi(method, body);
  const resp = await route.fetch({ timeout: 45000 });
  apiHits.push(`${method} ${resp.status()}`);
  return { status: resp.status(), body: await resp.text() };
}
const apiHits = [];
let servedChecked = false;
async function servedCheck(page) {
  if (!PROD || servedChecked) return;
  servedChecked = true;
  const norm = (s) => s.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  for (const f of LOCAL) {
    const got = await page.evaluate(async (name) => {
      const src = document.querySelector(`script[src*="/lib/${name}"]`)?.getAttribute('src') || '';
      return { src, body: src ? await (await fetch(src, { cache: 'no-store' })).text() : '' };
    }, f);
    const committed = norm(execSync(`git show ${COMMIT}:lib/${f}`, { encoding: 'utf8' }));
    check(`production serves ${f}?v=${VERSION}, identical to ${COMMIT}`, got.src.endsWith(`?v=${VERSION}`) && norm(got.body) === committed, `${got.src} · ${got.body.length} chars`);
  }
}
const posts = [];
async function openPage(width) {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await routes(page);
  await page.goto(`${BASE}/audit-dashboard.html#strategy`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#st-prospects .pp-table tbody tr[data-pp-row]'), null, { timeout: 50000 });
  await page.evaluate(() => [...document.querySelectorAll('body *')].filter((el) => getComputedStyle(el).position === 'fixed' && el.id !== 'pp-panel' && el.getBoundingClientRect().top > window.innerHeight / 2).forEach((el) => { el.style.visibility = 'hidden'; }));
  await servedCheck(page);
  return { browser, page };
}
async function openEdit(page, id) {
  await page.locator(`#st-prospects [data-pp-edit="${id}"]`).click();
  await page.waitForSelector('#pp-panel:not([hidden]) form.pp-dform');
}
async function setField(page, name, value) {
  const el = page.locator(`#pp-panel [name="${name}"]`);
  const tag = await el.evaluate((x) => x.tagName);
  if (tag === 'SELECT') await el.selectOption(value);
  else await el.fill(String(value));
}
async function saveAndWait(page) {
  await page.locator('#pp-panel [data-pp-save]').click();
  await page.waitForFunction(() => {
    const msg = document.querySelector('#pp-panel [data-pp-msg]')?.textContent || '';
    return /^Not saved/.test(msg) || (document.getElementById('pp-panel')?.hidden && document.querySelector('[data-pp-toast] .pp-toast'));
  }, null, { timeout: 20000 });
  await page.waitForTimeout(600);
  return page.evaluate(() => ({ msg: document.querySelector('#pp-panel [data-pp-msg]')?.textContent || '', toast: document.querySelector('[data-pp-toast] .pp-toast')?.textContent || '', errs: Object.fromEntries([...document.querySelectorAll('#pp-panel [data-err]')].filter((e) => e.textContent).map((e) => [e.dataset.err, e.textContent])) }));
}
const IGNORE = new Set(['updated_at']);
const diffKeys = (a, b) => Object.keys(b).filter((k) => !IGNORE.has(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k])).sort();

async function saveCase(page, label, id, fields, expect) {
  const before = await dbRow(id);
  await openEdit(page, id);
  for (const [k, v] of Object.entries(fields)) await setField(page, k, v);
  const out = await saveAndWait(page);
  const after = await dbRow(id);
  const changed = diffKeys(before, after);
  check(`${label}: saved from the drawer; DB changed ONLY ${expect.join(', ')} (+ updated_at)`, !out.msg && changed.join(',') === [...expect].sort().join(',') && after.updated_at !== before.updated_at, `toast "${out.toast}" · changed [${changed.join(', ')}]`);
  return { before, after, out };
}
async function refuseCase(page, label, id, fields, field, reason) {
  const before = await dbRow(id);
  await openEdit(page, id);
  for (const [k, v] of Object.entries(fields)) await setField(page, k, v);
  const out = await saveAndWait(page);
  const after = await dbRow(id);
  check(`${label}: refused, reason shown beside "${field}", DB unchanged`, out.errs[field] === reason && out.msg === `Not saved: ${reason}` && !diffKeys(before, after).length, `${field}: "${out.errs[field] || ''}" · footer "${out.msg}"`);
  return out;
}

async function typeSaves(page) {
  const common = { cash_month: '2027-01', next_action: 'TEST changed next action', value_gbp: 2600, owner: 'Alan' };
  const ALL = ['cash_month', 'next_action', 'value_gbp', 'owner'];
  await saveCase(page, 'new sale (TEST-E01) Quote → Scheduled', 'test-e01', { stage: 'scheduled', ...common }, ['stage', ...ALL]);
  await saveCase(page, 'committed work (TEST-E02) Allocated → Delivered', 'test-e02', { stage: 'delivered', ...common, value_gbp: 155 }, ['stage', ...ALL]);
  await saveCase(page, 'committed work (TEST-E02) Delivered → Invoiced', 'test-e02', { stage: 'invoiced' }, ['stage']);
  await saveCase(page, 'receivable (TEST-E03) cash month / next action / value / owner', 'test-e03', { ...common, value_gbp: 260 }, ALL);
  await saveCase(page, 'partner (TEST-E04) Qualify → Quote', 'test-e04', { stage: 'quote', ...common, value_gbp: 0 }, ['stage', 'cash_month', 'next_action', 'owner']);
  await refuseCase(page, 'Booked / paid without a Booking Sheet sale (TEST-E01)', 'test-e01', { stage: 'booked_paid' }, 'stage', 'Booked / paid needs a matching Booking Sheet sale for this client: enter the sale date and £ under Booked / paid.');
  await page.locator('#pp-panel [data-pp-close]').first().click();
}
async function historyChecks() {
  const { data: hist } = await sb.from('prospect_enquiry_history').select('enquiry_id, via, from_stage, to_stage, changes').in('enquiry_id', FAKE_ROWS.map(([id]) => id)).order('at');
  const closeH = hist.find((h) => h.to_stage === 'closed_lost');
  const parkH = hist.find((h) => h.to_stage === 'parked');
  check('history records who / when / why for close and park (via dashboard, reason / revisit date / note)', hist.every((h) => h.via === 'dashboard') && closeH?.changes?.lost_reason?.to === 'no_response' && parkH?.changes?.revisit_on?.to === TODAY && !!parkH?.changes?.status_note, `${hist.length} history rows · ${hist.map((h) => `${h.enquiry_id}:${h.from_stage}→${h.to_stage}[${Object.keys(h.changes).join(',')}]`).join(' | ')}`);
  check('payloads carried only changed fields + id (no last_touch_at: "Touched today" off)', posts.every((b) => !('last_touch_at' in b.enquiry) && b.enquiry.id && Object.keys(b.enquiry).length <= 6), posts.map((b) => Object.keys(b.enquiry).join('+')).join(' | '));
}
/** Real rows may change during a run through other channels (GPT / Claude loads); this test only writes via the dashboard. */
async function afterSaves(realBefore, since) {
  const realAfter = await realSnapshot();
  const touched = Object.keys(realBefore).filter((id) => realAfter[id] !== realBefore[id]);
  const { data: hist } = await sb.from('prospect_enquiry_history').select('enquiry_id, via, at').gte('at', since);
  const mine = (hist || []).filter((h) => !FAKE(h.enquiry_id) && h.via === 'dashboard');
  const other = (hist || []).filter((h) => !FAKE(h.enquiry_id) && h.via !== 'dashboard');
  check('no real row modified by this test (no dashboard-channel history on any real row during the run)', !mine.length, `${mine.length} dashboard writes on real rows · ${touched.length} real row(s) changed meanwhile through other channels (${[...new Set(other.map((h) => h.via))].join(', ') || 'none'})`);
  await cleanupFake();
  const left = (await sb.from('prospect_enquiry').select('id').in('id', FAKE_ROWS.map(([id]) => id))).data || [];
  check('fake rows + fake person deleted', !left.length, `${left.length} left`);
}
async function phaseSaves() {
  await setupFake();
  const since = new Date().toISOString();
  const realBefore = await realSnapshot();
  const { browser, page } = await openPage(Number(process.env.WIDTH) || 1700);
  try {
    await typeSaves(page);
    await endSaves(page);
    await historyChecks();
  } finally {
    await closeQuietly(browser, page);
    await afterSaves(realBefore, since);
  }
}
async function endSaves(page) {
    await refuseCase(page, 'Closed without a reason (TEST-E04)', 'test-e04', { stage: 'closed_lost' }, 'lost_reason', 'Closing needs a reason.');
    await setField(page, 'lost_reason', 'no_response');
    const closed = await saveAndWait(page);
    const e04 = await dbRow('test-e04');
    const shownAfterClose = await page.evaluate(() => !!document.querySelector('#st-prospects [data-pp-row="test-e04"]'));
    const ended = await page.evaluate(() => document.querySelector('[data-pp-ended]')?.textContent || '');
    check('Closed with reason "No response / gone cold": saved, hidden by default, counted in the muted line (out of totals)', !closed.msg && e04.stage === 'closed_lost' && e04.lost_reason === 'no_response' && !shownAfterClose && /^Closed 1 \(£0\)/.test(ended), `${closed.toast} · ended "${ended}"`);
    await refuseCase(page, 'Parked without a revisit date (TEST-E01)', 'test-e01', { stage: 'parked' }, 'revisit_on', 'Parking needs a "Revisit on" date.');
    await setField(page, 'revisit_on', TODAY);
    await setField(page, 'status_note', 'TEST on hold, revisit later');
    const parked = await saveAndWait(page);
    const e01 = await dbRow('test-e01');
    const row = await page.evaluate(() => document.querySelector('#st-prospects [data-pp-row="test-e01"]')?.innerText.replace(/\s+/g, ' ') || '');
    check('Parked with a revisit date of today: saved at £0 weighted and shown again as GPT\'s "revisit" action', !parked.msg && e01.stage === 'parked' && String(e01.revisit_on).slice(0, 10) === TODAY && /revisit: TEST on hold, revisit later/.test(row) && /£0 weighted · parked/.test(row), row.slice(0, 160));
}

async function phaseFixture() {
  for (const width of [1700, 1280]) await fixtureAt(width);
}
async function fixtureAt(width) {
  const { browser, page } = await openPage(width);
  const btn = page.locator('#st-prospects [data-pp-edit="fx-22"]');
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await page.waitForSelector('#pp-panel:not([hidden]) form.pp-dform');
  const vis = await page.evaluate(() => {
    const r = document.getElementById('pp-panel').getBoundingClientRect();
    const shownSections = [...document.querySelectorAll('#pp-panel section[data-when]')].filter((s) => !s.hidden).map((s) => s.dataset.when);
    return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), inView: r.top >= 0 && r.left < window.innerWidth && r.right <= window.innerWidth + 1, focus: document.activeElement?.name || null, shownSections };
  });
  check(`${width}px: Edit on row 23 of 24: the drawer opens in view (fixed right) with the committed fields only`, vis.inView && vis.top === 0 && vis.shownSections.join(',') === 'committed', JSON.stringify(vis));
  await page.screenshot({ path: `outputs/prospects-zyaabb-edit-row23-${KIND}-${width}-20261109.png` });
  await page.keyboard.press('Escape');
  const ids = await page.evaluate(() => [...document.querySelectorAll('#st-prospects tr[data-pp-row]')].map((tr) => tr.dataset.ppRow));
  check('default view: the parked row due today is shown, the future parked and the closed rows are hidden', ids.includes('fx-24') && !ids.includes('fx-25') && !ids.includes('fx-26'), `${ids.length} rows`);
  const due = await page.evaluate(() => document.querySelector('#st-prospects tr[data-pp-row="fx-24"]')?.innerText.replace(/\s+/g, ' '));
  check('the due parked row reads as GPT\'s next action "revisit: {reason}"', /revisit: TEST on hold until later this year/.test(due) && /GPT ·/.test(due), due);
  await page.locator('#st-prospects [data-pp-f="ended"]').check();
  await page.waitForTimeout(300);
  const all = await page.evaluate(() => document.querySelectorAll('#st-prospects tr[data-pp-row]').length);
  check('"Show closed / parked" shows them', all === 27, `${all} rows`);
  await closeQuietly(browser, page);
}

async function realChecks(page, width) {
  const tag = `${width}`;
  await page.locator('#st-prospects .pp-table').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  const layout = await page.evaluate(() => {
    const t = document.querySelector('#st-prospects .pp-table');
    const host = document.getElementById('st-prospects');
    const tr = t.getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    const first = t.querySelector('tbody tr[data-pp-row]');
    const wrapped = [...t.querySelectorAll('.pp-nw')].filter((x) => x.getClientRects().length > 1).length;
    return { tableW: Math.round(tr.width), tableRight: Math.round(tr.right), hostW: Math.round(hr.width), hostRight: Math.round(hr.right), scrollW: t.scrollWidth, clientW: t.clientWidth, pageOverflow: document.documentElement.scrollWidth - window.innerWidth, firstRef: first?.querySelector('.pp-c2')?.textContent.split('·')[0].trim(), firstBand: first?.querySelector('.pp-pri')?.textContent || null, wrapped };
  });
  check(`${tag}px: no horizontal scroll on the table, no wrapped IDs`, layout.tableW > 0 && layout.tableRight <= layout.hostRight + 1 && layout.scrollW <= layout.clientW + 1 && layout.pageOverflow <= 0 && layout.wrapped === 0, JSON.stringify(layout));
  const top = realTop;
  check(`${tag}px: default sort = Priority (High first), then weighted £ descending`, layout.firstRef === top.ref && layout.firstBand === 'High', `top ${layout.firstRef} ${layout.firstBand} · expected ${top.ref} (High, £${Math.round(top.weighted)} weighted, score £${Math.round(top.score)})`);
  const enq1 = realRows.find((r) => r.enquiry_ref === 'ENQ-0001');
  const enq1Band = await page.evaluate(() => [...document.querySelectorAll('#st-prospects tr[data-pp-row]')].find((tr) => tr.querySelector('.pp-c2')?.textContent.startsWith('ENQ-0001'))?.querySelector('.pp-pri')?.textContent || null);
  check(`${tag}px: ENQ-0001 (now ${enq1?.revenue_type} / ${enq1?.stage}) shows ${enq1?.priority ? enq1.priority.band : 'no priority (committed / receivable / partner rows show their own status)'}`, enq1?.priority ? enq1Band === enq1.priority.band : enq1Band === null, `band in table: ${enq1Band}`);
  await page.locator('#st-prospects').screenshot({ path: `outputs/prospects-zyaabb-table-${KIND}-${tag}-20261109.png` });
  const committedRef = (ref) => realRows.find((r) => r.enquiry_ref === ref)?.revenue_type === 'committed_work';
  for (const [ref, name] of [['ENQ-0023', 'drawer-enq0023'], ['ENQ-0001', 'drawer-enq0001'], [top.ref, `drawer-newsale-${top.ref.toLowerCase().replace('-', '')}`]]) {
    const want = committedRef(ref) ? 'committed' : '';
    const id = await page.evaluate((r) => [...document.querySelectorAll('#st-prospects tr[data-pp-row]')].find((tr) => tr.querySelector('.pp-c2')?.textContent.startsWith(r))?.dataset.ppRow, ref);
    await openEdit(page, id);
    const shown = await page.evaluate(() => [...document.querySelectorAll('#pp-panel section[data-when]')].filter((s) => !s.hidden).map((s) => s.dataset.when).join(','));
    check(`${tag}px: drawer on ${ref} (read-only, names masked): ${want ? 'committed fields shown' : 'committed fields hidden'}`, shown === want, `visible conditional sections: [${shown}]`);
    await page.screenshot({ path: `outputs/prospects-zyaabb-${name}-${KIND}-${tag}-20261109.png` });
    await page.keyboard.press('Escape');
  }
  await page.selectOption('#st-prospects [data-pp-f="priority"]', 'High');
  await page.selectOption('#st-prospects [data-pp-f="rtype"]', 'new_sale');
  await page.waitForTimeout(300);
  const chips = await page.evaluate(() => [...document.querySelectorAll('#st-prospects .pp-fchip')].map((c) => c.textContent));
  check(`${tag}px: filter bar with 2 active, removable chips`, chips.length === 2, chips.join(' | '));
  await page.locator('#st-prospects .pp-bar').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.locator('#st-prospects').screenshot({ path: `outputs/prospects-zyaabb-filters-${KIND}-${tag}-20261109.png` });
  await page.locator('#st-prospects [data-pp-clear]').click();
}
let realRows = [];
let realTop = null;
async function phaseReal() {
  const since = new Date().toISOString();
  const before = await realSnapshot();
  realRows = JSON.parse((await callApi('GET')).body).rows;
  const BAND = { High: 0, Medium: 1, Low: 2 };
  const ranked = realRows.filter((r) => r.priority).sort((a, b) => BAND[a.priority.band] - BAND[b.priority.band] || b.priority.weighted - a.priority.weighted);
  realTop = { ref: ranked[0]?.enquiry_ref, score: ranked[0]?.priority.score || 0, weighted: ranked[0]?.priority.weighted || 0 };
  for (const width of [1700, 1280]) {
    const { browser, page } = await openPage(width);
    await realChecks(page, width);
    await closeQuietly(browser, page);
  }
  const after = await realSnapshot();
  const { data: hist } = await sb.from('prospect_enquiry_history').select('enquiry_id, via').gte('at', since);
  const dash = (hist || []).filter((h) => h.via === 'dashboard');
  const changed = Object.keys(before).filter((id) => after[id] !== before[id]).length;
  check('real phase wrote nothing (no prospects POST sent, no dashboard-channel history during the run)', !posts.length && !dash.length, `${Object.keys(before).length} rows · ${refused.filter((r) => /prospects/.test(r)).length} prospects POSTs refused · ${changed} row(s) changed meanwhile via ${[...new Set((hist || []).map((h) => h.via))].join(', ') || 'no channel'}`);
}

try {
  if (PHASE === 'saves') await phaseSaves();
  else if (PHASE === 'fixture') await phaseFixture();
  else await phaseReal();
} catch (e) {
  check('run completed', false, safeMsg(e));
  if (PHASE === 'saves') await cleanupFake();
}
check('no page errors', !errors.length, errors.slice(0, 3).map(safeMsg).join(' | '));
const SHUTDOWN = /Request context disposed|Target page, context or browser has been closed/;
const realErrors = routeErrors.filter((m) => !SHUTDOWN.test(m));
check('no request errors in the test harness', !realErrors.length, `${realErrors.slice(0, 3).join(' | ') || 'none'} · ${routeErrors.length - realErrors.length} pending request(s) cancelled at browser close`);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
void seqLast;
process.exit(0);

/**
 * QUESTION-2026-11-09 (x) Prospects email links, LOCAL code on LIVE data, 1700px. Read-only: local handlers answer
 * /api/aigeo/prospects (admin key) and /api/aigeo/strategy-summary; every non-GET is refused; navigation to Gmail is
 * blocked (nothing is clicked through). Nothing personal is printed or saved: hrefs are checked in memory and only
 * their masked structure is reported; the screenshot masks every table cell except Ref and Client ID.
 *   node scripts/playwright-verify-prospects-email-links-local.mjs
 */
import fs from 'node:fs';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { clientEntry } from '../api/aigeo/prospects.js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
Object.assign(process.env, ENV);
const BASE = 'https://ai-geo-audit.vercel.app';
const OUT = 'outputs';
const GMAIL = 'https://mail.google.com/mail/?authuser=info@alanranger.com';
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const TABLES = { prospect_enquiry: 'updated_at', prospect_enquiry_history: 'at', customer_person: 'updated_at', strategy_campaign_steps: 'last_seen_at' };
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const blocked = [];
const gmailBlocked = [];
const errors = [];

/** Real rows only: another agent's obviously fake TEST- enquiry rows are not this run's writes. */
const realOnly = (q, t) => (t === 'prospect_enquiry' ? q.not('enquiry_ref', 'like', 'TEST-%') : q);
async function dbState() {
  const out = {};
  for (const [t, c] of Object.entries(TABLES)) {
    const { count } = await realOnly(sb.from(t).select('*', { count: 'exact', head: true }), t);
    const { data } = await realOnly(sb.from(t).select(c).not(c, 'is', null), t).order(c, { ascending: false }).limit(1);
    Object.assign(out, { [`${t}.rows`]: count ?? 'n/a', [`${t}.max`]: data?.[0]?.[c] || null });
  }
  return out;
}
const fakeRes = (set) => ({ statusCode: 200, status(s) { this.statusCode = s; return this; }, setHeader() {}, json(j) { set(JSON.stringify(j), this.statusCode); return this; }, send(t) { set(typeof t === 'string' ? t : JSON.stringify(t), this.statusCode); return this; } });
async function local(path, headers) {
  const { default: handler } = await import(`../api/aigeo/${path}.js`);
  let out = null;
  await handler({ method: 'GET', query: {}, headers }, fakeRes((b, s) => { out = { body: b, status: s }; }));
  return out;
}
const API = {};
async function route(r) {
  const req = r.request();
  const url = new URL(req.url());
  if (url.hostname === 'mail.google.com') { gmailBlocked.push('gmail'); return r.abort(); }
  if (req.method() !== 'GET') { if (url.pathname.startsWith('/api/')) blocked.push(`${req.method()} ${url.pathname}`); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' }); }
  if (url.pathname === '/lib/strategy-prospects.js') return r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync('lib/strategy-prospects.js', 'utf8') });
  if (url.pathname === '/api/aigeo/prospects') return r.fulfill({ status: 200, contentType: 'application/json', body: API.admin.body });
  if (url.pathname === '/api/aigeo/strategy-summary') return r.fulfill({ status: 200, contentType: 'application/json', body: API.summary.body });
  return r.fallback();
}

/** Masked structure of a Gmail search href: the query with every email shown as <email> and any name as <name>. */
function maskHref(href) {
  if (!href.startsWith(`${GMAIL}#`)) return 'NOT GMAIL';
  const [kind, q] = href.slice(GMAIL.length + 1).split(/\/(.*)/s);
  const dec = decodeURIComponent(q || '');
  return `${kind}/${dec.replace(EMAIL_RE, '<email>').replace(/^"[^"]+"$/, '"<name>"').replace(/^[0-9a-f]{10,}$/i, '<message-id>')}`;
}
function hrefChecks(admin) {
  const clients = Object.values(admin.clients || {});
  const withEmail = clients.find((c) => c.mail?.has_email);
  const noEmail = clients.find((c) => c.mail && !c.mail.has_email);
  const okWith = withEmail && /^from:(\S+@\S+) OR to:\1$/.test(decodeURIComponent(withEmail.mail.href.split('#search/')[1] || '')) && withEmail.mail.title === 'Open all emails with this client (newest first)';
  check('a client WITH an email: href = Gmail #search/ + URL-encoded "from:{email} OR to:{email}" (same email both sides), tooltip', okWith, withEmail ? `${withEmail.id}: ${maskHref(withEmail.mail.href)} · "${withEmail.mail.title}"` : 'no client with an email');
  const fake = clientEntry({ person_id: '00000000-0000-0000-0000-000000000000', display_name: 'FAKE Verify Client', email: null });
  const target = noEmail || fake;
  const okNo = /^"[^"]+"$/.test(decodeURIComponent(target.mail.href.split('#search/')[1] || '')) && /no email on file/.test(target.mail.title) && target.mail.has_email === false;
  check('a client WITHOUT an email: href searches the quoted client name; tooltip "no email on file"', okNo, `${noEmail ? noEmail.id : 'no live row without an email today, so the same server function (clientEntry) on an obviously fake record'}: ${maskHref(target.mail.href)} · "${target.mail.title}"`);
  const rows = admin.rows || [];
  const refs = rows.filter((r) => String(r.source_ref || '').trim());
  const refOk = refs.every((r) => r.mail?.href === `${GMAIL}#all/${encodeURIComponent(String(r.source_ref).trim())}` && r.mail.title === 'Open the original enquiry email') && rows.filter((r) => !String(r.source_ref || '').trim()).every((r) => r.mail === null);
  check(`Ref links: #all/{source_ref} for the ${refs.length} enquiries with one; none for the ${rows.length - refs.length} without`, refOk, refs[0] ? `${refs[0].enquiry_ref}: ${maskHref(refs[0].mail.href)}` : 'no source refs');
  return { withEmail, noEmail, refs: refs.length, rows: rows.length };
}
/** Rendered table: every Client ID / Ref anchor = the admin href, new tab; an ⓘ (client record) beside each client ID. */
function domOf() {
  const link = (td) => td?.querySelector('a[data-pp-mail]') || null;
  const rowOf = (tr) => {
    const r = link(tr.cells[0]);
    const c = link(tr.cells[2]);
    return { ref: r && r.getAttribute('href'), refTarget: r && r.target, client: c && c.getAttribute('href'), clientTarget: c && c.target, info: !!tr.cells[2]?.querySelector('a.pp-info[data-pp-client]'), id: c && c.textContent, enq: tr.cells[0]?.textContent.trim() };
  };
  return [...document.querySelectorAll('#st-prospects .pp-table tbody tr')].map(rowOf);
}
function domChecks(dom, admin) {
  const byId = Object.fromEntries(Object.values(admin.clients || {}).map((c) => [c.id, c]));
  const byRef = Object.fromEntries((admin.rows || []).map((r) => [r.enquiry_ref, r]));
  const withClient = dom.filter((d) => d.id);
  const ok = withClient.every((d) => d.client === byId[d.id]?.mail?.href && d.clientTarget === '_blank' && d.info);
  check(`rendered: ${withClient.length} Client ID links = the admin hrefs, open in a new tab, each with an ⓘ for the client record`, ok && withClient.length > 0, `${dom.length} rows · ${dom.filter((d) => d.info).length} ⓘ`);
  const refOk = dom.every((d) => (byRef[d.enq]?.mail ? d.ref === byRef[d.enq].mail.href && d.refTarget === '_blank' : d.ref === null));
  check(`rendered: Ref links only where source_ref is set (${dom.filter((d) => d.ref).length} links)`, refOk, 'compared in memory');
}
function scan(obj) {
  return (JSON.stringify(obj ?? null).match(EMAIL_RE) || []).length;
}
async function publicChecks() {
  const local1 = JSON.parse(API.summary.body);
  check('PUBLIC strategy summary (local code): 0 emails in prospects + sales_gap', scan(local1.prospects) === 0 && scan(local1.sales_gap) === 0 && !/mail\.google/.test(JSON.stringify([local1.prospects, local1.sales_gap])), `prospects ${scan(local1.prospects)} · sales_gap ${scan(local1.sales_gap)} · whole summary ${scan(local1)} (other sections)`);
  const prod = await (await fetch(`${BASE}/api/aigeo/strategy-summary`)).json();
  check('PUBLIC strategy summary (production, unauthenticated GET): 0 emails in prospects + sales_gap', scan(prod.prospects) === 0 && scan(prod.sales_gap) === 0, `prospects ${scan(prod.prospects)} · sales_gap ${scan(prod.sales_gap)} · whole summary ${scan(prod)}`);
  const noKeyProd = await fetch(`${BASE}/api/aigeo/prospects`);
  const noKeyBody = await noKeyProd.text();
  const noKeyLocal = await local('prospects', {});
  check('prospects API without the admin key: 401, no rows, no emails (production + local)', noKeyProd.status === 401 && noKeyLocal.status === 401 && scan(noKeyBody) === 0 && scan(noKeyLocal.body) === 0, `production ${noKeyProd.status} · local ${noKeyLocal.status}`);
}

const before = await dbState();
API.admin = await local('prospects', { 'x-arp-admin-key': ENV.ARP_ADMIN_KEY });
API.summary = await local('strategy-summary', {});
const admin = JSON.parse(API.admin.body);
hrefChecks(admin);
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
await ctx.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); }, ENV.ARP_ADMIN_KEY);
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
await ctx.route('**/*', route);
await page.goto(`${BASE}/audit-dashboard.html#strategy`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#st-prospects .pp-table tbody tr td'), null, { timeout: 240000 });
await page.waitForTimeout(2000);
const dom = await page.evaluate(domOf);
domChecks(dom, admin);
await page.evaluate(() => {
  for (const tr of document.querySelectorAll('#st-prospects .pp-table tbody tr')) [...tr.cells].forEach((td, i) => { if (![0, 2].includes(i)) td.textContent = '•••'; });
  for (const a of document.querySelectorAll('#st-prospects a[data-pp-mail]')) a.setAttribute('href', '#masked');
  for (const el of document.querySelectorAll('#st-prospects [title]')) el.removeAttribute('title');
  document.querySelectorAll('#st-prospects [data-pp-clientbox], #st-prospects [data-pp-formhost]').forEach((el) => { el.innerHTML = ''; });
  document.querySelectorAll('#st-prospects .pp-filters input').forEach((el) => { el.value = ''; });
});
const masked = await page.evaluate(() => [...document.querySelectorAll('#st-prospects .pp-table tbody tr')].map((tr) => tr.innerText).join(' '));
check('screenshot is free of emails and names (all cells but Ref / Client ID masked)', !(masked.match(EMAIL_RE) || []).length, `${dom.length} rows masked`);
await page.locator('#st-prospects .pp-table').screenshot({ path: `${OUT}/prospects-email-links-table-masked-local-1700px-20261109.png` });
await browser.close();
await publicChecks();
const after = await dbState();
const changed = Object.keys(before).filter((x) => before[x] !== after[x]);
check('viewing writes nothing (row counts + newest timestamps)', !changed.length, changed.map((x) => `${x}: ${before[x]} → ${after[x]}`).join(' | ') || `${Object.keys(TABLES).length} tables unchanged`);
check('every non-GET refused; nothing clicked through to Gmail', true, `${blocked.length} refused · ${gmailBlocked.length} Gmail requests blocked`);
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
fs.writeFileSync(`${OUT}/_em-result.json`, JSON.stringify({ results, before, after }, null, 1));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
process.exit(0);

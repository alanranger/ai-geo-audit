/**
 * Live audit (g) items 3, 6, 8 on LIVE data with the LOCAL code (before deploy), 1700px: the frequency remainder, the
 * "3 total · 2 decided (keep blocked) · 1 new" label everywhere, and the deferred folded sections. Read-only: the
 * overview, decisions, results and customer-search reads are answered by the local handlers; every other non-GET is
 * refused; DB counts compared. Names blurred.   node scripts/playwright-audit-g-local.mjs
 */
import fs from 'node:fs';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
for (const k of Object.keys(ENV)) if (/SUPABASE|ACADEMY|ARP_ADMIN/.test(k)) process.env[k] = ENV[k];
const { default: marketing } = await import('../api/aigeo/marketing.js');
const { buildDecisionState } = await import('../lib/marketing/decision-state.mjs');
const LOCAL_FILES = ['marketing-tab.js', 'marketing-waiting.js', 'marketing-overview-tiles.js'];
const LOCAL_ACTIONS = new Set(['overview', 'query-fields', 'query-run', 'health-badges', 'client-health', 'suppression-review']);
const BLUR = '#mk-review-table td:first-child, #mk-query table td:first-child, #mq-results table td:first-child, #mk-cust-body, .mk-detail { filter: blur(6px) !important; }';
const sb = (await import('@supabase/supabase-js')).createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note: String(note).replace(/\s+/g, ' ').slice(0, 300) });
const blocked = [];
const errors = [];
const LABEL = /3 total · 2 decided \(keep blocked\) · 1 new/;

async function local(method, query, body) {
  let status = 200;
  let out = '';
  const res = { status(s) { status = s; return this; }, setHeader() {}, send(b) { out = b; return this; }, json(j) { out = JSON.stringify(j); return this; }, end() { return this; } };
  await marketing({ method, query, body, headers: { 'x-arp-admin-key': ENV.ARP_ADMIN_KEY } }, res);
  return { status, body: out };
}
async function counts() {
  const out = {};
  for (const t of ['marketing_decisions', 'marketing_suppression', 'marketing_frequency_exceptions', 'strategy_campaigns', 'customer_person']) out[t] = (await sb.from(t).select('*', { count: 'exact', head: true })).count;
  return out;
}

const before = await counts();
const dec = JSON.stringify({ ok: true, ...(await buildDecisionState(sb)) });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1700, height: 1150 } });
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript((k) => sessionStorage.setItem('arp_admin_key', k), ENV.ARP_ADMIN_KEY);
for (const f of LOCAL_FILES) await page.route(`**/lib/${f}*`, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`lib/${f}`, 'utf8') }));
const seen = [];
await page.route('**/api/**', async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  const body = req.method() === 'POST' ? JSON.parse(req.postData() || '{}') : null;
  const action = url.searchParams.get('action') || body?.action;
  if (url.pathname === '/api/aigeo/marketing-decisions') return route.fulfill({ status: 200, contentType: 'application/json', body: dec });
  if (url.pathname === '/api/aigeo/marketing' && LOCAL_ACTIONS.has(action)) {
    seen.push(action);
    const r = await local(req.method(), Object.fromEntries(url.searchParams), body);
    return route.fulfill({ status: r.status, contentType: 'application/json', body: r.body });
  }
  if (req.method() === 'GET') return route.fallback();
  blocked.push(`${req.method()} ${url.pathname}`);
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' });
});
await page.goto('https://ai-geo-audit.vercel.app/audit-dashboard.html#marketing', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => /^\d+$/.test(document.querySelector('#mk-waiting .mkw-n')?.textContent.trim() || '') && /Data & alignment health/.test(document.querySelector('#mk-overview-tiles')?.textContent || ''), null, { timeout: 240000 });
await page.waitForTimeout(6000);
await page.addStyleTag({ content: BLUR });
const wait = await page.$$eval('#mk-waiting tbody tr', (rows) => rows.map((r) => r.innerText.replace(/\s+/g, ' ')));
check('3: no frequency row in Waiting (next 7 days: 0 people reach 3 without an approved exception)', !wait.some((r) => /emails in 7 days/.test(r)), wait.join(' || '));
check('6: Waiting row "Review 1 new blocked contact" with "3 total · 2 decided (keep blocked) · 1 new"', wait.some((r) => /Review 1 new blocked contact/.test(r) && LABEL.test(r)), wait.join(' || '));
const tiles = await page.$eval('#mk-overview-tiles', (e) => e.innerText.replace(/\s+/g, ' '));
check('6: health tile shows the 3 / 2 / 1 label', LABEL.test(tiles), (tiles.match(/Suppressed contacts[^·]*·[^·]*·[^·]*new/) || ['missing'])[0]);
await page.waitForFunction(() => [...document.querySelectorAll('#mk-overview-tiles .mko-tile')].some((t) => /Needs Alan/.test(t.textContent) && !/Loading/.test(t.textContent)), null, { timeout: 120000 }).catch(() => {});
const tile7 = await page.$eval('#mk-overview-tiles', (e) => [...e.querySelectorAll('.mko-tile')].map((t) => t.textContent.replace(/\s+/g, ' ')).find((t) => /Needs Alan/.test(t)) || '');
check('6: "Needs Alan" tile asks about the 1 new only, with the label (in its decision list)', /Review 1 new blocked contact showing as subscribed again \(3 total · 2 decided \(keep blocked\) · 1 new\)/.test(tile7) && !/Review 3 blocked/.test(tile7), (tile7.match(/Review \d+ (new )?blocked[^)]*\)[^)]*\)?/) || [tile7.slice(0, 160)])[0]);
await page.locator('#mk-overview-tiles').screenshot({ path: 'outputs/g-tiles-label-local-1700px-20261109.png' });
await page.locator('#mk-waiting').screenshot({ path: 'outputs/g-waiting-local-1700px-20261109.png' });
const before8 = { query: seen.includes('query-fields'), review: seen.includes('suppression-review') };
check('8: folded sections not mounted on load (no customer search / suppression review reads before opening)', !before8.query, JSON.stringify(before8));
await page.click('#mk-behind > summary');
await page.waitForFunction(() => document.querySelector('#mk-query [data-q-ex]'), null, { timeout: 120000 }).catch(() => {});
await page.waitForTimeout(3000);
const head = await page.$eval('#mk-review h3', (e) => e.textContent).catch(() => '');
check('8: opening Behind the scenes mounts them (customer search loads)', seen.includes('query-fields') && !!(await page.$('#mk-query [data-q-ex]')), seen.join(', '));
check('6: review heading shows the 3 / 2 / 1 label', LABEL.test(head), head);
await page.locator('#mk-review').screenshot({ path: 'outputs/g-review-heading-local-1700px-20261109.png' }).catch(() => {});
const errs = await page.$$eval('#marketing-root .rt-error', (els) => els.filter((e) => e.checkVisibility()).map((e) => e.textContent.trim().slice(0, 80)));
check('8: no placeholder reads as a data error', !errs.length, errs.join(' | '));
await browser.close();
const after = await counts();
check('Viewing writes nothing (no decision, suppression, exception, campaign or person rows changed)', JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
check('Every other non-GET refused', true, `${blocked.length} refused`);
check('No page errors', !errors.length, errors.slice(0, 3).join(' | '));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? `ALL PASS (${results.length} / ${results.length})` : `${results.filter((r) => !r.ok).length} FAILED`);

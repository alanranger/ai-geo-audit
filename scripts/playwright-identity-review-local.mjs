/**
 * Client list health: the identity review-queue line ("N identity cases to review ›") and the "Undecided (identity
 * review)" consent badge, on LIVE data with the LOCAL code (before deploy), 1700px. Read-only: the read actions
 * (client-health, query-fields, query-run, health-badges) are answered by the local marketing handler; every other
 * non-GET is refused; DB counts compared. Names blurred.   node scripts/playwright-identity-review-local.mjs
 */
import fs from 'node:fs';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
Object.assign(process.env, { SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: ENV.SUPABASE_SERVICE_ROLE_KEY, ARP_ADMIN_KEY: ENV.ARP_ADMIN_KEY });
const { default: handler } = await import('../api/aigeo/marketing.js');
const LOCAL = new Set(['client-health', 'query-fields', 'query-run', 'health-badges']);
const BLUR = '#mk-query table td:first-child, #mq-results table td:first-child, #mq-detail, #mk-review-table td:first-child, #mk-cust-body, .mk-detail { filter: blur(6px) !important; }';
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note: String(note).replace(/\s+/g, ' ').slice(0, 300) });
const blocked = [];
const errors = [];

async function local(method, query, body) {
  let status = 200;
  let out = '';
  const res = { status(s) { status = s; return this; }, setHeader() {}, send(b) { out = b; return this; }, json(j) { out = JSON.stringify(j); return this; }, end() { return this; } };
  await handler({ method, query, body, headers: { 'x-arp-admin-key': ENV.ARP_ADMIN_KEY } }, res);
  return { status, body: out };
}
async function counts() {
  const out = {};
  for (const t of ['customer_person', 'marketing_decisions', 'marketing_suppression', 'strategy_campaigns']) out[t] = (await sb.from(t).select('*', { count: 'exact', head: true })).count;
  return out;
}

const before = await counts();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1700, height: 1150 } });
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript((k) => sessionStorage.setItem('arp_admin_key', k), ENV.ARP_ADMIN_KEY);
await page.route('**/lib/marketing-client-health.js*', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync('lib/marketing-client-health.js', 'utf8') }));
await page.route('**/api/**', async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  const body = req.method() === 'POST' ? JSON.parse(req.postData() || '{}') : null;
  const action = url.searchParams.get('action') || body?.action;
  if (url.pathname === '/api/aigeo/marketing' && LOCAL.has(action)) {
    const r = await local(req.method(), Object.fromEntries(url.searchParams), body);
    return route.fulfill({ status: r.status, contentType: 'application/json', body: r.body });
  }
  if (req.method() === 'GET') return route.fallback();
  blocked.push(`${req.method()} ${url.pathname}`);
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' });
});
await page.goto('https://ai-geo-audit.vercel.app/audit-dashboard.html#marketing', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#mk-planned [data-mk-open-health]', { timeout: 180000 });
await page.waitForSelector('#mk-query [data-q-ex]', { timeout: 180000, state: 'attached' });
await page.addStyleTag({ content: BLUR });
await page.click('#mk-planned [data-mk-open-health]');
await page.waitForSelector('#mk-client-health .ch-review, #mk-client-health .ch-matrix', { timeout: 120000 });
await page.waitForTimeout(1500);
const line = await page.$eval('#mk-client-health .ch-review', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
const matrixRows = await page.$$eval('#mk-client-health .ch-matrix tbody tr', (r) => r.length);
check('Health: one review-queue line "N identity cases to review ›" (matrix unchanged)', /^\d+ identity cases? to review ›/.test(line) && matrixRows === 6, `${line.slice(0, 160)} · matrix rows ${matrixRows}`);
await page.locator('#mk-client-health').screenshot({ path: 'outputs/k-health-review-line-local-1700px-20261109.png' });
const n = Number((line.match(/^(\d+)/) || [])[1]);
await page.click('#mk-client-health .ch-review .ch-num');
await page.waitForFunction(() => /people/.test(document.querySelector('#mq-results')?.textContent || '') && !/Running/.test(document.querySelector('#mq-results')?.textContent || ''), null, { timeout: 120000 });
await page.waitForTimeout(3000);
const head = (await page.locator('#mq-results').innerText()).replace(/\s+/g, ' ').slice(0, 200);
const badges = await page.$$eval('#mq-results .hb-consent', (els) => els.map((e) => e.textContent.trim()));
check('Clicking it opens the same review list in Customers (same count)', new RegExp(`\\b${n} people`).test(head), head);
check('Undecided list: each consent badge reads "Undecided (identity review)", never "No email held"', badges.length > 0 && badges.every((t) => t === 'Undecided (identity review)'), `${badges.length} badges: ${[...new Set(badges)].join(' / ')}`);
await page.locator('#mk-query').screenshot({ path: 'outputs/k-undecided-badges-local-1700px-20261109.png' });
const pill = page.locator('#mq-results .hb-consent').first();
if (await pill.count()) {
  await pill.click();
  await page.waitForTimeout(4000);
  const head2 = (await page.locator('#mq-results').innerText()).replace(/\s+/g, ' ').slice(0, 160);
  check('Clicking an "Undecided" badge lists the review queue (identity unresolved)', new RegExp(`\\b${n} people`).test(head2), head2);
}
await browser.close();
const after = await counts();
check('Viewing writes nothing (row counts unchanged)', JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
check('Every other non-GET refused', true, `${blocked.length} refused`);
check('No page errors', !errors.length, errors.slice(0, 3).join(' | '));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? `ALL PASS (${results.length} / ${results.length})` : `${results.filter((r) => !r.ok).length} FAILED`);

/**
 * Final fix round items 2 + 5 on LIVE data with the LOCAL code (before deploy), 1700px. Read-only: serves the local
 * lib/marketing-query.js and answers query-fields / query-run with the local marketing handler; every other non-GET is
 * refused. Names are blurred. Screenshots: the Pick n Mix recipe result and the Customer value table.
 *   node scripts/playwright-verify-items2-5-local.mjs
 */
import fs from 'node:fs';
import { chromium } from 'playwright';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
Object.assign(process.env, { SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: ENV.SUPABASE_SERVICE_ROLE_KEY, ARP_ADMIN_KEY: ENV.ARP_ADMIN_KEY });
const { default: handler } = await import('../api/aigeo/marketing.js');
const LOCAL_ACTIONS = new Set(['query-fields', 'query-run']);
const BLUR = '#mk-query table td:first-child, #mq-detail, #mk-review-table td:first-child, #mk-cust-body, .mk-detail { filter: blur(6px) !important; }';
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });

async function local(method, query, body) {
  let status = 200;
  let out = '';
  const res = { status(s) { status = s; return this; }, setHeader() {}, send(b) { out = b; return this; }, json(j) { out = JSON.stringify(j); return this; }, end() { return this; } };
  await handler({ method, query, body, headers: { 'x-arp-admin-key': ENV.ARP_ADMIN_KEY } }, res);
  return { status, body: out };
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
await page.addInitScript((k) => sessionStorage.setItem('arp_admin_key', k), ENV.ARP_ADMIN_KEY);
await page.route('**/lib/marketing-query.js*', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync('lib/marketing-query.js', 'utf8') }));
await page.route('**/api/**', async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  const body = req.method() === 'POST' ? JSON.parse(req.postData() || '{}') : null;
  const action = url.searchParams.get('action') || body?.action;
  if (url.pathname === '/api/aigeo/marketing' && LOCAL_ACTIONS.has(action)) {
    const r = await local(req.method(), Object.fromEntries(url.searchParams), body);
    return route.fulfill({ status: r.status, contentType: 'application/json', body: r.body });
  }
  if (req.method() === 'GET') return route.fallback();
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' });
});
await page.goto('https://ai-geo-audit.vercel.app/audit-dashboard.html#marketing', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#mk-query [data-q-ex]', { timeout: 180000 });
await page.addStyleTag({ content: BLUR });
const labels = await page.$$eval('#mk-query [data-q-ex]', (els) => els.map((e) => e.textContent));
check('recipe buttons: "7 Pick n Mix candidates (agreed broad rule)" and "13 Beginners → next step (12 months)"', labels[6] === '7 Pick n Mix candidates (agreed broad rule)' && labels.includes('13 Beginners → next step (12 months)'), labels.slice(5, 8).concat(labels.slice(-1)).join(' | '));
await page.click('#mk-query [data-q-ex="6"]');
await page.waitForFunction(() => /people/.test(document.querySelector('#mq-results')?.textContent || '') && !/Running/.test(document.querySelector('#mq-results')?.textContent || ''), null, { timeout: 120000 });
await page.waitForTimeout(1500);
const head = (await page.locator('#mq-results').innerText()).replace(/\s+/g, ' ').slice(0, 220);
const builder = (await page.locator('#mq-builder').innerText()).replace(/\s+/g, ' ');
check('recipe 7 runs the agreed broad rule (6-month open + any booking/purchase 24 months OR Pick n Mix any time)', /within the last/.test(builder) && /pick/i.test(builder) && /128 people/.test(head), head);
await page.locator('#mk-query').scrollIntoViewIfNeeded();
await page.screenshot({ path: 'outputs/items2-5-pnm-recipe-local-1700px-20261108.png' });
await page.selectOption('#mq-preset', 'value');
await page.waitForFunction(() => /Avg order £ \(net ÷ orders\)/.test(document.querySelector('#mq-results')?.textContent || ''), null, { timeout: 120000 });
await page.waitForTimeout(1500);
const cols = await page.$$eval('#mq-results thead th', (els) => els.map((e) => e.textContent.replace(/[▲▼↑↓]/g, '').trim()));
check('Customer value columns: orders incl. plan payments, avg = net ÷ orders, last paid purchase (confirmed) vs last activity (any evidence)', ['Orders (incl. plan payments)', 'Avg order £ (net ÷ orders)', 'Last paid purchase (confirmed)', 'Last activity (any evidence)'].every((c) => cols.some((x) => x.startsWith(c))), cols.join(' | '));
const rows = await page.$$eval('#mq-results tbody tr', (trs) => trs.slice(0, 15).map((tr) => [...tr.querySelectorAll('td')].map((td) => ({ t: td.textContent.trim(), tip: td.querySelector('[title]')?.getAttribute('title') || '' }))));
const idx = (name) => cols.findIndex((c) => c.startsWith(name));
const money = (s) => Number(String(s).replace(/[£,]/g, '')) || 0;
const ok = rows.filter((r) => money(r[idx('Orders')]?.t) > 0).every((r) => Math.abs(money(r[idx('Known net')].t) - money(r[idx('Avg order')].t) * money(r[idx('Orders')].t)) <= money(r[idx('Orders')].t) * 1);
check('on screen: net ≈ avg × orders on every row (rounding to £1 per order); tooltip shows gross / refunds / net', ok && /gross £.* · refunds £.* · net £/.test(rows[0]?.[idx('Avg order')]?.tip || ''), rows[0]?.[idx('Avg order')]?.tip || '');
await page.evaluate(() => {
  const t = document.querySelector('#mq-results table');
  t?.scrollIntoView({ block: 'start' });
  document.querySelector('#mq-results').style.zoom = '0.7';
});
await page.waitForTimeout(600);
await page.screenshot({ path: 'outputs/items2-5-customer-value-local-1700px-20261108.png' });
await browser.close();
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);

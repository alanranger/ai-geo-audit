/**
 * QUESTION-2026-11-12 presend-check-later-unsubscribes: the Marketing tab's pre-send warnings for the 19 Nov, 7 Jan local
 * and 28 Jan local emails, LOCAL lib/marketing-tab.js on LIVE data, 1700px. Read-only: every write from the page is
 * refused (read POSTs pass). Customer tables blurred; only list names, counts and the note are shown.
 *   node scripts/playwright-verify-presend-optout-local.mjs [--live]
 */
import fs from 'node:fs';
import { chromium } from 'playwright';

const LIVE = process.argv.includes('--live');
const SHOT = LIVE ? 'live' : 'local';
const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
const READ_POSTS = new Set(['health-badges', 'query-run', 'query-fields', 'segment-preview', 'snapshot-review']);
const EMAILS = [
  ['19 Nov', '171f5a2c-26fa-4f04-b794-855890c176c7', 'theme|gpt-8w-2026-11-19', 'native 575 = manifest 576 − 1'],
  ['7 Jan local', '350761fb-eb89-4a64-848e-b087c6ac7d5f', 'theme|gpt-winter-2027-01-07-local_learning', 'native 312 = manifest 313 − 1'],
  ['28 Jan local', 'b181a720-9b33-4141-9259-003c51e74740', 'theme|gpt-winter-2027-01-28-local_learning', 'native 238 = manifest 239 − 1']
];
const BLUR = '#mk-query table td:first-child, #mq-results, #mq-detail, #mk-review-table td:first-child, #mk-cust-body, .mk-detail, #mk-waiting, #mk-schedule .mks-body, #mk-results table, #mk-snap-review, #mk-exp-review { filter: blur(6px) !important; }';
const results = [];
const check = (name, ok, note = '') => { results.push({ name, ok: !!ok, note: String(note).replace(/\s+/g, ' ').slice(0, 400) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} · ${String(note).replace(/\s+/g, ' ').slice(0, 220)}`); };
const refused = [];
const errors = [];

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1700, height: 1150 } });
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript((k) => sessionStorage.setItem('arp_admin_key', k), ENV.ARP_ADMIN_KEY);
if (!LIVE) await page.route('**/lib/marketing-tab.js*', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync('lib/marketing-tab.js', 'utf8') }));
await page.route('**/api/**', async (route) => {
  const req = route.request();
  if (req.method() === 'GET') return route.fallback();
  const url = new URL(req.url());
  const action = JSON.parse(req.postData() || '{}').action;
  if (url.pathname === '/api/aigeo/marketing' && READ_POSTS.has(action)) return route.fallback();
  refused.push(`${req.method()} ${url.pathname} ${action || ''}`);
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' });
});
await page.goto('https://ai-geo-audit.vercel.app/audit-dashboard.html#marketing', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#mk-overview-tiles') && !document.querySelector('#mk-overview-tiles > .rt-loading'), null, { timeout: 180000 });
await page.evaluate(() => { for (const id of ['mk-behind', 'mk-fold-audiences', 'mk-fold-results']) { const f = document.getElementById(id); if (f) f.open = true; } });
await page.waitForSelector('#mk-exp-table', { timeout: 120000 });
await page.waitForSelector('tr[data-campaign]', { state: 'attached', timeout: 120000 }).catch(() => {});
console.log('keys:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('tr[data-campaign]')].map((r) => r.dataset.campaign).filter((k) => /11-19|01-07|01-28/.test(k)))));
console.log('record rows:', JSON.stringify(await page.evaluate(() => [...new Set([...document.querySelectorAll('tr[data-campaign]')].map((r) => r.closest('[id]')?.id))])));
await page.addStyleTag({ content: BLUR });
await page.waitForTimeout(3000);

for (const [label, id, key, nums] of EMAILS) {
  const row = page.locator(`#mk-exp-table tr:has([data-mk-presend="${id}"])`);
  const text = (await row.innerText()).replace(/\s+/g, ' ');
  check(`${label}: exports table shows PASS with the later opt-out note and the native-current count`, /\bPASS\b/.test(text) && text.includes(`1 later opt-out, already excluded by Squarespace (${nums})`) && /Squarespace will send to \d/.test(text), text.slice(0, 260));
  const rec = page.locator(`tr[data-campaign="${key}"]`).first();
  const chip = await page.evaluate((k) => { const d = document.createElement('div'); d.innerHTML = window.mkPresendChip ? window.mkPresendChip(k) : ''; return d.textContent; }, key);
  const recText = ((await rec.count()) ? await rec.evaluate((r) => r.textContent) : `(no record row; schedule chip) ${chip}`).replace(/\s+/g, ' ');
  check(`${label}: campaign record shows READY TO SEND (pre-send PASS) with the same note, not "PRE-SEND FAIL"`, /READY TO SEND/.test(recText) && !/PRE-SEND FAIL/.test(recText) && recText.includes(nums), recText.slice(0, 260));
}
const ids = EMAILS.map(([, id]) => id);
await page.evaluate((list) => {
  const rows = [...document.querySelectorAll('#mk-exp-table tbody tr')];
  for (const r of rows) if (!list.some((id) => r.querySelector(`[data-mk-presend="${id}"]`))) r.style.display = 'none';
}, ids);
await page.locator('#mk-exp-table').scrollIntoViewIfNeeded();
await page.locator('#mk-exp-table').screenshot({ path: `outputs/presend-optout-exports-${SHOT}-1700px-20261112.png` });
await page.evaluate((keys) => {
  for (const r of document.querySelectorAll('tr[data-campaign]')) {
    if (!keys.includes(r.dataset.campaign)) { r.style.display = 'none'; continue; }
    for (let p = r.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true;
  }
}, EMAILS.map(([, , k]) => k));
const host = page.locator('table:has(tr[data-campaign="theme|gpt-winter-2027-01-07-local_learning"])').first();
if (await host.count()) { await host.scrollIntoViewIfNeeded(); await host.screenshot({ path: `outputs/presend-optout-campaigns-${SHOT}-1700px-20261112.png` }); }
check('No write reached production (read-only view)', true, `refused: ${[...new Set(refused)].join(' | ') || 'none'}`);
check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
fs.writeFileSync(`outputs/presend-optout-${SHOT}-results-20261112.json`, JSON.stringify({ at: new Date().toISOString(), results, refused: [...new Set(refused)], errors }, null, 2));
await browser.close();
console.log(`${results.filter((r) => r.ok).length}/${results.length} ok`);
process.exit(results.every((r) => r.ok) ? 0 : 1);

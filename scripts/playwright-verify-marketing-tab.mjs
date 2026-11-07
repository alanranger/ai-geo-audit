/**
 * Live check of the Marketing & Campaigns tab (no personal data printed; screenshots stay local in C:/TEMP).
 *   node scripts/playwright-verify-marketing-tab.mjs [--sync]
 */
import fs from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.DASH_BASE || 'https://ai-geo-audit.vercel.app';
const key = fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).find((l) => l.startsWith('ARP_ADMIN_KEY=')).slice(14).replace(/^"|"$/g, '').trim();
const out = 'C:/TEMP/mk-verify';
fs.mkdirSync(out, { recursive: true });
const results = [];
const check = (name, ok, note = '') => { results.push({ name, ok: !!ok, note }); };

const noKey = await fetch(`${BASE}/api/aigeo/marketing?action=overview`);
check('route refuses without admin key', noKey.status === 401, `status ${noKey.status}`);
const csv = await fetch(`${BASE}/api/aigeo/marketing?action=export-csv&export_id=x`);
check('CSV route refuses without admin key', csv.status === 401, `status ${csv.status}`);
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript((k) => sessionStorage.setItem('arp_admin_key', k), key);
await page.goto(`${BASE}/audit-dashboard.html#marketing`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#mk-segments', { timeout: 120000 }).catch(() => {});
const ids = ['mk-budget', 'mk-campaign-host', 'mk-segments', 'mk-exports', 'mk-customers', 'mk-engagement', 'mk-sources', 'mk-settings'];
for (const id of ids) check(`section #${id} on direct load`, await page.$(`#${id}`));
await page.waitForSelector('#st-campaign-table', { timeout: 60000 }).catch(() => {});
check('Campaign steps table on Marketing tab', await page.$('#mk-campaign-host #st-campaign-table'));
check('send line uses billing-cycle meter', /Billing cycle|no Squarespace meter/.test(await page.textContent('#mk-campaign-host').catch(() => '')));
check('segments listed', (await page.$$('#mk-seg-table tbody tr')).length >= 8);
check('list-import rule explained (allowed only with checks)', /only loaded through "Load into Squarespace list"/.test(await page.textContent('#mk-segments')));
await page.screenshot({ path: `${out}/1-marketing-top.png` });
const strip = await page.textContent('section[data-panel="marketing"] .rt-strip');
check('subscribers tile shows the eligible count', /923/.test(strip), strip.match(/Subscribers\s*([\d,]+)/)?.[1] || '');
check('no stale collector warning in Data health', !/collector (stale|failed)/i.test(strip), strip.match(/Data health[^·]*/)?.[0]?.slice(0, 80) || '');
const eng = await page.textContent('#mk-engagement');
check('backfill line reads real totals', /Backfill: 163 of 163 campaigns · complete · last run/.test(eng), eng.match(/Backfill:[^\n]{0,80}/)?.[0] || '');
check('engagement explained as real open/click times', /real time of each person's latest recorded open/.test(eng));
await page.waitForSelector('#mk-review-table tbody tr', { timeout: 60000 }).catch(() => {});
const review = await page.$$eval('#mk-review-table tbody tr', (trs) => trs.map((tr) => [...tr.cells].map((c) => c.textContent.trim().replace(/\S+@\S+/g, '<email>'))));
check('review shows the 2 still-blocked people with evidence', review.length === 2 && review.every((r) => /\d/.test(r[2]) && r[8].includes('Clear')), review.map((r) => `${r[2]} · opens since ${r[4]} · orders since ${r[6]}`).join(' | '));
await page.locator('#mk-review').screenshot({ path: `${out}/5-review-and-clear.png` });
await page.locator('#mk-engagement').screenshot({ path: `${out}/6-engagement.png` });

await page.selectOption('#mk-cust-seg', 'beginners-no-lightroom-local');
await page.click('[data-mk="cust-search"]');
await page.waitForSelector('#mk-cust-table tbody tr', { timeout: 60000 }).catch(() => {});
const rows = await page.$$('#mk-cust-table tbody tr[data-mk-person]');
check('customer list loads for a segment', rows.length > 0, `${rows.length} rows`);
if (rows.length) {
  await rows[0].click();
  await page.waitForSelector('.mk-detail', { timeout: 60000 }).catch(() => {});
  check('customer detail opens', await page.$('.mk-detail'));
}
await page.locator('#mk-segments').screenshot({ path: `${out}/2-segments.png` });

const expRows = await page.$$eval('#mk-exp-table tbody tr', (trs) => trs.map((tr) => tr.textContent.replace(/\S+@\S+/g, '<email>').replace(/\s+/g, ' ').trim()));
const testRows = expRows.filter((t) => /ARP \| TEST \| (load-check|flip-check|flip-fix)/.test(t));
check('3 test snapshots listed, all LOADED', testRows.length === 3 && testRows.every((t) => /LOADED/.test(t)), `${testRows.length} rows`);
check('test (a) row: unsubscribed address dropped before import', testRows.some((t) => /load-check/.test(t) && /1 imported/.test(t) && /dropped before import: 1/.test(t)));
check('flip-fix row: flip set back + All Subscribers 925 → 926 → 925', testRows.some((t) => /flip-fix/.test(t) && /set back to unsubscribed/.test(t) && /925 → 926 → 925 after fix/.test(t)));
check('pre-send column shows PASS / NOT CHECKED', testRows.every((t) => /PASS|NOT CHECKED/.test(t)));
await page.locator('#mk-exports').screenshot({ path: `${out}/7-snapshots.png` });
await page.locator('#mk-exp-table tr', { hasText: 'load-check' }).locator('[data-mk-presend]').click();
await page.waitForSelector('#mk-modal', { timeout: 10000 }).catch(() => {});
check('pre-send progress window appears', await page.$('#mk-modal .mk-prog'));
await page.screenshot({ path: `${out}/8-presend-progress.png` });
await page.waitForFunction(() => /Pre-send check: (PASS|FAIL|FAILED)/.test(document.querySelector('#mk-modal')?.textContent || ''), null, { timeout: 120000 }).catch(() => {});
check('pre-send check returns PASS', /Pre-send check:\s*PASS/.test(await page.textContent('#mk-modal').catch(() => '')));
await page.screenshot({ path: `${out}/9-presend-result.png` });
await page.click('#mk-modal .rf-btn').catch(() => {});

const overflow = await page.evaluate(() => [...document.querySelectorAll('section[data-panel="marketing"] .rt-section')].filter((s) => s.scrollWidth > s.clientWidth + 2).map((s) => s.id));
check('no section wider than the page', !overflow.length, overflow.join(','));

if (process.argv.includes('--sync')) {
  await page.click('[data-mk="sync"]');
  await page.waitForSelector('#mk-modal', { timeout: 10000 }).catch(() => {});
  check('sync progress window appears', await page.$('#mk-modal'));
  await page.screenshot({ path: `${out}/3-sync-progress.png` });
  await page.waitForSelector('#mk-modal', { state: 'detached', timeout: 240000 }).catch(() => {});
  await page.waitForSelector('#mk-sources', { timeout: 120000 });
  const pills = await page.$$eval('#mk-sources .rt-pill', (els) => els.map((e) => e.textContent.trim()));
  check('sync finished, steps show OK', pills.filter((p) => p === 'OK').length >= 4, pills.join(','));
  await page.locator('#mk-sources').screenshot({ path: `${out}/4-sources.png` });
}

/* BLOCKED and in-progress rows: same live code, the overview response edited in the browser only (nothing stored). */
const mock = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await mock.addInitScript((k) => sessionStorage.setItem('arp_admin_key', k), key);
await mock.route('**/api/aigeo/marketing?action=overview*', async (route) => {
  const res = await route.fetch();
  const j = await res.json();
  const [a, b] = j.exports;
  Object.assign(a, { status: 'blocked_do_not_send', is_test: false, load_result: { ...a.load_result, flips: 1, action: 'Do not send to this list. (mock)' }, load_run: null });
  Object.assign(b, { status: 'loading', load_run: { run_id: 'mock', status: 'running', started_at: new Date(Date.now() - 90000).toISOString(), heartbeat_at: new Date().toISOString(), items_done: 2, checkpoint: { step: 'Waiting for Squarespace to finish the import' } } });
  await route.fulfill({ response: res, json: j });
});
await mock.goto(`${BASE}/audit-dashboard.html#marketing`, { waitUntil: 'domcontentloaded' });
await mock.waitForSelector('#mk-exp-table', { timeout: 120000 }).catch(() => {});
const blockedRow = await mock.locator('#mk-exp-table tbody tr').first().textContent().catch(() => '');
check('BLOCKED row renders red "do not send", no PASS shown', /BLOCKED — DO NOT SEND/.test(blockedRow) && /DO NOT SEND list blocked/.test(blockedRow) && !/PASS/.test(blockedRow) && (await mock.$$('#mk-exp-table tbody tr:first-child .rt-pill.bad')).length === 3);
check('running load shows % bar, step and alive', /50% · step 3 of 4: Waiting for Squarespace.*alive/.test(await mock.textContent('#mk-exp-table [data-mk-run]').catch(() => '')));
const live = strip.match(/Data health\s*(\d+) to check/)?.[1];
const mocked = (await mock.textContent('section[data-panel="marketing"] .rt-strip').catch(() => '')).match(/Data health\s*(\d+) to check/)?.[1];
check('Data health counts the blocked list (one more warning)', Number(mocked) === Number(live || 0) + 1, `${live || 0} → ${mocked}`);
await mock.locator('#mk-exports').screenshot({ path: `${out}/10-blocked-and-progress-mock.png` });
await mock.close();

await page.click('.aigeo-nav-item[data-panel="strategy"]');
await page.waitForSelector('#st-campaign', { timeout: 120000 }).catch(() => {});
check('Strategy shows Next campaign link', /Next campaign/.test(await page.textContent('#st-campaign').catch(() => '')));
check('Strategy no longer has the steps table', !(await page.$('#strategy-root #st-campaign-table')));
await page.click('#st-campaign [data-goto-marketing]').catch(() => {});
await page.waitForTimeout(1500);
check('link opens Marketing tab', await page.$('.aigeo-panel[data-panel="marketing"].is-active'));

await page.goto(`${BASE}/audit-dashboard.html#strategy`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#st-campaign', { timeout: 120000 }).catch(() => {});
check('Strategy direct load still works', /Next campaign/.test(await page.textContent('#st-campaign').catch(() => '')));
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
await browser.close();
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);

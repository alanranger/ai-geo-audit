/**
 * Parts 2 + 5 (combined fixes 7 Nov 2026) live check on Marketing & Campaigns: campaign steps vs the S3d mock-up,
 * campaign results, list-load safety text, TEST snapshots hidden, and the clean-up workflow end to end on Alan's own
 * TEST records (dry run: nothing changes). Screenshots stay local: C:/TEMP/p25-verify.
 *   node scripts/playwright-verify-part2-5.mjs '{"r11":248}'
 */
import fs from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.DASH_BASE || 'https://ai-geo-audit.vercel.app';
const key = fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).find((l) => l.startsWith('ARP_ADMIN_KEY=')).slice(14).replace(/^"|"$/g, '').trim();
const expect = JSON.parse(process.argv[2] || '{}');
const out = 'C:/TEMP/p25-verify';
fs.mkdirSync(out, { recursive: true });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const num = (s) => Number(String(s || '').replace(/[^\d]/g, ''));

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
async function open(width) {
  const page = await browser.newPage({ viewport: { width, height: 1100 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); }, key);
  await page.goto(`${BASE}/audit-dashboard.html?tab=marketing#marketing`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#st-campaign-table', { timeout: 180000 }).catch(() => {});
  await page.waitForSelector('#mc-ledger', { timeout: 120000 }).catch(() => {});
  return { page, errors };
}

const { page, errors } = await open(1600);
const steps = await page.$$eval('#st-campaign-table tbody tr', (trs) => trs.map((tr) => ({ day: tr.children[1]?.innerText, step: tr.querySelector('.st-step')?.innerText || '', brief: tr.children[3]?.querySelector('.rt-sub')?.innerText || '', feat: tr.children[4]?.innerText || '' })));
check('every step is a specific action with a one-line brief', steps.length > 0 && steps.every((s) => s.step && s.brief && !/Prepare both posts|Publish the direct-offer post/.test(s.step)), steps.map((s) => s.step).join(' | '));
check('no "full list" default on the weekly email', !steps.some((s) => /full list/i.test(`${s.step} ${s.brief}`)));
check('email step names its audience (or says it is not chosen)', /Audience not chosen yet|To: /.test(await page.textContent('#st-campaign-table')));
check('feature line is compact (no long offer notes repeated)', steps.every((s) => !/book by .* 23:59|instead of £/.test(s.feat)), steps.map((s) => s.feat.length).join(','));
const days = steps.map((s) => s.day.replace(/\s+/g, ' '));
check('passed days show the planned date and "late" (no silent rollover)', days.some((d) => /planned/.test(d) && /late/.test(d)) || !days.some((d) => /late/.test(d)), days.slice(0, 3).join(' / '));
const colours = await page.$$eval('#st-campaign-table .st-tag', (els) => [...new Set(els.map((e) => `${e.textContent}=${getComputedStyle(e).backgroundColor}`))]);
check('moment labels amber / green / blue, no red', colours.every((c) => !/rgb\(1(2[0-9]|[3-9][0-9])|rgb\(2[0-9]{2}, ?[0-6][0-9]?, ?[0-6][0-9]?\)/.test(c.split('=')[1]) || /Last|Catch/.test(c)), colours.join(' · '));
await page.locator('#mk-campaign-host').screenshot({ path: `${out}/1600-campaign-steps.png` });
const recs = await page.textContent('#st-campaign-records').catch(() => '');
check('unsent campaigns show "Not sent yet: no results"', /Not sent yet: no results/.test(recs));
check('no booking/£ result against an unsent campaign', !/Proposed[^]*?\d+ bookings? · £\d+ · \d+ tagged sessions/.test(recs));
check('obsolete "unsubscribes are not available" text removed', !/unsubscribes are not available|no email-stats API/.test(await page.textContent('#mk-campaign-host')));

const exp = await page.textContent('#mk-exports');
check('residual risk stated on the snapshots section', /Residual risk/.test(exp));
check('production loads switched off until the risk is accepted', /Production list loads are switched off/.test(exp));
const testRows = await page.$$eval('#mk-exp-table tbody tr', (trs) => trs.filter((t) => /\btest\b/.test(t.querySelector('td')?.innerText || '')).length);
check('TEST snapshots hidden by default', testRows === 0, `${testRows} test rows shown`);
const toggle = page.locator('[data-mk-tests]');
if (await toggle.count()) {
  await toggle.click();
  await page.waitForTimeout(300);
  check('TEST snapshots shown on request', (await page.$$eval('#mk-exp-table tbody tr', (trs) => trs.filter((t) => /\btest\b/.test(t.querySelector('td')?.innerText || '')).length)) > 0);
}

/* clean-up: TEST records end to end (dry run) */
await page.selectOption('#mc-mode', 'test');
await page.click('[data-mc="review"]');
await page.waitForSelector('#mc-out [data-mc="freeze"]', { timeout: 120000 }).catch(() => {});
check('clean-up review (TEST) shows exact counts', /match · .* eligible for the action/.test(await page.textContent('#mc-out')));
await page.click('[data-mc="freeze"]');
await page.waitForSelector('#mc-confirm', { timeout: 120000 }).catch(() => {});
const want = (await page.textContent('#mc-out')).match(/APPROVE \d+/)?.[0];
await page.fill('#mc-confirm', 'APPROVE 999');
await page.click('[data-mc="approve"]');
await page.waitForTimeout(2500);
check('approval refused unless the exact count is typed', /type exactly/.test(await page.textContent('#mc-out')));
await page.click('[data-mc-open]');
await page.fill('#mc-confirm', want || '');
await page.click('[data-mc="approve"]');
await page.waitForSelector('#mc-out [data-mc="execute"]', { timeout: 60000 }).catch(() => {});
await page.click('[data-mc="execute"]');
await page.waitForSelector('#mc-out [data-mc="verify"]', { timeout: 120000 }).catch(() => {});
check('dry-run execution re-checks every record, changes nothing', /re-checked \(dry run: nothing was changed/.test(await page.textContent('#mc-out')));
await page.click('[data-mc="verify"]');
await page.waitForFunction(() => /Verified:/.test(document.querySelector('#mc-out')?.textContent || ''), null, { timeout: 120000 }).catch(() => {});
check('verification: outcomes + protected still protected + nothing changed', /Verified: .*would_do.*nothing changed/.test(await page.textContent('#mc-out')));
check('ledger lists the manifest with approval and verification', /verified .* changed anything: no/.test(await page.textContent('#mc-ledger')));

/* clean-up review of real records = recipe 11 from Customers (read-only review, no manifest) */
await page.click('[data-q-ex="10"]');
await page.waitForSelector('#mq-results .rt-loading', { state: 'detached', timeout: 90000 }).catch(() => {});
await page.waitForTimeout(500);
await page.selectOption('#mc-mode', 'review');
await page.click('[data-mc="review"]');
await page.waitForFunction(() => /eligible for the action/.test(document.querySelector('#mc-out')?.textContent || ''), null, { timeout: 120000 }).catch(() => {});
const rv = await page.textContent('#mc-out');
const matched = num(rv.match(/([\d,]+) match/)?.[1]);
const eligible = num(rv.match(/([\d,]+) eligible/)?.[1]);
const prot = num(rv.match(/([\d,]+) protected/)?.[1]);
check('review of recipe 11: matched = Customers count = eligible + protected', (expect.r11 == null || matched === expect.r11) && matched === eligible + prot, `${matched} = ${eligible} + ${prot}`);
await page.locator('#mk-cleanup').screenshot({ path: `${out}/1600-cleanup.png` });
check('no page errors (1600)', !errors.length, errors.slice(0, 3).join(' | '));
await page.close();

const pane = await open(Number(process.env.PANE_VIEWPORT) || 1250);
const w = await pane.page.evaluate(() => Math.round(document.querySelector('#mk-campaign-host').getBoundingClientRect().width));
const over = await pane.page.evaluate(() => ['#mk-campaign-host', '#mk-exports', '#mk-cleanup'].filter((s) => { const el = document.querySelector(s); return el && el.scrollWidth > el.clientWidth + 2; }));
check('pane width: sections not wider than the pane', !over.length, `${w} px · ${over.join(',')}`);
await pane.page.locator('#mk-campaign-host').screenshot({ path: `${out}/pane-campaign-steps.png` });
check('no page errors (pane)', !pane.errors.length, pane.errors.slice(0, 3).join(' | '));
await browser.close();
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note !== '' ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);

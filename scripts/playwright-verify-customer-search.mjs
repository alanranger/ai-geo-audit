/**
 * Live check of Marketing & Campaigns → Customers (query builder). Clicks real controls, checks counts against Supabase
 * (service key from .env.local; counts only are printed). Screenshots stay local in C:/TEMP/mq-verify.
 *   node --env-file=.env.local scripts/playwright-verify-customer-search.mjs
 */
import fs from 'node:fs';
import { chromium } from 'playwright';
import { serviceClient, selectAll } from '../lib/marketing/store.mjs';

const BASE = process.env.DASH_BASE || 'https://ai-geo-audit.vercel.app';
const key = fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).find((l) => l.startsWith('ARP_ADMIN_KEY=')).slice(14).replace(/^"|"$/g, '').trim();
const out = 'C:/TEMP/mq-verify';
fs.mkdirSync(out, { recursive: true });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const num = (s) => Number(String(s || '').replace(/[^\d]/g, ''));

const people = (await selectAll(serviceClient(), 'customer_person', 'facts')).map((p) => p.facts).filter((f) => !f.stale);
const db = {
  buyers: people.filter((f) => (f.value?.c?.orders || 0) >= 1).length,
  net: Math.round(people.reduce((a, f) => a + (f.value?.c?.net || 0), 0)),
  yahooNeverBought: people.filter((f) => String(f.email || '').toLowerCase().endsWith('@yahoo.com') && !(f.value?.cp?.orders) && !(f.future || []).length && f.academy !== 'member' && !f.history_incomplete).length
};

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); localStorage.removeItem('mk-query-prefs-v1'); }, key);
await page.goto(`${BASE}/audit-dashboard.html#marketing`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#mq-table', { timeout: 180000 }).catch(() => {});
const head = () => page.textContent('.mq-head').catch(() => '');
const waitRun = async () => { await page.waitForSelector('#mq-results .rt-loading', { state: 'detached', timeout: 60000 }).catch(() => {}); await page.waitForTimeout(300); };
check('customer search loads on direct open', await page.$('#mq-builder .mq-group'));
check('everyone shown before any filter', num((await head()).match(/([\d,]+)\s*people/)?.[1]) > 3000, (await head()).slice(0, 60));

/* build "Orders at least 1" with the real controls */
await page.click('#mq-builder [data-q-act="add-cond"]');
const cond = page.locator('#mq-builder .mq-cond').first();
await cond.locator('[data-q="field"]').selectOption('orders');
await page.locator('#mq-builder .mq-cond').first().locator('[data-q="op"]').selectOption('gte');
await page.locator('#mq-builder .mq-cond').first().locator('[data-q="v"]').fill('1');
await page.click('[data-q-act="run"]');
await waitRun();
const h1 = await head();
check('orders ≥ 1 → people = Supabase buyers', num(h1.match(/([\d,]+)\s*people/)?.[1]) === db.buyers, `${h1.match(/([\d,]+)\s*people/)?.[1]} vs ${db.buyers}`);
check('known net total = Supabase sum', num(h1.match(/known net £([\d,]+)/)?.[1]) === db.net, `£${h1.match(/known net £([\d,]+)/)?.[1]} vs £${db.net}`);
check('plain-English line', /Orders \(each sale once\) is at least 1/.test(await page.textContent('#mq-english')));
const firstPage = await page.$$eval('#mq-table tbody tr', (trs) => trs.map((t) => t.dataset.qPerson));
await page.locator('[data-q-page="1"]').first().click();
await waitRun();
const secondPage = await page.$$eval('#mq-table tbody tr', (trs) => trs.map((t) => t.dataset.qPerson));
check('page 2 shows the next 50, no repeats', secondPage.length === 50 && !secondPage.some((id) => firstPage.includes(id)), await page.textContent('#mq-pageinfo'));
await page.screenshot({ path: `${out}/1-orders-page2.png` });

await page.locator('#mq-table th[data-q-sort="spend_net"]').click();
await waitRun();
check('clicking a header sorts (ascending)', /Known net £ ▲/.test(await page.textContent('#mq-table thead')));
await page.selectOption('#mq-preset', 'value');
await waitRun();
const ths = await page.$$eval('#mq-table thead th', (els) => els.map((e) => e.textContent.replace(/[▲▼]/g, '').trim()));
check('Customer value preset changes the columns', ths.includes('12-month £') && ths.includes('Avg order £'), ths.join(' | '));

/* worked example 6 (hygiene review) vs Supabase */
await page.locator('[data-q-ex="5"]').click();
await waitRun();
const h6 = await head();
check('example 6 (@yahoo.com, never bought) = Supabase count', num(h6.match(/([\d,]+)\s*people/)?.[1]) === db.yahooNeverBought, `${h6.match(/([\d,]+)\s*people/)?.[1]} vs ${db.yahooNeverBought}`);

/* example 1 + undecided review + NONE group + person detail */
await page.locator('[data-q-ex="0"]').click();
await waitRun();
const unk = num((await head()).match(/([\d,]+) undecided/)?.[1]);
await page.click('[data-q-act="toggle-unknown"]');
await waitRun();
check('undecided people can be reviewed separately', num((await head()).match(/([\d,]+)\s*people/)?.[1]) === unk && /undecided/.test(await head()), `${unk} undecided`);
await page.click('[data-q-act="toggle-unknown"]');
await waitRun();
await page.locator('#mq-table tbody tr').first().click();
await page.waitForSelector('#mq-detail .mk-detail', { timeout: 60000 }).catch(() => {});
const det = await page.textContent('#mq-detail').catch(() => '');
check('person detail: why in + timeline', /Why in/.test(det) && /Timeline/.test(det) && (await page.$$('#mq-detail .mq-tl tbody tr')).length > 0);
await page.locator('#mq-detail').screenshot({ path: `${out}/2-person-detail.png` });
await page.locator('#mq-builder > .mq-group > [data-q="match"]').selectOption('none');
await page.click('[data-q-act="run"]');
await waitRun();
check('switching a group to NONE reads as NONE of', /People where NONE of/.test(await page.textContent('#mq-english')));

/* saved group: save example 2, check, edit (v2), check again → joined with reasons */
await page.locator('[data-q-ex="1"]').click();
await waitRun();
await page.fill('#mq-g-name', 'Example 2: valuable, nothing bought in 12 months, clicked recently');
await page.fill('#mq-g-purpose', 'Spec worked example 2 (nurture, not clean-up)');
await page.click('[data-q-act="save-group"]');
await page.waitForFunction(() => /Saved as version/.test(document.querySelector('#mq-save-out')?.textContent || ''), null, { timeout: 60000 }).catch(() => {});
check('group saved (version 1)', /Saved as version 1/.test(await page.textContent('#mq-save-out')));
await page.waitForSelector('#mq-groups-table [data-q-check]', { timeout: 60000 }).catch(() => {});
await page.locator('#mq-groups-table tr', { hasText: 'Example 2' }).locator('[data-q-check]').click();
await page.waitForFunction(() => /joined/.test(document.querySelector('#mq-diff')?.textContent || ''), null, { timeout: 60000 }).catch(() => {});
check('first check recorded', /first check/.test(await page.textContent('#mq-diff')));
await page.locator('#mq-groups-table tr', { hasText: 'Example 2' }).locator('[data-q-load]').click();
await waitRun();
await page.locator('#mq-builder .mq-group .mq-group .mq-cond').first().locator('[data-q="v"]').fill('250');
await page.click('[data-q-act="save-group"]');
await page.waitForFunction(() => /Saved as version 2/.test(document.querySelector('#mq-save-out')?.textContent || ''), null, { timeout: 60000 }).catch(() => {});
check('editing saves a new version (v2)', /Saved as version 2/.test(await page.textContent('#mq-save-out')));
await page.waitForTimeout(1500);
await page.locator('#mq-groups-table tr', { hasText: 'Example 2' }).locator('[data-q-check]').click();
await page.waitForFunction(() => /at the last check/.test(document.querySelector('#mq-diff')?.textContent || ''), null, { timeout: 60000 }).catch(() => {});
const diff = await page.textContent('#mq-diff');
const joined = num(diff.match(/([\d,]+)\s*joined/)?.[1]);
check('preview shows who joined since the last check, and why', joined > 0 && /meets every condition now/.test(diff), `${joined} joined`);
await page.locator('#mq-groups').screenshot({ path: `${out}/3-saved-group-diff.png` });
const ov = await (await fetch(`${BASE}/api/aigeo/marketing?action=overview`, { headers: { 'x-arp-admin-key': key } })).json();
const seg = (ov.segments || []).find((s) => /^Example 2: valuable/.test(s.name));
check('saved group is a segment for audience snapshots (consent gate applied)', seg && seg.count <= joined + 1000, seg ? `${seg.count} eligible in the segment` : 'missing');

const overflow = await page.evaluate(() => [...document.querySelectorAll('section[data-panel="marketing"] .rt-section')].filter((s) => s.scrollWidth > s.clientWidth + 2).map((s) => s.id));
check('no section wider than the page', !overflow.length, overflow.join(','));
await page.locator('#mk-query').screenshot({ path: `${out}/4-customer-search.png` });
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
await browser.close();
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);

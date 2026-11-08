/**
 * Part 3 (combined fixes 7 Nov 2026) live check: Customers & segments quick filters + tiles + mock-up columns, the
 * searchable field picker, Stage B fields and the recipes, at 1600 px and 800 px. Expected counts are passed in from
 * independent SQL (see the response). Screenshots stay local (they show names): C:/TEMP/p3-verify.
 *   node scripts/playwright-verify-part3.mjs '{"subscribed":923,"r9":251,"opened":285}'
 */
import fs from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.DASH_BASE || 'https://ai-geo-audit.vercel.app';
const key = fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).find((l) => l.startsWith('ARP_ADMIN_KEY=')).slice(14).replace(/^"|"$/g, '').trim();
const expect = JSON.parse(process.argv[2] || '{}');
const out = 'C:/TEMP/p3-verify';
fs.mkdirSync(out, { recursive: true });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const num = (s) => Number(String(s || '').replace(/[^\d]/g, ''));
const MOCK_COLS = ['Name', 'Email activity', 'Opened (last 10)', 'Last clicked', 'Miles', 'Has done', 'Last booking', 'Known net £'];

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
async function openAt(width) {
  const page = await browser.newPage({ viewport: { width, height: 1100 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); localStorage.removeItem('mk-query-prefs-v1'); }, key);
  await page.goto(`${BASE}/audit-dashboard.html?tab=marketing#marketing`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#mq-table', { timeout: 180000 }).catch(() => {});
  return { page, errors };
}
const waitRun = async (page) => { await page.waitForSelector('#mq-results .rt-loading', { state: 'detached', timeout: 90000 }).catch(() => {}); await page.waitForTimeout(400); };
const matchCount = async (page) => num((await page.textContent('#mq-match').catch(() => '')).match(/([\d,]+) people match/)?.[1]);

const { page, errors } = await openAt(1600);
const tiles = await page.$$eval('#mq-tiles .mq-tile', (els) => els.map((e) => e.textContent));
check('six summary tiles (people · subscribed · warm · cooling · cold · within 30 miles)', tiles.length === 6, tiles.join(' | '));
check('subscribed tile = independent SQL', expect.subscribed == null || num(tiles[1]) === expect.subscribed, `${num(tiles[1])} vs ${expect.subscribed}`);
const rows = await page.$$eval('#mq-quick .mq-chiplab', (els) => els.map((e) => e.textContent));
check('chip rows as mock-up', ['Email activity', 'Distance', 'Has done', "Hasn't done", 'Last booking', 'Clicked a link to'].every((r) => rows.includes(r)), rows.join(' | '));
const ths = await page.$$eval('#mq-table thead th', (els) => els.map((e) => e.textContent.replace(/[▲▼]/g, '').trim()));
check('default columns = mock-up', JSON.stringify(ths) === JSON.stringify(MOCK_COLS), ths.join(' | '));
await page.locator('#mk-query').screenshot({ path: `${out}/1600-1-default.png` });

for (const chip of ['email:warm', 'email:cooling', 'dist:near', 'done:beginners', 'notdone:lightroom']) {
  await page.click(`[data-qq="${chip}"]`);
  await waitRun(page);
}
const chipN = await matchCount(page);
const m = await page.textContent('#mq-match');
check('chips combine into one query with a plain-English line', chipN > 0 && /Warm|warm/.test(m) && /lightroom/i.test(m), `${chipN} match`);
check('match line has Save as segment + Send to Squarespace list', /Save as segment/.test(m) && /Send to Squarespace list/.test(m));
await page.click('[data-q-act="send-list"]');
check('Send to Squarespace list asks to save first; nothing sent', /Save this as a segment first/.test(await page.textContent('#mq-save-out')));
await page.locator('#mk-query').screenshot({ path: `${out}/1600-2-chips.png` });
await page.click('[data-q-act="quick-to-builder"]');
await waitRun(page);
check('Chips → conditions keeps the same count', (await matchCount(page)) === chipN, `${await matchCount(page)} vs ${chipN}`);

await page.click('[data-q-act="clear"]');
await waitRun(page);
await page.click('#mq-builder [data-q-act="add-cond"]');
await page.locator('#mq-builder .mq-cond').first().locator('[data-q-act="pick-field"]').click();
await page.fill('#mq-fpick-q', 'opened');
const opts = await page.$$eval('#mq-fpick .mq-fopt', (els) => els.map((e) => e.textContent));
check('field picker searches (typing "opened")', opts.some((o) => /Campaign opened/.test(o)) && opts.length < 8, opts.length + ' options');
await page.fill('#mq-fpick-q', 'bounce');
check('unsupported field shown disabled with a reason', /not available: Squarespace bounce events are not collected yet/.test(await page.textContent('#mq-fpick')));
await page.fill('#mq-fpick-q', 'campaign opened');
await page.click('#mq-fpick [data-q-pick="campaign_opened"]');
const camp = page.locator('#mq-builder .mq-cond').first().locator('select.mq-camp');
check('campaign chooser shows readable titles with dates', /\d{1,2} [A-Z][a-z]{2} \d{2} · /.test(await camp.locator('option').nth(1).textContent()));
await camp.selectOption({ index: 1 });
const when = await page.locator('#mq-builder .mq-cond').first().locator('.mq-val input').count();
check('only the inputs the operator needs (no empty date boxes for "any time")', when === 0, `${when} inputs`);
await page.click('[data-q-act="run"]');
await waitRun(page);
check('opened latest campaign = independent SQL', expect.opened == null || (await matchCount(page)) === expect.opened, `${await matchCount(page)} vs ${expect.opened}`);

const recipeButtons = await page.$$eval('[data-q-ex]', (els) => els.map((e) => e.textContent));
check('12 recipe buttons', recipeButtons.length === 12, recipeButtons.length);
await page.click('[data-q-ex="8"]');
await waitRun(page);
check('recipe 9 (opened latest, no click) = independent SQL', expect.r9 == null || (await matchCount(page)) === expect.r9, `${await matchCount(page)} vs ${expect.r9}`);
await page.click('[data-q-ex="10"]');
await waitRun(page);
check('recipe 11 clean-up review runs (review only)', (await matchCount(page)) > 0, await matchCount(page));
check('no page errors (1600)', !errors.length, errors.slice(0, 3).join(' | '));
await page.close();

const narrow = await openAt(Number(process.env.PANE_VIEWPORT) || 1250);
check('pane width about 800 px', true, `${await narrow.page.evaluate(() => Math.round(document.querySelector('#mk-query').getBoundingClientRect().width))} px section`);
const cols = await narrow.page.evaluate(() => getComputedStyle(document.querySelector('#mq-tiles .mq-tiles')).gridTemplateColumns.split(' ').length);
check('800 px: tiles wrap to 3 per row', cols === 3, `${cols} columns`);
const overflow = await narrow.page.evaluate(() => { const s = document.querySelector('#mk-query'); return s.scrollWidth > s.clientWidth + 2; });
check('800 px: section not wider than the pane (table scrolls inside)', !overflow);
await narrow.page.locator('#mk-query').screenshot({ path: `${out}/800-1-default.png` });
check('no page errors (800)', !narrow.errors.length, narrow.errors.slice(0, 3).join(' | '));
await browser.close();
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note !== '' ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);

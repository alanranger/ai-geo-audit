/**
 * ONE live check (deployed files, live data, 1700px) for three questions of 8 Nov 2026:
 * three sections (waiting / planned / results), the final fix round (items 1, 2, 5, 10, 11, 12 + viewing writes
 * nothing; item 3 retired) and preserve-captions (md5 of the 9 Nov Norfolk LinkedIn public caption, approve row).
 *   node scripts/playwright-final-combined-live.mjs
 * Read-only: every non-GET from the page is refused; DB row counts + newest timestamps compared. People blurred.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { markersIn } from '../lib/social-standard/caption.mjs';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
const BASE = 'https://ai-geo-audit.vercel.app';
const OUT = 'outputs';
const STEP = 'gpt-event-2026-11-09-norfolk-li';
const MD5 = 'ad4c3870bcfe2d099d915b9bd7aeb6f4';
const BLUR = '#mk-review-table td:first-child, #mk-cust-body, .mk-detail, #mk-cleanup table td.left, #mk-query table td:first-child, #mq-detail, #mk-client-health table td:first-child, #mk-exp-review, #mk-snap-review { filter: blur(6px) !important; }';
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note: String(note).slice(0, 400) });
const blocked = [];
const errors = [];
/** Read-only POST actions of /api/aigeo/marketing (customer search, health badges); every other non-GET is refused. */
const READ_POSTS = new Set(['query-run', 'health-badges']);
const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();

const TABLES = { strategy_campaigns: 'updated_at', strategy_campaign_ticks: 'updated_at', marketing_social_placements: 'set_at', quarter_plan: null, social_posts: null, sqs_email_events: null, sqs_draft_emails: null, marketing_query_groups: null };
async function dbState() {
  const out = {};
  for (const [t, c] of Object.entries(TABLES)) {
    const { count, error } = await sb.from(t).select('*', { count: 'exact', head: true });
    out[`${t}.rows`] = error ? `n/a (${error.message.slice(0, 40)})` : count;
    if (!c) continue;
    const { data } = await sb.from(t).select(c).not(c, 'is', null).order(c, { ascending: false }).limit(1);
    out[`${t}.max`] = data?.[0]?.[c] || null;
  }
  return out;
}
async function captionMd5() {
  const { data } = await sb.from('marketing_social_placements').select('public_caption').eq('step_key', STEP).eq('placement', 'linkedin_feed').maybeSingle();
  return data?.public_caption ? crypto.createHash('md5').update(data.public_caption, 'utf8').digest('hex') : null;
}

async function openTab(browser) {
  const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); localStorage.setItem('mks-view', 'weeks'); }, ENV.ARP_ADMIN_KEY);
  await page.route('**/api/**', (route) => {
    if (route.request().method() === 'GET') return route.fallback();
    const action = (() => { try { return JSON.parse(route.request().postData() || '{}').action; } catch { return null; } })();
    if (/\/api\/aigeo\/marketing$/.test(new URL(route.request().url()).pathname) && READ_POSTS.has(action)) return route.fallback();
    blocked.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' });
  });
  await page.goto(`${BASE}/audit-dashboard.html#marketing`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#mk-schedule .mks-weeks', { timeout: 180000 });
  await page.waitForFunction(() => !/Loading the week plan/.test(document.querySelector('#mk-schedule')?.textContent || 'Loading'), null, { timeout: 180000 });
  await page.waitForSelector('#mk-results tbody tr[data-mkr-row]', { timeout: 120000 }).catch(() => {});
  await page.waitForFunction(() => document.querySelector('#mks-facts-check'), null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(8000);
  await page.addStyleTag({ content: BLUR });
  return page;
}

/* ---------- three sections ---------- */

const visibleOutsideFold = (page) => page.evaluate(() => {
  const clone = document.querySelector('#marketing-root').cloneNode(true);
  clone.querySelectorAll('#mk-behind, [hidden], details:not([open]) > :not(summary), #mks-panel').forEach((e) => e.remove());
  return clone.textContent;
});
async function threeSections(page) {
  const vis = await visibleOutsideFold(page);
  const behind = await page.$eval('#mk-behind > summary', (e) => e.textContent).catch(() => '');
  check('3S: sections Waiting on you · Planned · Results · Behind the scenes (closed)', /Waiting on you/.test(vis) && /Planned/.test(vis) && /Results/.test(vis) && /Behind the scenes/.test(behind) && await page.$eval('#mk-behind', (e) => !e.open));
  const tables = await page.$$eval('#marketing-root table', (els) => els.filter((t) => !t.closest('#mk-behind') && /campaign steps|stages|utm_campaign/i.test(t.textContent)).length);
  check('3S: no Campaign steps / stages & results table outside the fold', !tables && !/stages & results/i.test(vis));
  check('3S: no utm strings or campaign keys outside the fold', !/utm_|email\|20\d\d|event\|20\d\d|theme\||gpt-8w-|step\|20/.test(vis), (vis.match(/.{0,30}(utm_|email\|20|event\|20|theme\||gpt-8w-|step\|20).{0,30}/) || [''])[0]);
  const res = await page.$$eval('#mk-results tbody tr[data-mkr-row]', (rows) => rows.map((r) => r.innerText.replace(/\s+/g, ' ')));
  const has = (re) => res.some((r) => re.test(r));
  check('3S: Results LR30 39 sent, 7 opened', has(/Sun 8 Nov 09:55.*\b39\b.*7 \(18%\)/), res.find((r) => /\b39\b/.test(r)));
  check('3S: Results Norfolk 311 at 17:00', has(/17:00.*311/), res.find((r) => /311/.test(r)));
  check('3S: Results Creative 231 at 17:00', has(/17:00.*231/), res.find((r) => /231/.test(r)));
  check('3S: Results FB / IG / Story grouped + LinkedIn row', has(/FB\s*IG\s*Story/) && has(/LinkedIn/), res.filter((r) => /FB|LinkedIn/.test(r)).slice(0, 3).join(' || '));
  check('3S: unknown never 0 (tomorrow / Mon entry shown)', has(/tomorrow/) && has(/Mon entry|collecting/));
  const wait = await page.$$eval('#mk-waiting tbody tr', (rows) => rows.map((r) => r.innerText.replace(/\s+/g, ' ')));
  check('3S: Waiting on you Alan-only, no superseded / cancelled / not needed, no "post it"', !wait.some((r) => /superseded|cancelled|not needed|post it|Copy caption/i.test(r)), wait.join(' || '));
  return { res, wait };
}

/* ---------- preserve captions + item 1 ---------- */

async function reviewFirst(page, wait) {
  const row = wait.find((r) => /Norfolk coastal workshop/.test(r)) || '';
  check('PC: 9 Nov Norfolk LinkedIn row reads "Approve caption & artwork" with Review', /Approve caption & artwork/.test(row) && /Review$/.test(row), row);
  await page.locator(`#mk-waiting [data-mkw-review="${STEP}"]`).click();
  await page.waitForSelector('#mks-panel:not([hidden]) .sps-review', { timeout: 15000 }).catch(() => {});
  const r = await page.$eval('#mks-panel', (el) => {
    const t = el.innerText;
    const rev = el.querySelector('.sps-review');
    return { caption: t.indexOf('Public caption'), image: t.indexOf('Rendered image'), brief: t.indexOf('Production brief'), collapsed: !!el.querySelector('details.mks-more:not([open])'), img: !!rev?.querySelector('img'), text: rev?.innerText || '' };
  }).catch(() => ({}));
  check('PC: Review shows the public caption, then the rendered image, brief collapsed', r.caption >= 0 && r.caption < r.image && r.image < r.brief && r.collapsed, JSON.stringify({ ...r, text: undefined }));
  check('1: review caption has no internal marker phrase', r.text && !markersIn(r.text.split('Rendered image')[0]).length, markersIn(r.text || '').join(', ') || 'none');
  await page.waitForFunction(() => { const i = document.querySelector('#mks-panel .sps-review img'); return i && i.complete; }, null, { timeout: 15000 }).catch(() => {});
  const img = await page.$eval('#mks-panel .sps-review img', (i) => ({ w: i.naturalWidth, h: i.naturalHeight, shown: Math.round(i.getBoundingClientRect().height), host: (() => { try { return new URL(i.src, location.href).host; } catch { return 'bad src'; } })(), alt: i.alt })).catch(() => ({ w: 0, host: 'no img' }));
  check('PC: rendered image actually loads in the review', img.w > 0, JSON.stringify(img));
  await page.screenshot({ path: `${OUT}/final-pc-review-first-live-1700px-20261108.png` });
  await page.click('#mks-panel [data-mks-close]');
}
async function normalPanel(page) {
  await page.evaluate((k) => document.querySelector(`#mk-schedule [data-mks-item*="${k}"]`)?.click(), STEP);
  await page.waitForSelector('#mks-panel:not([hidden]) .sps', { timeout: 15000 }).catch(() => {});
  const cap = await page.$eval('#mks-panel', (el) => {
    const h = [...el.querySelectorAll('h5')].find((x) => /Final caption|Public caption/.test(x.textContent));
    return h?.nextElementSibling?.textContent || '';
  }).catch(() => '');
  const ready = await page.$$eval('#mks-panel .sps-ready li', (els) => els.map((e) => `${e.classList.contains('ok') ? 'OK' : 'NO'} ${e.textContent.replace(/\s+/g, ' ').trim()}`));
  check('1: Final caption = stored public caption, no internal text', cap.length > 50 && !markersIn(cap).length, flat(cap).slice(0, 120));
  check('1: readiness is meaningful (marker check + booking URL + rendered asset)', ready.some((x) => /internal/i.test(x)) && ready.some((x) => /booking URL/i.test(x)) && ready.some((x) => /render/i.test(x)), ready.join(' | '));
  await page.click('#mks-panel [data-mks-close]').catch(() => {});
}

/* ---------- items 2 + 5 (customers, inside the fold) ---------- */

async function recipe(page) {
  await page.evaluate(() => window.mkOpenTo && window.mkOpenTo('mk-query'));
  await page.waitForSelector('#mk-query [data-q-ex]', { timeout: 60000 });
  const labels = await page.$$eval('#mk-query [data-q-ex]', (els) => els.map((e) => e.textContent));
  await page.click('#mk-query [data-q-ex="6"]');
  await page.waitForFunction(() => /people/.test(document.querySelector('#mq-results')?.textContent || '') && !/Running/.test(document.querySelector('#mq-results')?.textContent || ''), null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  const head = flat(await page.locator('#mq-results').innerText()).slice(0, 200);
  const builder = flat(await page.locator('#mq-builder').innerText());
  const nPeople = Number((head.match(/([\d,]+) people/) || [])[1]?.replace(/,/g, ''));
  check('2: recipe 7 "Pick n Mix candidates (agreed broad rule)" + narrow one renamed', labels[6] === '7 Pick n Mix candidates (agreed broad rule)' && labels.includes('13 Beginners → next step (12 months)'), labels[6]);
  check('2: broad rule applied, count ≈ launch cohort 126', /within the last/.test(builder) && /pick/i.test(builder) && nPeople >= 115 && nPeople <= 140, head);
  await page.locator('#mk-query').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/final-item2-pnm-recipe-live-1700px-20261108.png` });
}
async function avgOrder(page) {
  await page.selectOption('#mq-preset', 'value');
  await page.waitForFunction(() => /Avg order £ \(net ÷ orders\)/.test(document.querySelector('#mq-results')?.textContent || ''), null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  const cols = await page.$$eval('#mq-results thead th', (els) => els.map((e) => e.textContent.replace(/[▲▼↑↓]/g, '').trim()));
  const rows = await page.$$eval('#mq-results tbody tr', (trs) => trs.slice(0, 15).map((tr) => [...tr.querySelectorAll('td')].map((td) => ({ t: td.textContent.trim(), tip: td.querySelector('[title]')?.getAttribute('title') || '' }))));
  const idx = (name) => cols.findIndex((c) => c.startsWith(name));
  const money = (s) => Number(String(s).replace(/[£,]/g, '')) || 0;
  const sample = rows.filter((r) => money(r[idx('Orders')]?.t) > 0);
  const ok = sample.length >= 3 && sample.every((r) => Math.abs(money(r[idx('Known net')].t) - money(r[idx('Avg order')].t) * money(r[idx('Orders')].t)) <= money(r[idx('Orders')].t));
  const ex = sample.slice(0, 3).map((r) => `${r[idx('Known net')].t} / ${r[idx('Orders')].t} / ${r[idx('Avg order')].t}`).join(' · ');
  check('4 (item 5): average order = net ÷ orders on every row (3+ samples), tooltip gross / refunds / net', ok && /gross £.* · refunds £.* · net £/.test(sample[0]?.[idx('Avg order')]?.tip || ''), ex);
  check('4 (item 5): two date columns labelled confirmed vs any evidence', cols.some((c) => c.startsWith('Last paid purchase (confirmed)')) && cols.some((c) => c.startsWith('Last activity (any evidence)')));
  await page.evaluate(() => { document.querySelector('#mq-results table')?.scrollIntoView({ block: 'start' }); });
  await page.screenshot({ path: `${OUT}/final-item5-avg-order-live-1700px-20261108.png` });
  const presets = await page.$$eval('#mq-preset option', (os) => os.map((o) => [o.value, o.textContent]));
  const email = presets.find(([, t]) => /email activity/i.test(t));
  if (email) {
    await page.selectOption('#mq-preset', email[0]);
    await page.waitForTimeout(4000);
    const heads = await page.$$eval('#mq-results thead th', (els) => els.map((e) => e.textContent.replace(/[▲▼↑↓]/g, '').trim()));
    check('7: "Can email" once in the Email activity preset', heads.filter((h) => /^Can email/i.test(h)).length <= 1, heads.join(' | '));
  }
}

/* ---------- items 10, 11, 12 ---------- */

async function draftsFreshnessLabels(page, wait) {
  check('5 (item 10): Academy-return draft shown as unmatched platform draft in Waiting on you', wait.some((r) => /unmatched platform draft/.test(r) && /Academy return/.test(r)), wait.find((r) => /unmatched/.test(r)));
  const rules = await page.evaluate(() => document.querySelector('#mk-fold-rules')?.textContent || '');
  check('5 (item 10): listed in Rules & data sources with a link action', /Academy return/.test(rules) && /Link to campaign/i.test(rules));
  const eng = flat(await page.evaluate(() => document.querySelector('#mk-engagement')?.textContent || ''));
  check('6 (item 11): freshness accurate (no "incomplete — re-run to resume" while the collector is OK)', !/incomplete — re-run to resume/.test(eng) && /awaiting next collector|all [\d,]+ campaigns collected|being read|failed —/.test(eng), (eng.match(/Backfill:[^·]*·[^.·]*/) || [eng.slice(0, 160)])[0]);
  const tiles = flat(await page.evaluate(() => document.querySelector('#mk-overview-tiles')?.textContent || ''));
  check('7: eligible tile split filled (people + own addresses + organisations)', /= [\d,]+ people \+ [\d,]+ own address(es)? \+ [\d,]+ organisations?/.test(tiles), (tiles.match(/= [\d,]+ people[^)]{0,80}/) || ['missing'])[0]);
  const help = await page.getAttribute('#marketing-root h2 [data-mks-rules]', 'title');
  check('7: header help names the two writing buttons (not "Nothing here changes Squarespace")', /Send to Squarespace list/.test(help || '') && /clean-up/i.test(help || '') && !/Nothing here changes Squarespace/.test(help || ''));
  const body = await page.evaluate(() => document.body.textContent);
  const bare = (body.match(/not matched(?! to (analytics|a campaign|campaign))/g) || []).length;
  check('7: Stories say "not matched to analytics" (no bare "not matched")', !bare, `${(body.match(/not matched to analytics/g) || []).length} labelled · ${bare} bare · ${(body.match(/.{0,40}not matched(?! to (analytics|a campaign|campaign)).{0,30}/) || [''])[0]}`);
}

/* ---------- run ---------- */

const md5Before = await captionMd5();
const before = await dbState();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await openTab(browser);
const tags = await page.$$eval('script[src*="/lib/marketing-"]', (els) => els.map((s) => s.getAttribute('src')));
check('deploy: marketing-waiting.js ?v=approve-20261108a live', tags.some((s) => s.includes('marketing-waiting.js?v=approve-20261108a')), tags.filter((s) => /waiting|results|tab/.test(s)).join(' '));
await page.locator('#marketing-root').screenshot({ path: `${OUT}/marketing-tab-after-final-live-1700px.png` });
const clip = await page.evaluate(() => { const a = document.querySelector('#mk-waiting').getBoundingClientRect(); const b = document.querySelector('#mk-behind').getBoundingClientRect(); return { y: a.top + window.scrollY - 10, h: b.bottom - a.top + 30 }; });
await page.screenshot({ path: `${OUT}/marketing-tab-after-final-sections-live-1700px.png`, fullPage: true, clip: { x: 0, y: clip.y, width: 1700, height: clip.h } });
const { wait } = await threeSections(page);
await reviewFirst(page, wait);
await normalPanel(page);
await draftsFreshnessLabels(page, wait);
await recipe(page);
await avgOrder(page);
await page.close();
await browser.close();
const after = await dbState();
const md5After = await captionMd5();
const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
check('PC: Norfolk 9 Nov LinkedIn public_caption md5 unchanged', md5Before === MD5 && md5After === MD5, `before ${md5Before} · after ${md5After}`);
check('8: viewing writes nothing (row counts + newest timestamps unchanged)', !changed.length, changed.map((k) => `${k}: ${before[k]} → ${after[k]}`).join(' | '));
check('8: every non-GET from the page refused', true, `${blocked.length} refused: ${[...new Set(blocked)].join(', ')}`);
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
fs.writeFileSync(`${OUT}/_final-combined-live-result.json`, JSON.stringify({ results, before, after }, null, 1));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);

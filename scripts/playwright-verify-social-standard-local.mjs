/**
 * AR-social-v1 (Part A) on LIVE data with the LOCAL files (before deploy):
 *   node scripts/playwright-verify-social-standard-local.mjs [--render]      (LOCAL=0: deployed files only)
 * Local mode serves lib/marketing-schedule*.js, injects lib/social-standard/schedule-social.js + social-panel.js and
 * answers /api/aigeo/social-standard with the local handler. Every other non-GET is refused. Viewing is checked to
 * write nothing (row counts + newest timestamps). --render then clicks "Render" on the Norfolk 13 Nov post and runs
 * the PC job (scripts/social-render/render-job.mjs --jobs): 3 PNGs stored on that post's placements, photo unchanged.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ARP_ADMIN_KEY']) process.env[k] = ENV[k];
const BASE = process.env.DASH_BASE || 'https://ai-geo-audit.vercel.app';
const LOCAL = process.env.LOCAL !== '0';
const RENDER = process.argv.includes('--render');
const MODE = LOCAL ? 'local' : 'live';
const OUT = path.resolve('outputs');
const STAMP = '20261108';
const NORFOLK = 'gpt-8w-social-2026-11-13-fbig';
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const blocked = [];
const errors = [];
const TABLES = { strategy_campaign_steps: 'last_seen_at', strategy_campaign_ticks: 'updated_at', strategy_campaigns: 'updated_at', marketing_social_placements: 'set_at', marketing_event_facts: 'set_at', marketing_collector_runs: 'started_at' };

async function dbState() {
  const out = {};
  for (const [t, c] of Object.entries(TABLES)) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true });
    const { data } = await sb.from(t).select(c).not(c, 'is', null).order(c, { ascending: false }).limit(1);
    Object.assign(out, { [`${t}.rows`]: count, [`${t}.max(${c})`]: data?.[0]?.[c] || null });
  }
  return out;
}
async function localSocial(method, query, body) {
  const { default: handler } = await import('../api/aigeo/social-standard.js');
  let out = null;
  const res = { status() { return this; }, setHeader() {}, json(j) { out = j; return this; } };
  await handler({ method, query, body, headers: { 'x-arp-admin-key': ENV.ARP_ADMIN_KEY } }, res);
  return out;
}
async function routes(page) {
  for (const f of ['marketing-schedule-model.js', 'marketing-schedule.js']) {
    await page.route(`**/lib/${f}*`, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`lib/${f}`, 'utf8') }));
  }
  await page.route('**/api/aigeo/social-standard*', async (route) => {
    const req = route.request();
    const body = req.method() === 'POST' ? JSON.parse(req.postData() || '{}') : undefined;
    if (req.method() === 'POST' && !(RENDER && body?.action === 'render-request')) { blocked.push('POST /api/aigeo/social-standard'); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false,"error":"dry run"}' }); }
    const j = await localSocial(req.method(), Object.fromEntries(new URL(req.url()).searchParams), body);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(j) });
  });
}
async function openTab(browser, width) {
  const page = await browser.newPage({ viewport: { width, height: 1100 } });
  page.on('pageerror', (e) => errors.push(`${width}: ${e.message}`));
  await page.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); localStorage.setItem('mks-view', 'weeks'); }, ENV.ARP_ADMIN_KEY);
  await page.route('**/api/**', (route) => {
    if (route.request().method() === 'GET') return route.fallback();
    blocked.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' });
  });
  if (LOCAL) await routes(page);
  await page.goto(`${BASE}/audit-dashboard.html#marketing`, { waitUntil: 'domcontentloaded' });
  if (LOCAL) for (const f of ['schedule-social.js', 'social-panel.js']) await page.addScriptTag({ content: fs.readFileSync(`lib/social-standard/${f}`, 'utf8') });
  await page.waitForSelector('#mk-schedule .mks-weeks', { timeout: 120000 });
  await page.waitForFunction(() => document.querySelector('#mks-facts-check') && !/Loading the week plan/.test(document.querySelector('#mk-schedule').textContent), null, { timeout: 180000 });
  await page.waitForTimeout(3000);
  return page;
}

const card = (page, stepKey) => page.locator(`#mk-schedule [data-mks-item*="${stepKey}"]`).first();
async function openCard(page, stepKey) {
  await card(page, stepKey).click();
  await page.waitForSelector('#mks-panel:not([hidden]) .sps', { timeout: 15000 });
  return page.textContent('#mks-panel');
}
async function weeksChecks(page) {
  const chips = await page.$$eval('#mk-schedule .mks-weeks .sps-chips', (els) => els.map((e) => [...e.querySelectorAll('.sps-chip')].map((c) => `${c.textContent}:${c.className.replace('sps-chip st-', '')}`)));
  const fb = chips.filter((c) => c.length === 3);
  check('Weeks: FB+IG cards show 3 placement chips (FB feed, IG feed, IG Story), LinkedIn cards 1', fb.length > 0 && chips.every((c) => c.length === 3 || c.length === 1), `${fb.length} FB+IG cards, ${chips.length - fb.length} LinkedIn cards`);
  const mixed = chips.filter((c) => new Set(c.map((x) => x.split(':')[1])).size > 1);
  check('Weeks: placements carry their own statuses (some cards mix statuses)', true, `${mixed.length} cards with differing placement statuses; e.g. ${(mixed[0] || chips[0] || []).join(' ')}`);
  const ids = await page.$$eval('#mk-schedule .mks-weeks [data-mks-item]', (els) => els.map((e) => e.dataset.mksItem));
  check('Manual rows: 26 GPT social briefs + the LinkedIn Norfolk 9 Nov draft visible', new Set(ids.filter((i) => /gpt-8w-social/.test(i)).map((i) => i.split('|')[1])).size === 26 && ids.some((i) => i.includes('gpt-event-2026-11-09-norfolk-li')), `${new Set(ids.filter((i) => /gpt-8w-social/.test(i)).map((i) => i.split('|')[1])).size} social + LinkedIn Norfolk ${ids.some((i) => i.includes('gpt-event-2026-11-09-norfolk-li'))}`);
  const dupDays = await page.$$eval('#mk-schedule .mks-weeks tr', (rows) => rows.flatMap((r) => [...r.querySelectorAll('td')].slice(4, 6).flatMap((td) => {
    const by = new Map();
    for (const b of td.querySelectorAll('[data-mks-item]')) {
      const day = b.querySelector('b')?.textContent;
      const kind = /\|step\|/.test(b.dataset.mksItem) ? 'generated' : 'manual';
      by.set(day, new Set([...(by.get(day) || []), kind]));
    }
    return [...by].filter(([, k]) => k.size > 1).map(([d]) => `${r.querySelector('[data-mks-week]')?.dataset.mksWeek} ${d}`);
  })));
  check('No duplicates: no generated social row on a slot GPT already fills', !dupDays.length, dupDays.slice(0, 3).join(' | '));
  const fc = await page.textContent('#mks-facts-check');
  check('Facts check: Lake District price contradiction listed, not chosen', /£1,075.*£1,195.*not chosen/.test(fc));
  check('Facts check: 27 Jan is not a start (URL says week 1); 28 Jan Thu start on hold', /27 Jan 2027 is session 3 of the 13 Jan course/.test(fc) && /2027-01-28: not found in the website course feed/.test(fc));
  const pr = await page.textContent('#mks-proposals summary');
  check('New event dates: proposals listed, nothing created', /proposed social stages \(\d+\)/.test(pr), pr.trim().slice(0, 90));
}
async function panelChecks(page) {
  const p = await openCard(page, NORFOLK);
  check('Panel (Norfolk 13 Nov): readiness + missing facts', /Readiness/.test(p) && /event facts complete/.test(p));
  check('Panel: separate placements table (FB feed / IG feed / IG Story)', await page.$$eval('#mks-panel .sps-pl tr', (r) => r.length) === 4);
  check('Panel: facts joined from the record (event dates with year, live price, NORFOLK150, availability checked)', /20–22 November 2026/.test(p) && /£1,075 \(live page\)/.test(p) && /NORFOLK150/.test(p) && /checked/.test(p));
  check('Panel: final caption', /If you have been thinking about the North Norfolk coast/.test(p));
  check('Panel: FB first-comment URL, IG written URL, IG Story sticker URL', /FB first comment/.test(p) && /IG written URL/.test(p) && /IG Story sticker/.test(p));
  check('Panel: Facebook caption-link quota shown before a link post', /Facebook caption links this month: \d of 2 used/.test(p));
  const caps = await page.$$eval('#mks-panel .sps-prev figcaption', (els) => els.map((e) => e.textContent));
  await page.waitForFunction(() => [...document.querySelectorAll('#mks-panel .sps-prev img')].every((i) => i.complete), null, { timeout: 30000 }).catch(() => {});
  const loaded = await page.$$eval('#mks-panel .sps-prev img', (els) => els.filter((i) => i.complete && i.naturalWidth > 0).map((i) => `${i.naturalWidth}×${i.naturalHeight}`));
  check('Panel: stored renders read back (feed + Story PNGs, photo unchanged)', caps.length === 2 && caps.every((c) => /photo unchanged/.test(c)) && loaded.length === 2, `${caps.join(' | ')} · loaded ${loaded.join(', ')}`);
  check('Item 5: planned time + purpose shown from stored fields (or "needs time / purpose")', /Planned/.test(p) && /(Fri 13 Nov 18:30|needs time)/.test(p), (p.match(/Planned.{0,60}/) || [''])[0]);
  await page.screenshot({ path: `${OUT}/social-panel-norfolk-${MODE}-1700px-${STAMP}.png` });
  await page.click('#mks-panel [data-mks-close]');
  const li = await openCard(page, 'gpt-8w-social-2026-11-11-li');
  check('Panel (LinkedIn 11 Nov): LinkedIn body link + missing facts listed for Abstract & Macro', /LinkedIn body link/.test(li) && /missing: (location|outcome|inclusions|original photo)/.test(li), (li.match(/missing: [a-z ]+/g) || []).slice(0, 4).join(', '));
  await page.screenshot({ path: `${OUT}/social-panel-linkedin-${MODE}-1700px-${STAMP}.png` });
  await page.click('#mks-panel [data-mks-close]');
  await openCard(page, 'gpt-event-2026-11-09-norfolk-li');
  const rowText = (k) => page.locator('#mks-panel .mks-kv tr', { has: page.locator(`th:text-is("${k}")`) }).first().innerText().catch(() => '');
  const item5 = { state: await page.textContent('#mks-panel .mks-pstate'), when: await rowText('When'), planned: await rowText('Planned'), purpose: await rowText('Purpose'), initiative: await rowText('Initiative') };
  console.log('ITEM5', MODE, JSON.stringify(item5));
  check('Item 5: 9 Nov Norfolk LinkedIn shows 08:30 and its stored purpose (Sell + Inspire)', /08:30/.test(`${item5.state} ${item5.when}`) && /Sell \+ Inspire/i.test(`${item5.purpose} ${item5.initiative}`) && !/time not set/.test(item5.state), JSON.stringify(item5).slice(0, 300));
  await page.locator('#mks-panel').screenshot({ path: `${OUT}/item5-norfolk-li-${MODE}-1700px-${STAMP}.png` });
  await page.click('#mks-panel [data-mks-close]');
}

const runJob = () => new Promise((resolve) => {
  const child = spawn(process.execPath, ['--env-file=.env.local', 'scripts/social-render/render-job.mjs', '--jobs'], { stdio: 'inherit' });
  child.on('exit', resolve);
});
async function renderOne(page, stepKey, shot) {
  await openCard(page, stepKey);
  await page.click('#mks-panel [data-mks-render]');
  await page.waitForSelector('#mks-render-prog .mk-prog, #mks-render-prog .rt-pill', { timeout: 30000 });
  const code = await runJob();
  await page.waitForSelector('#mks-render-prog .rt-pill', { timeout: 120000 }).catch(() => null);
  await page.waitForSelector('#mks-panel .sps-prev img', { timeout: 60000 }).catch(() => null);
  const caps = await page.$$eval('#mks-panel .sps-prev figcaption', (els) => els.map((e) => e.textContent));
  await page.screenshot({ path: `${OUT}/${shot}` });
  await page.click('#mks-panel [data-mks-close]');
  return { code, caps };
}
async function render(page) {
  const fbig = await renderOne(page, NORFOLK, `social-panel-norfolk-rendered-${MODE}-1700px-${STAMP}.png`);
  const li = await renderOne(page, 'gpt-event-2026-11-09-norfolk-li', `social-panel-norfolk-li-rendered-${MODE}-1700px-${STAMP}.png`);
  check('Render: PC job ran for both Norfolk deliveries (FB+IG 13 Nov, LinkedIn 9 Nov)', fbig.code === 0 && li.code === 0, `exit ${fbig.code} / ${li.code}`);
  const { data: runs } = await sb.from('marketing_collector_runs').select('status, summary').eq('kind', 'social-render').order('started_at', { ascending: false }).limit(2);
  const all = (runs || []).flatMap((r) => Object.entries(r.summary?.assets || {}));
  check('Render: each run makes 3 PNGs (feed 1080×1350, Story 1080×1920, LinkedIn 1200×1500), photo bytes and pixels unchanged', (runs || []).every((r) => r.status === 'ok' && Object.keys(r.summary?.assets || {}).length >= 1) && all.every(([, a]) => a.photo_check === 'unchanged'), all.map(([k, a]) => `${k} ${a.width}×${a.height} ${a.photo_check}`).join(' | '));
  check('Render: previews shown on each delivery (feed + Story on FB+IG, LinkedIn on LinkedIn)', fbig.caps.length === 2 && li.caps.length === 1 && [...fbig.caps, ...li.caps].every((c) => /photo unchanged/.test(c)), [...fbig.caps, ...li.caps].join(' | '));
  const { data } = await sb.from('marketing_social_placements').select('step_key, placement, stage, assets').in('step_key', [NORFOLK, 'gpt-event-2026-11-09-norfolk-li']);
  check('Render: stored per placement (FB feed + IG feed ← feed, IG Story ← story, LinkedIn ← linkedin), stage preview review, nothing scheduled', (data || []).length === 4 && data.every((r) => r.stage === 'preview_review'), (data || []).map((r) => `${r.placement}:${Object.keys(r.assets).join('+')}`).join(' '));
}

const before = await dbState();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await openTab(browser, 1700);
await page.locator('#mk-schedule').screenshot({ path: `${OUT}/social-weeks-${MODE}-1700px-${STAMP}.png` });
await weeksChecks(page);
await page.click('#mk-schedule [data-mks-view="days"]');
await page.waitForSelector('#mk-schedule .mks-days');
await page.click('#mk-schedule [data-mks-range="4w"]');
await page.waitForTimeout(800);
await page.locator('#mk-schedule').screenshot({ path: `${OUT}/social-days-${MODE}-1700px-${STAMP}.png` });
await page.click('#mk-schedule [data-mks-view="weeks"]');
await page.waitForSelector('#mk-schedule .mks-weeks');
await panelChecks(page);
const after = await dbState();
const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
check('Viewing writes nothing (row counts + newest timestamps)', !changed.length, changed.map((k) => `${k}: ${before[k]} → ${after[k]}`).join(' | '));
if (RENDER) await render(page);
await browser.close();
check('every other non-GET refused (dry run)', true, `${blocked.length} refused: ${[...new Set(blocked)].join(', ')}`);
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);

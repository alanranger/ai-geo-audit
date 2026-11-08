/**
 * Live check (Agent D, 8 Nov 2026) of health badges in every people table + owner addresses counted apart, against
 * C:/TEMP/overview-health-expected.json and C:/TEMP/health-badges-expected.json (run both SQL scripts first).
 *   node scripts/playwright-verify-health-badges.mjs
 * READ-ONLY: every Marketing API write is blocked by a route guard (a blocked attempt is a FAIL); "Check: who joined /
 * left" is sent with record:false so no check is recorded. Screenshots are local (names): C:/TEMP/health-badges-verify.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.DASH_BASE || 'https://ai-geo-audit.vercel.app';
const URL = `${BASE}/audit-dashboard.html?tab=marketing#marketing`;
const OUT = 'C:/TEMP/health-badges-verify';
const PANE_VIEWPORT = Number(process.env.PANE_VIEWPORT) || 1250;
const key = fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).find((l) => l.startsWith('ARP_ADMIN_KEY=')).slice(14).replace(/^"|"$/g, '').trim();
const OV = JSON.parse(fs.readFileSync('C:/TEMP/overview-health-expected.json', 'utf8'));
const HB = JSON.parse(fs.readFileSync('C:/TEMP/health-badges-expected.json', 'utf8'));
fs.mkdirSync(OUT, { recursive: true });

const SEL = {
  query: '#mk-query', results: '#mq-results', head: '#mq-results .mq-head', loading: '#mq-results .rt-loading', table: '#mq-results table',
  qRow: '#mq-results tbody tr[data-q-person]', preset: '#mq-preset', search: '#mq-q', groups: '#mq-groups-table', diff: '#mq-diff .mk-detail',
  panel: '#mk-client-health', matrix: '#mk-client-health .ch-matrix', num: '.ch-num',
  segSelect: '#mk-cust-seg', segShow: '[data-mk="cust-search"]', segTable: '#mk-cust-table', segRow: '#mk-cust-table tbody tr[data-mk-person]',
  pick: '[data-mk-pick]', ownerBox: '#mk-snap-owner', preview: '[data-mk="preview"]', snapOut: '#mk-snap-out', snapReview: '#mk-snap-review .mk-detail',
  reviewBtn: '[data-mk-review]', cleanMode: '#mc-mode', cleanReview: '[data-mc="review"]', cleanOut: '#mc-out',
  badge: '.hb', badgeNone: '.hb-none'
};
const WRITE = /create|save|exclude|restore|freeze|approve|execute|load-request|presend|export-status|campaign-plan|sync|hold|owner|separate|flag|delete|cancel/i;

const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note: String(note) });
const intIn = (txt, re) => { const m = String(txt || '').replace(/,/g, '').match(re); return m ? Number(m[1]) : null; };
const actions = new Set();
const blocked = [];
const server5xx = [];
const hold = { groups: false };
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

const browser = await chromium.launch({ headless: true, channel: 'chrome' });

/** Read-only guard: block writes; never record a saved-group check. */
async function guard(page) {
  await page.route('**/api/aigeo/marketing**', async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') {
      if (hold.groups && /action=groups/.test(req.url())) { hold.groups = false; await sleep(20000); }
      return route.continue();
    }
    let body = {};
    try { body = JSON.parse(req.postData() || '{}'); } catch { body = {}; }
    actions.add(body.action);
    if (body.action === 'group-preview') return route.continue({ postData: JSON.stringify({ ...body, record: false }) });
    if (WRITE.test(String(body.action || ''))) { blocked.push(body.action); return route.abort(); }
    return route.continue();
  });
}

async function openAt(width) {
  const page = await browser.newPage({ viewport: { width, height: 1200 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => { if (r.status() >= 500) server5xx.push(`${r.status()} ${r.url().replace(/\?.*$/, '').slice(-60)}`); });
  await guard(page);
  await page.addInitScript((kk) => { sessionStorage.setItem('arp_admin_key', kk); localStorage.removeItem('mk-query-prefs-v1'); }, key);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(SEL.qRow, { timeout: 180000 }).catch(() => {});
  await settle(page);
  return { page, errors };
}

async function settle(page) {
  await page.waitForSelector(SEL.loading, { state: 'detached', timeout: 120000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector('#mq-results')?.textContent.includes('badges loading'), null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(600);
}

/** Do something that re-runs Customers, then wait for the header to change. */
async function rerun(page, fn) {
  const before = await page.textContent(SEL.head).catch(() => '');
  await fn();
  await page.waitForFunction(([s, b]) => { const t = document.querySelector(s)?.textContent || ''; return t && t !== b; }, [SEL.head, before], { timeout: 90000 }).catch(() => {});
  await settle(page);
}

async function readHead(page) {
  const t = (await page.textContent(SEL.results).catch(() => '')).replace(/\s+/g, ' ');
  return { text: t.slice(0, 400), people: intIn(t, /(\d+) people (?:match|undecided)/), owner: intIn(t, /\+ (\d+) owner address/) ?? 0, undecided: intIn(t, /(\d+) undecided \(unknown data\)/), no: intIn(t, /(\d+) don't match/), watermark: /badges as of/.test(t) };
}

/** Rows of any people table → { key, name, badges[], none, empty }. key = person id, else the email shown. */
async function readRows(page, rowSel) {
  return page.$$eval(rowSel, (rows) => rows.map((r) => {
    const hb = [...r.querySelectorAll('.hb')];
    const email = (r.textContent.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/) || [''])[0].toLowerCase();
    return {
      id: r.dataset.qPerson || r.dataset.mkPerson || null, email,
      badges: hb.filter((b) => b.dataset.hb).map((b) => b.dataset.hb), texts: hb.map((b) => b.textContent.trim()),
      none: r.querySelectorAll('.hb-none').length, owner: /owner copy|business copy/.test(r.textContent)
    };
  }));
}

function badgeChecks(all, tag) {
  const rows = all.filter((r) => r.id || r.email || r.texts.length || r.none);
  const bad = rows.filter((r) => r.badges.length !== 3 || r.none || r.texts.some((t) => !t || t === '…'));
  check(`${tag}: every row has 3 badges (purchase · email · can email), none blank`, rows.length > 0 && !bad.length, `${rows.length} rows · ${bad.length} incomplete`);
  return rows;
}

const shots = [];
async function shot(page, sel, name) {
  await page.evaluate(() => { for (const el of document.querySelectorAll('body *')) if (getComputedStyle(el).position === 'fixed') el.style.visibility = 'hidden'; });
  const file = path.join(OUT, `${name}.png`);
  await page.locator(sel).first().screenshot({ path: file }).then(() => shots.push(path.basename(file))).catch((e) => check(`screenshot ${name}`, false, e.message.slice(0, 80)));
}

// ---------- Customers ----------
async function customersDefault(page, tag, store) {
  const ths = await page.$$eval(`${SEL.table} thead th`, (els) => els.map((e) => e.textContent.replace(/[▲▼]/g, '').trim()));
  const iP = ths.indexOf('Purchase health');
  const lead = ths.slice(0, iP).join('|');
  check(`${tag}: Customers default — badge headers right after Name (/ Email)`, iP > 0 && ths[iP + 1] === 'Email health' && ths[iP + 2] === 'Can email' && /^Name(\|Email)?$/.test(lead), ths.join(' | '));
  const tips = await page.$$eval(`${SEL.table} thead th`, (els) => els.filter((e) => /health|Can email/.test(e.textContent)).map((e) => e.title));
  check(`${tag}: header tooltips separate purchase "Warm/Cooling" from email "Warm/Cooling" + first-open limitation`, /About buying, not email/.test(tips[0] || '') && /About emails, not purchases/.test(tips[1] || '') && /first open/i.test(tips[1] || ''), tips.map((t) => t.slice(0, 40)).join(' / '));
  const head = await readHead(page);
  check(`${tag}: badge watermark (as-of + rule versions) on Customers`, head.watermark, head.text.slice(-120));
  store.customers = badgeChecks(await readRows(page, SEL.qRow), `${tag} Customers default`);
  await shot(page, SEL.query, `${tag}-customers-default`);
}

async function emailPreset(page, tag) {
  const value = await page.$eval(SEL.preset, (s) => [...s.options].find((o) => /email activity/i.test(o.textContent))?.value || null);
  check(`${tag}: Email activity preset exists`, !!value);
  if (!value) return;
  await rerun(page, () => page.selectOption(SEL.preset, value));
  badgeChecks(await readRows(page, SEL.qRow), `${tag} Customers · Email activity preset`);
  await shot(page, SEL.query, `${tag}-customers-email-activity`);
  const ov = await page.$eval(SEL.preset, (s) => [...s.options].find((o) => /overview/i.test(o.value + o.textContent))?.value || s.options[0].value);
  await rerun(page, () => page.selectOption(SEL.preset, ov));
}

async function chip(page, spec) { await rerun(page, () => page.click(`[data-qh="${spec}"]`)); return readHead(page); }

async function chipChecks(page) {
  const M = HB.client_matrix.cells;
  const h = await chip(page, 'purchase:p0_6');
  const rows = await readRows(page, SEL.qRow);
  const inBand = (cells) => Object.entries(cells).filter(([k]) => k.startsWith('m0_6×')).reduce((a, [, v]) => a + v, 0);
  const want = Object.values(M.m0_6).reduce((a, v) => a + v, 0);
  const orgs = inBand(HB.organisations.cells);
  check('purchase band chip "Recent" = independent (clients + organisation records; owner apart)', h.people === want + orgs && h.owner === inBand(HB.owners.cells) && rows.every((r) => r.badges[0] === 'purchase:p0_6'), `${h.people} + ${h.owner} owner vs ${want} people + ${orgs} organisations`);
  check('Customers "people" count keeps organisations apart like the health panel', h.people === want, `Customers ${h.people} vs panel 0–6 row ${want}`);
  await chip(page, 'purchase:p0_6');
  await chip(page, 'purchase:p_unknown');
  const unk = await readRows(page, SEL.qRow);
  check('Unknown purchase health renders as an "Unknown" badge (never blank)', unk.length > 0 && unk.every((r) => r.badges[0] === 'purchase:p_unknown' && r.texts[0] === 'Unknown'), `${unk.length} rows · ${[...new Set(unk.map((r) => r.texts[0]))].join(',')}`);
  await shot(page, SEL.query, '1600-customers-purchase-unknown');
  await chip(page, 'purchase:p_unknown');
  await chip(page, 'email:e_unknown');
  const eu = await readRows(page, SEL.qRow);
  check('Unknown email health renders as an "Unknown" badge (never blank)', eu.length > 0 && eu.every((r) => r.badges[1] === 'email:e_unknown' && r.texts[1] === 'Unknown'), `${eu.length} rows`);
  await chip(page, 'email:e_unknown');
}

// ---------- client list health drill-downs ----------
async function openPanel(page) {
  await page.evaluate(() => window.mkOpenClientHealth?.());
  await page.waitForSelector(SEL.matrix, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(500);
}
const cellLoc = (page, rowIdx, colIdx) => page.locator(`${SEL.matrix} tbody tr`).nth(rowIdx).locator('td').nth(colIdx).locator(SEL.num).first();

async function drillDown(page, store) {
  await openPanel(page);
  await rerun(page, () => cellLoc(page, 0, 2).click());
  const h = await readHead(page);
  const M = HB.client_matrix.cells;
  check('drill-down 0–6 × not subscribed: Customers count = panel cell (clients)', h.people === M.m0_6.not_subscribed && h.owner === 0, `${h.people} + ${h.owner} owner vs ${M.m0_6.not_subscribed}`);
  const rows = badgeChecks(await readRows(page, SEL.qRow), 'drill-down 0–6 × not subscribed');
  check('drill-down rows all carry Recent + not subscribed badges', rows.every((r) => r.badges[0] === 'purchase:p0_6' && r.badges[2] === 'consent:not_subscribed'), `${rows.length} rows`);
  store.drill = rows;
  await shot(page, SEL.query, '1600-drilldown-0-6-not-subscribed');
  return rows;
}

/** The same person looked up on their own in Customers shows the same three badges as in the drill-down. */
async function samePersonSearch(page, rows) {
  const names = await page.$$eval(SEL.qRow, (trs) => trs.slice(0, 3).map((t) => ({ id: t.dataset.qPerson, name: t.querySelector('td')?.childNodes[0]?.textContent?.trim() || t.querySelector('td')?.textContent?.trim() })));
  let same = 0;
  for (const n of names) {
    await rerun(page, async () => { await page.click('[data-q-act="clear"]'); });
    await rerun(page, async () => { await page.fill(SEL.search, n.name); await page.click('[data-q-act="run"]'); });
    const hit = (await readRows(page, SEL.qRow)).find((r) => r.id === n.id);
    if (hit && JSON.stringify(hit.badges) === JSON.stringify(rows.find((r) => r.id === n.id)?.badges)) same += 1;
  }
  check('same person: Customers search shows the same badges as the drill-down', names.length > 0 && same === names.length, `${same} of ${names.length}`);
  await page.fill(SEL.search, '');
}

async function windowChecks(page) {
  await openPanel(page);
  const cols = await page.$$eval(`${SEL.matrix} thead th`, (els) => els.map((e) => e.textContent));
  const ci = cols.findIndex((c) => /^Can email/i.test(c.trim()));
  await rerun(page, () => page.locator(`${SEL.matrix} tfoot td`).nth(ci).locator(SEL.num).first().click());
  const base = await readHead(page);
  check('can-email drill-down: people = independent (panel column; owners apart)', base.people === HB.can_email.people_not_owner, `${base.people} + ${base.owner} owner shown vs ${HB.can_email.people_not_owner} people (+ ${HB.can_email.owner} owner addresses that can be emailed)`);
  const I = HB.inactivity_6m_can_email_people;
  const ina = await chip(page, 'inactive:6');
  check('inactivity 6 months (coverage incomplete): 0 confident matches; undecided = independent', ina.people === I.yes && ina.undecided === I.undecided, `match ${ina.people} · undecided ${ina.undecided} · "don't match" ${ina.no} (all records) vs ${I.yes} · ${I.undecided} · active in window ${I.no_active_in_window} (would match when complete: ${I.would_be_yes_if_coverage_complete})`);
  await shot(page, SEL.query, '1600-customers-inactive-6m');
  await chip(page, 'inactive:6');
  const op = await chip(page, 'opened:6');
  check('opened within 6 months among can-email = independent (positive evidence still matches)', op.people === I.opened_within_yes, `${op.people} + ${op.owner} owner vs ${I.opened_within_yes} (+ ${HB.inactivity_6m_can_email_owner.opened_within_yes} owner)`);
  await chip(page, 'opened:6');
}

// ---------- LR segment: Customers, saved-group preview, segment members, snapshot review ----------
const LR = HB.lr_segment.yes_strict;

async function lrCustomers(page, store) {
  const row = page.locator(`${SEL.groups} tbody tr`).filter({ hasText: 'LR30' }).first();
  await rerun(page, () => row.locator('[data-q-load]').click());
  const h = await readHead(page);
  check('LR segment in Customers: 39 people · + 1 owner address (independent)', h.people === LR.clients && h.owner === LR.owner, `${h.people} + ${h.owner} vs ${LR.clients} + ${LR.owner}`);
  store.lrCustomers = badgeChecks(await readRows(page, SEL.qRow), 'LR segment in Customers');
  await shot(page, SEL.query, '1600-customers-lr-segment');
  hold.groups = true;
  await row.locator('[data-q-check]').click();
  await page.waitForSelector(SEL.diff, { timeout: 90000 }).catch(() => {});
  const txt = (await page.textContent(SEL.diff).catch(() => '')).replace(/\s+/g, ' ');
  check('saved-group preview: N people match now + owner apart', intIn(txt, /(\d+) people match now/) === LR.clients && intIn(txt, /\+ (\d+) owner address/) === LR.owner, txt.replace(/[\w.+-]+@[\w.-]+/g, '<email>').slice(0, 140));
  await page.locator(`${SEL.diff} details`).first().evaluate((d) => { d.open = true; }).catch(() => {});
  store.group = badgeChecks(await readRows(page, `${SEL.diff} details li`), 'saved-group preview members');
  await shot(page, '#mq-diff', '1600-saved-group-preview');
  await page.waitForTimeout(22000);
  check('saved-group preview stays on screen after the groups list refreshes', await page.locator(SEL.diff).count() > 0, 'checkGroup() ends with loadGroups(), which re-renders #mq-diff empty');
}

async function segmentMembers(page, store, tag) {
  const id = await page.$eval(SEL.segSelect, (s) => [...s.options].find((o) => /LR30/.test(o.textContent))?.value || '');
  check(`${tag}: LR segment listed in Segment members`, !!id);
  if (!id) return;
  await page.selectOption(SEL.segSelect, id);
  await page.click(SEL.segShow);
  await page.waitForSelector(SEL.segRow, { timeout: 120000 }).catch(() => {});
  await page.waitForFunction((s) => !document.querySelector(s)?.textContent.includes('badges loading'), SEL.segTable, { timeout: 60000 }).catch(() => {});
  store.members = badgeChecks(await readRows(page, SEL.segRow), `${tag} segment members`);
  await shot(page, '#mk-customers', `${tag}-segment-members`);
}

async function snapshotPreview(page, store, tag) {
  await page.$$eval(SEL.pick, (els) => els.forEach((e) => { if (e.checked) e.click(); }));
  const pick = page.locator('[data-mk-pick^="q-lr30"]');
  if (!(await pick.count())) { check(`${tag}: LR segment pickable for a snapshot`, false); return; }
  await pick.first().check();
  await page.check(SEL.ownerBox);
  await page.click(SEL.preview);
  await page.waitForSelector(SEL.snapReview, { timeout: 120000 }).catch(() => {});
  const out = (await page.textContent(SEL.snapOut).catch(() => '')).replace(/\s+/g, ' ');
  const n = intIn(out, /^(\d+) people/);
  check(`${tag}: snapshot "Count & review picked" = 39 people · + 1 owner · business copy line (nothing saved)`, n === LR.clients && intIn(out, /\+ (\d+) owner address/) === LR.owner && /business copy/.test(out), out.slice(0, 160));
  const rows = await readRows(page, `${SEL.snapReview} tbody tr`);
  store.snapshot = badgeChecks(rows, `${tag} snapshot review`);
  check(`${tag}: snapshot review lists owner / business copy on their own rows`, rows.some((r) => r.owner), `${rows.filter((r) => r.owner).length} owner-copy rows`);
  await shot(page, '#mk-snap-review', `${tag}-snapshot-review-picked`);
}

async function savedSnapshotReview(page) {
  const btn = page.locator(SEL.reviewBtn).first();
  if (!(await btn.count())) { check('saved snapshot "Review people" (none saved — skipped)', true); return; }
  await btn.click();
  const box = page.locator('.mk-detail').filter({ hasText: 'frozen' }).filter({ has: page.locator('table') }).first();
  await box.locator('.hb, .hb-none').first().waitFor({ timeout: 90000 }).catch(() => {});
  const rows = await box.locator('tbody tr').evaluateAll((trs) => trs.map((r) => ({ n: r.querySelectorAll('.hb').length, none: r.querySelectorAll('.hb-none').length })));
  check('saved snapshot "Review people": badges on every row', rows.length > 0 && rows.every((r) => r.n === 3 && !r.none), `${rows.length} rows`);
  await box.screenshot({ path: path.join(OUT, '1600-saved-snapshot-review.png') }).then(() => shots.push('1600-saved-snapshot-review.png')).catch(() => {});
}

async function cleanupTest(page, store, tag) {
  await page.selectOption(SEL.cleanMode, 'test');
  await page.click(SEL.cleanReview);
  await page.waitForFunction((s) => document.querySelector(s)?.querySelector('table .hb, table .hb-none'), SEL.cleanOut, { timeout: 120000 }).catch(() => {});
  store.cleanup = badgeChecks(await readRows(page, `${SEL.cleanOut} tbody tr`), `${tag} clean-up review (TEST, not frozen)`);
  await shot(page, SEL.cleanOut, `${tag}-cleanup-review-test`);
}

/** Same person, same three badges, wherever they appear (by person id; else by the email shown). */
function consistency(store) {
  const idEmail = new Map((store.members || []).filter((r) => r.id && r.email).map((r) => [r.id, r.email]));
  const views = Object.entries(store).map(([k, rows]) => [k, new Map(rows.map((r) => [r.id ? (idEmail.get(r.id) || r.id) : r.email, JSON.stringify(r.badges)]).filter(([kk]) => kk))]);
  const seen = new Map();
  let compared = 0;
  const bad = [];
  for (const [view, m] of views) {
    for (const [person, b] of m) {
      if (seen.has(person)) { compared += 1; if (seen.get(person).b !== b) bad.push(`${seen.get(person).view} vs ${view}`); } else seen.set(person, { view, b });
    }
  }
  check('same badges everywhere (Customers · drill-down · segment members · group preview · snapshot · clean-up)', compared > 0 && !bad.length, `${compared} cross-view comparisons · ${bad.length} mismatches ${bad.slice(0, 3).join('; ')}`);
}

// ---------- run ----------
const store = {};
const wide = await openAt(1600);
await customersDefault(wide.page, '1600', store);
await emailPreset(wide.page, '1600');
await chipChecks(wide.page);
const drill = await drillDown(wide.page, store);
await samePersonSearch(wide.page, drill);
await windowChecks(wide.page);
await lrCustomers(wide.page, store);
await segmentMembers(wide.page, store, '1600');
await snapshotPreview(wide.page, store, '1600');
await savedSnapshotReview(wide.page);
await cleanupTest(wide.page, store, '1600');
await openPanel(wide.page);
await shot(wide.page, SEL.panel, '1600-client-health-panel');
consistency(store);
await wide.page.reload({ waitUntil: 'domcontentloaded' });
await wide.page.waitForSelector(SEL.qRow, { timeout: 180000 }).catch(() => {});
await settle(wide.page);
check('refresh: Customers renders with badges (no blank tab)', (await readRows(wide.page, SEL.qRow)).some((r) => r.badges.length === 3));
check('no page errors (1600)', !wide.errors.length, wide.errors.slice(0, 3).join(' | '));
await wide.page.close();

const narrow = await openAt(PANE_VIEWPORT);
const paneW = await narrow.page.evaluate((s) => Math.round(document.querySelector(s)?.getBoundingClientRect().width || 0), SEL.query);
check(`pane width about 800 px (window ${PANE_VIEWPORT})`, paneW >= 700 && paneW <= 900, `${paneW} px`);
const ns = {};
check('direct load (pane): Customers renders with badges', (await readRows(narrow.page, SEL.qRow)).some((r) => r.badges.length === 3));
await shot(narrow.page, SEL.query, 'pane-customers-default');
const over = await narrow.page.evaluate((s) => { const el = document.querySelector(s); return el ? el.scrollWidth > el.clientWidth + 2 : true; }, SEL.query);
check('pane: Customers section not wider than the pane (table scrolls inside)', !over);
await segmentMembers(narrow.page, ns, 'pane');
await snapshotPreview(narrow.page, ns, 'pane');
await cleanupTest(narrow.page, ns, 'pane');
await openPanel(narrow.page);
await rerun(narrow.page, () => cellLoc(narrow.page, 0, 2).click());
await shot(narrow.page, SEL.query, 'pane-drilldown-0-6-not-subscribed');
check('no page errors (pane)', !narrow.errors.length, narrow.errors.slice(0, 3).join(' | '));
await browser.close();

check('read-only: no write action attempted (route guard)', !blocked.length, blocked.join(','));
check('no server 5xx responses', !server5xx.length, [...new Set(server5xx)].join(' | '));
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, actions: [...actions], shots }, null, 2));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note !== '' ? ` (${r.note})` : ''}`);
console.log('API actions seen:', [...actions].join(', '));
console.log('screenshots:', shots.join(', '));
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED of ${results.length}`);

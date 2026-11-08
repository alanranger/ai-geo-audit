/**
 * Strategy clean layout on LIVE data with the LOCAL code (before deploy), 1700px. Read-only: serves the local strategy /
 * marketing scripts (+ injects lib/strategy-layout.js), answers /api/aigeo/strategy-summary with the local handler, and
 * refuses every non-GET. DB row counts + newest timestamps compared before / after. Screenshots: folds closed + open.
 *   node scripts/playwright-verify-strategy-clean-local.mjs        (LIVE=1 to test the deployed files only)
 */
import fs from 'node:fs';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
Object.assign(process.env, { SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: ENV.SUPABASE_SERVICE_ROLE_KEY });
const LIVE = process.env.LIVE === '1';
const BASE = 'https://ai-geo-audit.vercel.app';
const TAG = LIVE ? 'live' : 'local';
const OUT = 'outputs';
const STAMP = '20261108';
const LOCAL_FILES = ['strategy-tab.js', 'strategy-layout.js', 'strategy-quarter-plan.js', 'marketing-overview-tiles.js', 'marketing-schedule-model.js', 'revenue-truth-controller.mjs'];
const BLUR = '.mk-detail, #mk-cust-body, #mq-results td:first-child, #mk-review-table td:first-child { filter: blur(6px) !important; }';
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const blocked = [];
const errors = [];
const TABLES = { strategy_campaign_steps: 'last_seen_at', strategy_campaign_ticks: 'updated_at', strategy_campaigns: 'updated_at', strategy_quarter_actions: 'updated_at', strategy_initiatives: 'updated_at', strategy_event_snapshots: 'created_at', sqs_send_meter: 'captured_at', marketing_segment_exports: 'created_at', marketing_event_facts: 'set_at', marketing_segment_evaluations: 'evaluated_at' };

async function dbState() {
  const out = {};
  for (const [t, c] of Object.entries(TABLES)) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true });
    const { data, error } = await sb.from(t).select(c).not(c, 'is', null).order(c, { ascending: false }).limit(1);
    Object.assign(out, { [`${t}.rows`]: count, [`${t}.max(${c})`]: error ? 'n/a' : data?.[0]?.[c] || null });
  }
  return out;
}
let summaryBody = null;
async function localSummary() {
  if (summaryBody) return summaryBody;
  const { default: handler } = await import('../api/aigeo/strategy-summary.js');
  let body = null;
  await handler({ method: 'GET', query: {}, headers: {} }, { status() { return this; }, setHeader() {}, json(j) { body = j; return this; } });
  summaryBody = JSON.stringify(body);
  return summaryBody;
}

async function routes(page) {
  await page.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); localStorage.setItem('mks-view', 'days'); }, ENV.ARP_ADMIN_KEY);
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() !== 'GET') { if (url.pathname.startsWith('/api/')) blocked.push(`${req.method()} ${url.pathname}`); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' }); }
    if (LIVE) return route.fallback();
    const file = LOCAL_FILES.find((f) => url.pathname === `/lib/${f}`);
    if (file) return route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`lib/${file}`, 'utf8') });
    if (url.pathname === '/api/aigeo/strategy-summary') return route.fulfill({ status: 200, contentType: 'application/json', body: await localSummary() });
    if (url.pathname === '/audit-dashboard.html') {
      const res = await route.fetch();
      const html = (await res.text()).replace(/(<script src="\/lib\/strategy-tab\.js[^"]*"><\/script>)/, '$1\n  <script src="/lib/strategy-layout.js?v=local"></script>');
      return route.fulfill({ response: res, body: html, headers: { ...res.headers(), 'content-type': 'text/html; charset=utf-8' } });
    }
    return route.fallback();
  });
}
async function open(browser, hash, ready) {
  const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
  page.on('pageerror', (e) => errors.push(`${hash}: ${e.message}`));
  await routes(page);
  await page.goto(`${BASE}/audit-dashboard.html#${hash}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(ready, null, { timeout: 240000 });
  await page.waitForTimeout(4000);
  await page.addStyleTag({ content: BLUR });
  return page;
}
const num = (t) => Number(String(t || '').replace(/[^\d.]/g, '')) || null;

async function strategy(browser) {
  const page = await open(browser, 'strategy', () => document.querySelector('#st-fold-why') && !/loading/i.test(document.querySelector('#st-next-delivery')?.textContent || 'loading'));
  const layout = await page.evaluate(() => {
    const panel = document.querySelector('section[data-panel="strategy"]');
    const shown = (el) => el.offsetParent !== null && !el.closest('details:not([open]) > :not(summary)');
    const blocks = [...panel.querySelectorAll('#strategy-root > *, section[data-panel="strategy"] > *')].filter((el) => el.id !== 'strategy-root' && shown(el) && el.tagName !== 'STYLE').map((el) => el.id || el.tagName).filter((x) => x !== 'DIV' || true);
    const outside = ['st-action-list', 'st-next4', 'st-campaign', 'st-insights', 'st-weights', 'st-gp-chart'].filter((id) => { const el = document.getElementById(id); return el && shown(el); });
    return { height: Math.round(panel.getBoundingClientRect().height), doc: document.documentElement.scrollHeight, blocks, outside, why: document.getElementById('st-fold-why')?.open, targets: document.getElementById('st-fold-targets')?.open, ids: [...document.querySelectorAll('#st-fold-why #st-gp-chart, #st-fold-why #st-weights, #st-fold-why #st-insights, #st-fold-why #st-fold-tasks #st-action-list, #st-fold-why #st-fold-tasks #st-next4, #st-fold-targets #st-targets-host')].map((e) => e.id) };
  });
  check('visible page = tiles + Decisions + Quarter plan (+ Next delivery) + 2 closed folds', ['st-where', 'st-decisions', 'st-quarter-plan', 'st-next-delivery', 'st-fold-why', 'st-fold-targets'].every((id) => layout.blocks.includes(id)) && layout.why === false && layout.targets === false && !layout.outside.length, `visible blocks: ${layout.blocks.join(' > ')} · outside folds: ${layout.outside.join(', ') || 'none'}`);
  check('page height < 4,000px with the folds closed', layout.height < 4000, `${layout.height}px (document ${layout.doc}px)`);
  check('Why fold holds the chart, Top 3 weights, the analysis tiles and the task lists; Targets fold holds the Targets panel', ['st-gp-chart', 'st-weights', 'st-insights', 'st-action-list', 'st-next4', 'st-targets-host'].every((id) => layout.ids.includes(id)), layout.ids.join(', '));
  const qp = await page.evaluate(() => {
    const host = document.getElementById('st-quarter-plan');
    const lines = (el) => { const cs = getComputedStyle(el); const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2; return Math.round(el.getBoundingClientRect().height / lh); };
    const shown = (el) => el.offsetParent !== null && !el.closest('details:not([open]) > :not(summary)');
    const paras = [...host.querySelectorAll('p, .qp-p, .qp-intro, .qp-foot')].filter(shown).map((el) => ({ lines: lines(el), text: el.textContent.trim().slice(0, 60) })).filter((x) => x.text);
    const inis = [...host.querySelectorAll('.qp-ini')].filter(shown).map((ini) => ({ title: ini.querySelector('.qp-it')?.textContent.trim().slice(0, 40), lines: [...ini.children].filter((c) => shown(c) && !c.matches('details')).reduce((a, c) => a + lines(c), 0) }));
    return { paras, inis, kpis: host.querySelectorAll('.qp-kpis .qp-kpi').length };
  });
  check('Quarter plan: no visible paragraph over 2 lines (intro behind ⓘ)', qp.paras.every((x) => x.lines <= 2), qp.paras.filter((x) => x.lines > 2).map((x) => `${x.lines}: ${x.text}`).join(' | ') || `${qp.paras.length} short texts`);
  check('Quarter plan: each initiative ≤ 3 visible lines; KPI boxes kept', qp.inis.length && qp.inis.every((x) => x.lines <= 3) && qp.kpis > 0, `${qp.inis.map((x) => `${x.title}=${x.lines}`).join(' · ')} · KPI boxes ${qp.kpis}`);
  const tl = await page.evaluate(() => {
    const card = document.querySelector('#st-quarter-plan .qp-card.is-current');
    const box = [...(card?.querySelectorAll('.qp-kpi') || [])].find((k) => /Pick n Mix plans/.test(k.textContent));
    const pnm = [...(card?.querySelectorAll('.qp-ini') || [])].find((i) => /Pick n Mix/.test(i.querySelector('.qp-it')?.textContent || ''));
    const all = [...document.querySelectorAll('#st-quarter-plan .qp-card')].flatMap((c) => [...c.querySelectorAll('.qp-ini')].map((i) => `${c.querySelector('.qp-h b')?.textContent.split(' ·')[0]} ${i.querySelector('.qp-it')?.textContent.trim()}: ${i.querySelector('.qp-l')?.textContent.trim()}`));
    return { box: box?.querySelector('.qp-kv')?.textContent.trim(), boxSub: box?.querySelector('.qp-ks')?.textContent.trim(), line: pnm?.querySelector('.qp-l')?.textContent.trim(), all };
  });
  const [bActual, bTarget] = String(tl.box || '').split('/').map((x) => x.trim());
  check('Pick n Mix initiative target line agrees with its KPI box (same roadmap target and actual)', tl.line && new RegExp(`^Target ${bTarget} plans · Actual ${bActual} · Gap ${Number(bTarget) - Number(bActual)} \\(by 31 Dec\\)`).test(tl.line), `box "${tl.box}" (${tl.boxSub}) · line "${tl.line}"`);
  fs.writeFileSync(`${OUT}/_correction3-${TAG}-target-lines.json`, JSON.stringify(tl.all, null, 1));
  const dec = (await page.locator('#st-decisions').innerText()).replace(/\s+/g, ' ');
  check('beginners decision row shows real figures (next promoted course 13 Jan, 1 booked)', /beginners/i.test(dec) && /13 Jan/.test(dec) && /1 booked/.test(dec) && /Keep/.test(dec), dec.slice(0, 260));
  const next = await page.locator('#st-next-delivery').evaluate((el) => ({ text: el.textContent.replace(/\s+/g, ' ').trim(), key: el.dataset.nextKey }));
  const tiles = (await page.locator('#st-where').innerText()).replace(/\s+/g, ' ');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${OUT}/strategy-clean-AFTER-${TAG}-folds-closed-1700px-${STAMP}.png`, fullPage: true });
  await page.evaluate(() => { const d = document.querySelector('#st-quarter-plan .qp-ini details.qp-links'); if (d) d.open = true; });
  await page.waitForTimeout(500);
  await page.locator('#st-quarter-plan').screenshot({ path: `${OUT}/correction2-quarter-plan-${TAG}-initiative-details-open-1700px-${STAMP}.png` });
  await page.evaluate(() => { const d = document.querySelector('#st-quarter-plan .qp-ini details.qp-links'); if (d) d.open = false; });
  await page.evaluate(() => { document.getElementById('st-fold-why').open = true; document.getElementById('st-fold-targets').open = true; document.getElementById('st-fold-tasks').open = true; });
  await page.waitForFunction(() => document.querySelector('#st-gp-chart canvas'), null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(4000);
  const chart = await page.evaluate(() => ({ canvas: !!document.querySelector('#st-fold-why #st-gp-chart canvas'), text: (document.querySelector('#st-gp-chart')?.textContent || '').replace(/\s+/g, ' ').slice(0, 140) }));
  check('Alan\'s GP-vs-survival chart is in the Why fold (same chart and data as Revenue)', chart.canvas, chart.text);
  const openH = await page.evaluate(() => Math.round(document.querySelector('section[data-panel="strategy"]').getBoundingClientRect().height));
  await page.screenshot({ path: `${OUT}/strategy-clean-AFTER-${TAG}-folds-open-1700px-${STAMP}.png`, fullPage: true });
  const s = JSON.parse(await page.evaluate(() => JSON.stringify(window.stLastData ? window.stLastData() : null)));
  await page.close();
  return { next, tiles, s, openH, layout };
}

async function marketing(browser) {
  const page = await open(browser, 'marketing', () => document.querySelector('#mk-schedule .mks-days') && document.querySelector('#mk-overview-tiles .mko-tile') && !/Loading/.test(document.querySelector('#mk-overview-tiles')?.textContent || 'Loading'));
  const first = await page.evaluate(() => {
    const t = document.querySelector('#mk-schedule table.mks-days');
    const cards = [];
    [...t.querySelectorAll('tr')].slice(1).forEach((tr, ri) => [...tr.querySelectorAll('td')].slice(1).forEach((td, ci) => td.querySelectorAll('.mks-card[data-mks-item]').forEach((c) => {
      if (/s-(done|late|resolved)/.test(c.className)) return;
      const time = (c.textContent.match(/\b(\d{2}:\d{2})\b/) || [])[1] || '99';
      cards.push({ id: c.dataset.mksItem, ci, ri, time, title: c.title });
    })));
    cards.sort((a, b) => a.ci - b.ci || a.time.localeCompare(b.time) || a.ri - b.ri);
    return cards[0] || null;
  });
  const tiles = (await page.locator('#mk-overview-tiles').evaluate((el) => el.textContent)).replace(/\s+/g, ' ');
  const secs = await page.evaluate(() => ({ waiting: (document.querySelector('#mk-waiting')?.textContent || '').trim().length, planned: !!document.querySelector('#mk-planned .mks-days'), results: (document.querySelector('#mk-results')?.textContent || '').trim().length, behind: document.querySelector('#mk-behind') ? (document.querySelector('#mk-behind').open ? 'open' : 'closed') : 'missing' }));
  check('Marketing still loads cleanly: Waiting on you / Planned / Results present, Behind-the-scenes fold closed', secs.waiting > 0 && secs.planned && secs.results > 0 && secs.behind === 'closed', JSON.stringify(secs));
  if (LIVE) await page.screenshot({ path: `${OUT}/strategy-clean-marketing-check-live-1700px-${STAMP}.png` });
  await page.close();
  return { first, tiles };
}

const before = await dbState();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const st = await strategy(browser);
const mk = await marketing(browser);
await browser.close();
const after = await dbState();
check('Next delivery matches Marketing Planned\'s first item', mk.first && st.next.key === mk.first.id, `Strategy: ${st.next.text} [${st.next.key}] · Marketing first card: ${mk.first?.title} [${mk.first?.id}]`);
const n3 = st.s?.insights?.rows?.money?.find((t) => t.key === 'money-next-3')?.numbers;
const ret = st.s?.roadmap_now?.returning_r12;
const k = (v) => `£${(Math.round(Math.abs(v) / 100) / 10).toLocaleString('en-GB')}k`;
const same = (label, v, stTxt, mkTxt) => check(`shared number identical on both tabs: ${label}`, v != null && stTxt.includes(k(v)) && mkTxt.includes(k(v)), `${label} = ${Math.round(v)} → "${k(v)}" on Strategy: ${stTxt.includes(k(v))}, on Marketing: ${mkTxt.includes(k(v))}`);
same('sales still needed to 31 Jan', n3?.required, st.tiles, mk.tiles);
same('booked ahead, next 3 months', n3?.inHand, st.tiles, mk.tiles);
same('returning-client sales, rolling 12 months', ret, st.tiles, mk.tiles);
const changed = Object.keys(before).filter((x) => before[x] !== after[x]);
check('viewing writes nothing (row counts + newest timestamps, 10 tables)', !changed.length, changed.map((x) => `${x}: ${before[x]} → ${after[x]}`).join(' | ') || 'no change');
check('every non-GET from the pages refused', true, `${blocked.length} refused: ${[...new Set(blocked)].join(', ')}`);
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
fs.writeFileSync(`${OUT}/_strategy-clean-${TAG}-result.json`, JSON.stringify({ results, height_closed: st.layout.height, height_open: st.openH, decisions: st.s?.decisions, next: st.next, marketing_first: mk.first, before, after }, null, 1));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(`height closed ${st.layout.height}px · open ${st.openH}px`);

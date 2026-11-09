/**
 * Live acceptance (deployed files, live data) for QUESTION-2026-11-09 (a) list view + status, (b) filter / email /
 * Light & Logic, (c) Google Business task and (e) Client list health button — the parts not covered by
 * scripts/playwright-verify-schedule-list.mjs (run that one with LOCAL=0 too). Read-only: Refresh is NOT pressed;
 * every non-GET is refused; DB counts compared, and the PC collector's own runs in the window are listed apart.
 *   node scripts/playwright-abce-live.mjs
 */
import fs from 'node:fs';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
const BASE = 'https://ai-geo-audit.vercel.app';
const OUT = 'outputs';
const STAMP = '20261109';
const NORFOLK = 'gpt-event-2026-11-09-norfolk-li';
const EMAIL_ID = '6af07a9b21498276ab252ccb';
const BLUR = '#mk-review-table td:first-child, #mk-cust-body, .mk-detail, #mk-query table td:first-child, #mk-client-health table td:first-child { filter: blur(6px) !important; }';
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note: String(note).replace(/\s+/g, ' ').slice(0, 360) });
const blocked = [];
const errors = [];
const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const text = (page, sel) => page.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '');

const TABLES = { strategy_campaigns: 'updated_at', strategy_campaign_ticks: 'updated_at', marketing_social_placements: 'set_at', marketing_decisions: 'recorded_at', strategy_initiative_links: 'set_at', strategy_quarter_actions: 'updated_at' };
async function dbState() {
  const out = {};
  for (const [t, c] of Object.entries(TABLES)) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true });
    const { data } = await sb.from(t).select(c).not(c, 'is', null).order(c, { ascending: false }).limit(1);
    Object.assign(out, { [`${t}.rows`]: count, [`${t}.max`]: data?.[0]?.[c] || null });
  }
  return out;
}

async function open(browser, hash, width, ready) {
  const page = await browser.newPage({ viewport: { width, height: width < 800 ? 844 : 1150 } });
  page.on('pageerror', (e) => errors.push(`${hash} ${width}: ${e.message}`));
  await page.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); for (const x of ['mks-layout', 'mks-channel', 'mks-lrange', 'mks-cycle', 'mks-view']) localStorage.removeItem(x); }, ENV.ARP_ADMIN_KEY);
  await page.route('**/api/**', (route) => {
    if (route.request().method() === 'GET') return route.fallback();
    blocked.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' });
  });
  const boardResp = hash === 'marketing' ? page.waitForResponse((r) => /action=delivery-status/.test(r.url()), { timeout: 180000 }).then((r) => r.json()).catch(() => null) : null;
  await page.goto(`${BASE}/audit-dashboard.html#${hash}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(ready, null, { timeout: 240000 });
  await page.waitForTimeout(5000);
  await page.addStyleTag({ content: BLUR });
  return { page, board: boardResp ? await boardResp : null };
}
/** Ready = Waiting + Results painted and the List complete (social rows arrive with the week plan, ~30 s after load). */
const MK_READY = () => /^\d+$/.test(document.querySelector('#mk-waiting .mkw-n')?.textContent.trim() || '') && document.querySelector('#mk-results tbody tr[data-mkr-row]') && /Norfolk coastal workshop/.test(document.querySelector('#mk-schedule .mkl')?.textContent || '') && /Last checked/.test(document.querySelector('#mk-schedule .mks-refresh')?.textContent || '') && !document.querySelector('#mk-planned.mkw-loading');

async function resultsRows(page) {
  return page.$$eval('#mk-results tbody tr[data-mkr-row]', (trs) => trs.map((r) => ({ id: r.dataset.mkrRow, st: r.cells[0].innerText.replace(/\s+/g, ' ').trim(), what: r.cells[1].innerText.trim(), link: r.cells[0].querySelector('a')?.href || '' })));
}

/* ---------- (a) ---------- */
async function partA(page, board, tag) {
  const list = await text(page, '#mk-schedule .mkl');
  const res = await resultsRows(page);
  const wait = await page.$$eval('#mk-waiting tbody tr', (rows) => rows.map((r) => r.innerText.replace(/\s+/g, ' ')));
  const li = res.filter((r) => /Norfolk coastal workshop/.test(r.what));
  const pl = (board?.placements || []).find((p) => p.step_key === NORFOLK);
  check(`(a) ${tag}: Norfolk LinkedIn 9 Nov Published + link in List and Results; no approval prompt`, pl?.status?.code === 'published' && /Norfolk coastal workshop[^]{0,80}Published[^]{0,30}View post/.test(list) && li.length === 1 && /Published/.test(li[0].st) && /linkedin\.com\/feed\/update\/urn:li:activity:7525483905408335872/.test(li[0].link) && !wait.some((r) => /Norfolk coastal/.test(r)), `board ${pl?.status?.label} · Results ${li[0]?.st} · Waiting ${wait.length} row(s)`);
  const em = res.filter((r) => /Something to inspire/.test(r.what));
  const be = (board?.emails || []).find((e) => e.email_id === EMAIL_ID);
  check(`(a) ${tag}: Mon 9 Nov 10:00 email ✅ Sent, one Results row by provider id; the board agrees`, em.length === 1 && /✅\s*Sent/.test(em[0].st) && /10:00am/.test(em[0].st) && em[0].id === `email|${EMAIL_ID}` && be?.status?.code === 'sent', `Results ${em.map((r) => r.st).join(' | ')} · board ${be?.status?.label} ${be?.status?.when || ''}`);
  check(`(a) ${tag}: focus bracketing not in Waiting`, !wait.some((r) => /focus bracketing|Macro/i.test(r)), wait.join(' || ') || '(empty)');
  return wait.length;
}

/* ---------- same source records in every view (b) + Refresh state (a) ---------- */
async function sameRecords(page, board) {
  const list = await text(page, '#mk-schedule .mkl');
  const res = await resultsRows(page);
  const sent = (board.emails || []).filter((e) => e.status?.code === 'sent' && e.email_id);
  const resOk = sent.filter((e) => res.some((r) => r.id === `email|${e.email_id}`)).every((e) => res.find((r) => r.id === `email|${e.email_id}`).st.includes(e.status.label));
  const upcoming = (board.emails || []).filter((e) => e.status?.code !== 'cancelled' && /^2026-11-(09|1[0-5])/.test(e.send_at || e.send_day || ''));
  check('(b) same source records: List email statuses and Results statuses = the one status board', resOk && upcoming.every((e) => list.includes(e.status.label)), `${sent.length} sent in board, ${upcoming.length} this week; ${upcoming.map((e) => `${e.title.slice(0, 22)}: ${e.status.label}`).join(' | ')}`);
  const rf = await text(page, '#mk-schedule .mks-refresh');
  const disabled = !!(await page.$('#mk-schedule [data-mks-refresh][disabled]'));
  check('(a) Refresh: button ready (not pressed again) and "Last checked … (Europe/London)" from the board; no sends', /Refresh status/.test(rf) && /Last checked .*\(Europe\/London\)/.test(rf) && !disabled, rf.slice(0, 160));
}

/* ---------- (b) LinkedIn tile ---------- */
async function linkedinTile(page) {
  const tile = flat(await page.evaluate(() => [...document.querySelectorAll('#mk-social .mksoc-g > *')].map((t) => t.innerText).find((t) => /Light & Logic newsletter/.test(t)) || ''));
  check('(b) LinkedIn tile labels: profile followers / Entered by GPT / Light & Logic box apart / nothing for Alan to enter', /Entered by GPT/.test(tile) && /Light & Logic newsletter \(LinkedIn\)/.test(tile) && /(profile followers|Waiting for GPT)/.test(tile) && !/Enter this week/.test(tile), tile.slice(0, 300));
  await page.locator('#mk-social .mksoc-g > *', { hasText: 'Light & Logic newsletter' }).first().screenshot({ path: `${OUT}/abce-linkedin-tile-live-1700px-${STAMP}.png` }).catch(() => {});
}

/* ---------- (c) Google Business task ---------- */
async function gbpTask(page) {
  const tasks = await text(page, '#mk-schedule .mkl-tasks');
  await page.locator('#mk-schedule .mkl-tasks li', { hasText: 'Weekly Google Business review' }).first().click();
  await page.waitForSelector('#mks-panel:not([hidden]) .mks-pitem', { timeout: 10000 }).catch(() => {});
  const gp = await text(page, '#mks-panel');
  const cta = await page.$$eval('#mks-panel button, #mks-panel a', (els) => els.map((e) => e.textContent.trim()).filter((t) => /publish|post now|schedule|approve|reply/i.test(t)));
  check('(c) GBP: an assigned weekly review task (owner GPT); no publication CTA; last collection and last review shown apart', /Weekly Google Business review · owner GPT/.test(tasks) && /Owner GPT/.test(gp) && /Last automatic collection/.test(gp) && /Last GPT review/.test(gp) && !cta.length, `${gp.slice(0, 220)} · CTAs: ${cta.join(', ') || 'none'}`);
  await page.screenshot({ path: `${OUT}/abce-gbp-task-live-1700px-${STAMP}.png` });
  await page.click('#mks-panel [data-mks-close]').catch(() => {});
}

/* ---------- (e) health button ---------- */
async function health(page, width) {
  const closed = await page.$eval('#mk-behind', (e) => !e.open);
  const btn = page.locator('#mk-planned [data-mk-open-health]');
  const visible = await btn.isVisible();
  await page.locator('#mk-planned .mk-sec-h').screenshot({ path: `${OUT}/abce-health-button-live-${width}px-${STAMP}.png` }).catch(() => {});
  await btn.click();
  await page.waitForFunction(() => document.querySelector('#mk-client-health .ch-head, #mk-client-health h3'), null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const o = await page.evaluate(() => ({ health: !!document.querySelector('#mk-client-health')?.checkVisibility(), back: !!document.querySelector('#mk-health-back a')?.checkVisibility(), top: Math.round(document.querySelector('#mk-health-back')?.getBoundingClientRect().top ?? -1), copies: document.querySelectorAll('#mk-client-health').length }));
  await page.screenshot({ path: `${OUT}/abce-health-open-live-${width}px-${STAMP}.png` });
  check(`(e) ${width}px: from a fresh load (Behind the scenes closed) one click opens Client list health`, closed && visible && o.health && o.back && o.copies === 1 && o.top >= -5 && o.top < 400, JSON.stringify({ closed, visible, ...o }));
  await page.click('#mk-health-back a');
  await page.waitForTimeout(1500);
  const top = await page.evaluate(() => Math.round(document.querySelector('#mk-planned').getBoundingClientRect().top));
  check(`(e) ${width}px: "← back to schedule" returns to the schedule`, top > -40 && top < 300, `Planned top ${top}px`);
}

/* ---------- run ---------- */
const startedAt = new Date().toISOString();
const before = await dbState();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const st = await open(browser, 'strategy', 1700, () => /Needs Alan \(\d+\)/.test(document.querySelector('#st-decisions')?.textContent || ''));
const needs = Number((/Needs Alan \((\d+)\)/.exec(await text(st.page, '#st-decisions')) || [])[1]);
await st.page.close();

const mk = await open(browser, 'marketing', 1700, MK_READY);
await mk.page.locator('#marketing-root').screenshot({ path: `${OUT}/abce-marketing-tab-live-1700px-${STAMP}.png` });
await mk.page.locator('#mk-results').screenshot({ path: `${OUT}/abce-results-live-1700px-${STAMP}.png` });
await mk.page.locator('#mk-waiting').screenshot({ path: `${OUT}/abce-waiting-live-1700px-${STAMP}.png` });
await mk.page.locator('#mk-schedule').screenshot({ path: `${OUT}/abce-schedule-list-live-1700px-${STAMP}.png` });
const waitN = await partA(mk.page, mk.board, 'first load');
check('(a) Needs Alan (Strategy) = Waiting on you (Marketing)', needs === waitN, `Strategy ${needs} · Marketing ${waitN}`);
await sameRecords(mk.page, mk.board);
await linkedinTile(mk.page);
await gbpTask(mk.page);
await health(mk.page, 1700);
await mk.page.close();

const again = await open(browser, 'marketing', 1700, MK_READY);
await partA(again.page, again.board, 'after reload');
await again.page.close();
for (const w of [800, 390]) {
  const n = await open(browser, 'marketing', w, () => !!document.querySelector('#mk-planned [data-mk-open-health]') && document.querySelector('#mk-schedule .mks-body'));
  await health(n.page, w);
  await n.page.close();
}
await browser.close();

const after = await dbState();
const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
const { data: runs } = await sb.from('marketing_collector_runs').select('kind, status, started_at, host').gte('started_at', startedAt).order('started_at');
check('Viewing writes nothing (dashboard tables unchanged; Refresh not pressed)', !changed.length, changed.map((k) => `${k}: ${before[k]} → ${after[k]}`).join(' | ') || 'no change');
check('PC collector runs in the window (automatic, attributed; not from viewing)', true, (runs || []).map((r) => `${r.kind} ${r.status} ${r.started_at?.slice(11, 16)} ${r.host || ''}`).join(' · ') || 'none');
check('Every non-GET from the page refused', true, `${blocked.length} refused: ${[...new Set(blocked)].join(', ')}`);
check('No page errors', !errors.length, errors.slice(0, 3).join(' | '));
fs.writeFileSync(`${OUT}/_abce-live-result.json`, JSON.stringify({ results, before, after, runs }, null, 1));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? `ALL PASS (${results.length} / ${results.length})` : `${results.filter((r) => !r.ok).length} FAILED`);

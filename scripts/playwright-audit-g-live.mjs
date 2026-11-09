/**
 * Live acceptance for QUESTION-2026-11-09-live-audit-corrections-1307.md (g), deployed files, live data, 1700px, fresh
 * loads. Read-only except ONE "Refresh status" press (POST action=status-refresh: GET-only provider checks, the queue
 * row on Alan's PC), run in the background while navigating to Strategy and back.
 *   node scripts/playwright-audit-g-live.mjs
 */
import fs from 'node:fs';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
const BASE = 'https://ai-geo-audit.vercel.app';
const OUT = 'outputs';
const STAMP = '20261109';
const LABEL = /\d+ total · \d+ decided \(keep blocked\) · \d+ new/;
const BLUR = '#mk-review-table td:first-child, #mk-query table td:first-child, #mk-cust-body, .mk-detail { filter: blur(6px) !important; }';
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note: String(note).replace(/\s+/g, ' ').slice(0, 360) });
const blocked = [];
const allowed = [];
const errors = [];
let allowRefresh = false;
const text = (page, sel) => page.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '');

const TABLES = { strategy_campaigns: 'updated_at', strategy_campaign_ticks: 'updated_at', marketing_social_placements: 'set_at', marketing_decisions: 'recorded_at', marketing_frequency_exceptions: 'set_at', strategy_initiatives: 'updated_at', strategy_content_assets: 'set_at', marketing_suppression: null };
async function dbState() {
  const out = {};
  for (const [t, c] of Object.entries(TABLES)) {
    out[`${t}.rows`] = (await sb.from(t).select('*', { count: 'exact', head: true })).count;
    if (!c) continue;
    const { data } = await sb.from(t).select(c).not(c, 'is', null).order(c, { ascending: false }).limit(1);
    out[`${t}.max`] = data?.[0]?.[c] || null;
  }
  return out;
}

async function open(browser, hash, ready) {
  const page = await browser.newPage({ viewport: { width: 1700, height: 1150 } });
  page.on('pageerror', (e) => errors.push(`${hash}: ${e.message}`));
  await page.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); for (const x of ['mks-layout', 'mks-channel', 'mks-lrange', 'mks-cycle', 'mks-view']) localStorage.removeItem(x); }, ENV.ARP_ADMIN_KEY);
  await page.route('**/api/**', (r) => {
    const req = r.request();
    if (req.method() === 'GET') return r.fallback();
    if (allowRefresh && /\/api\/aigeo\/marketing$/.test(new URL(req.url()).pathname) && /"action":"status-refresh"/.test(req.postData() || '')) { allowed.push('POST status-refresh'); return r.fallback(); }
    blocked.push(`${req.method()} ${new URL(req.url()).pathname}`);
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' });
  });
  await page.goto(`${BASE}/audit-dashboard.html#${hash}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(ready, null, { timeout: 240000 });
  await page.waitForTimeout(5000);
  await page.addStyleTag({ content: BLUR });
  return page;
}
const MK_READY = () => /^\d+$/.test(document.querySelector('#mk-waiting .mkw-n')?.textContent.trim() || '') && /LinkedIn/.test(document.querySelector('#mk-schedule .mks-body')?.textContent || '') && !document.querySelector('#mk-planned.mkw-loading') && [...document.querySelectorAll('#mk-overview-tiles .mko-tile')].some((t) => /Needs Alan/.test(t.textContent) && !/Loading/.test(t.textContent));
const ST_READY = () => /Needs Alan \(\d+\)/.test(document.querySelector('#st-decisions')?.textContent || '') && document.querySelector('#st-quarter-plan .qp-card');

/* ---------- Strategy (items 4, 5, 6) ---------- */
async function strategy(browser) {
  const page = await open(browser, 'strategy', ST_READY);
  const root = await page.$eval('section[data-panel="strategy"]', (e) => e.textContent.replace(/\s+/g, ' ')).catch(() => '');
  check('4: Strategy has no bare "Target not set" (owner + due shown instead)', !/Target not set/.test(root) && /Target: Claude proposal due Wed 11 Nov/.test(root), (root.match(/Target: \w+ proposal due [^·|]{0,20}/) || ['missing'])[0]);
  check('4: Gifts actuals "Needs review · GPT by Mon 16 Nov"', /Needs review · GPT by Mon 16 Nov/.test(root), (root.match(/Needs review · [^|·]{0,30}/) || ['missing'])[0]);
  const home = await page.$$eval('section[data-panel="strategy"] a[href]', (as) => as.map((a) => a.href).filter((h) => /^https?:\/\/(www\.)?alanranger\.com\/?(#.*)?$/.test(h)));
  check('5: no Strategy link goes to the alanranger.com homepage (plan link removed)', !home.length, home.join(', ') || 'none');
  const dec = await text(page, '#st-decisions');
  check('6: Strategy Needs Alan shows the 3 / 2 / 1 label', LABEL.test(dec), (dec.match(/Review \d+ new blocked[^R]*/) || [dec.slice(0, 160)])[0]);
  const ac = (root.match(/90-day trial cohort[^|]{0,260}/) || [''])[0];
  const via = /Academy Supabase \(read-only\)/.test(ac) ? 'live academy_trial_history (Academy Supabase, read-only)' : (/copy stored by the last customer rebuild/.test(ac) ? 'stored copy (last customer rebuild)' : 'not shown');
  check('4: Q2 Academy cohort from academy_trial_history', /academy_trial_history/.test(ac), `${via} · ${ac.slice(0, 200)}`);
  await page.locator('#st-decisions').screenshot({ path: `${OUT}/g-live-strategy-needs-1700px-${STAMP}.png` });
  await page.locator('#st-quarter-plan').screenshot({ path: `${OUT}/g-live-strategy-quarter-plan-1700px-${STAMP}.png` });
  await page.close();
  return via;
}

/* ---------- Marketing (items 1, 2, 3, 6) ---------- */
async function marketing(page) {
  const list = await text(page, '#mk-schedule .mkl');
  const gift = (list.match(/A photography gift[^]{0,220}/) || [''])[0];
  await page.click('#mk-schedule [data-mks-channel="email"]');
  await page.waitForTimeout(1200);
  const ev = await text(page, '#mk-schedule .mkl-email');
  const giftEv = (ev.match(/A photography gift[^]{0,260}/) || [''])[0];
  const nList = (gift.match(/(\d[\d,]*) (people|recipients|sends)/) || [])[1];
  check('1: Gifts row shows the same provider count in the schedule and the billing view (365 + 1 = 366)', /366/.test(gift) && /366/.test(giftEv) && /365 people \+ 1 business copy = 366 sends/.test(`${gift} ${giftEv}`), `schedule: ${gift.slice(0, 140)} || billing: ${giftEv.slice(0, 180)} (${nList})`);
  check('1: "since frozen" line shown for later exclusions', /since frozen/i.test(`${gift} ${giftEv}`), (`${gift} ${giftEv}`.match(/[^.·]*since frozen[^.·]*/i) || ['(no later exclusions recorded)'])[0]);
  await page.locator('#mk-schedule').screenshot({ path: `${OUT}/g-live-gifts-billing-1700px-${STAMP}.png` });
  await page.click('#mk-schedule [data-mkl-cycle="next"]').catch(() => {});
  await page.waitForTimeout(1200);
  const promo = await text(page, '#mk-schedule .mkl-promos');
  check('2: Light & Logic promotion linked to the 19 Nov / 17 Dec drafts (next cycle, budgeted once)', /Nov edition \(15 Nov\) → module in the 19 Nov email \(draft\)/.test(promo) && /Dec edition \(15 Dec\) → module in the 17 Dec email \(draft\)/.test(promo) && !/none recorded/.test(promo), promo.slice(0, 260));
  await page.locator('#mk-schedule').screenshot({ path: `${OUT}/g-live-ll-promotion-1700px-${STAMP}.png` });
  await page.click('#mk-schedule [data-mks-channel="all"]');
  await page.waitForTimeout(800);
  const wait = await page.$$eval('#mk-waiting tbody tr', (rows) => rows.map((r) => r.innerText.replace(/\s+/g, ' ')));
  const checks = await text(page, '#mkw-planned-extra');
  check('3: the "109 people get 3 emails" warning is gone (0 uncovered in the next 7 days); nothing re-asked', !wait.some((r) => /emails in 7 days/.test(r)) && !/get 3 emails in 7 days/.test(checks), `Waiting: ${wait.join(' || ') || '(empty)'} · Schedule checks: ${checks || 'none'}`);
  const tiles = await page.$eval('#mk-overview-tiles', (e) => e.textContent.replace(/\s+/g, ' '));
  check('6: 3 / 2 / 1 label in Waiting, the health tile and the Needs Alan tile; the 2 decided never reopened', wait.some((r) => /Review 1 new blocked contact/.test(r) && LABEL.test(r)) && (tiles.match(new RegExp(LABEL.source, 'g')) || []).length >= 2, `${wait.find((r) => /blocked/.test(r)) || 'no blocked row'} · tiles ${(tiles.match(new RegExp(LABEL.source, 'g')) || []).length}×`);
  await page.locator('#mk-overview-tiles').screenshot({ path: `${OUT}/g-live-tiles-1700px-${STAMP}.png` });
  await page.locator('#mk-waiting').screenshot({ path: `${OUT}/g-live-waiting-1700px-${STAMP}.png` });
}

/* ---------- item 7: Refresh in the background ---------- */
async function refresh(page) {
  allowRefresh = true;
  const before = await text(page, '#mk-schedule .mks-refresh');
  await page.click('#mk-schedule [data-mks-refresh]');
  await page.waitForSelector('#mk-modal [data-mk-bg-refresh]', { timeout: 30000 });
  await page.click('#mk-modal [data-mk-bg-refresh]');
  await page.waitForTimeout(1500);
  const bg = await page.evaluate(() => ({ modal: !!document.getElementById('mk-modal'), pill: document.getElementById('mk-refresh-pill')?.innerText || '' }));
  check('7: "Run in background" closes the modal and leaves a progress pill', !bg.modal && /Refreshing status/.test(bg.pill), JSON.stringify(bg));
  await page.screenshot({ path: `${OUT}/g-live-refresh-pill-1700px-${STAMP}.png` });
  await page.evaluate(() => { location.hash = 'strategy'; });
  await page.waitForFunction(() => document.querySelector('section[data-panel="strategy"]')?.checkVisibility() || /Needs Alan/.test(document.body.innerText), null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const navOk = await page.evaluate(() => !!document.getElementById('mk-refresh-pill') && !document.getElementById('mk-modal'));
  await page.evaluate(() => { location.hash = 'marketing'; });
  await page.waitForTimeout(3000);
  check('7: navigation works while it runs (Strategy and back); the pill stays', navOk, `pill on Strategy: ${navOk}`);
  await page.waitForFunction(() => /complete|partial|failed/i.test(document.getElementById('mk-refresh-pill')?.innerText || ''), null, { timeout: 900000 }).catch(() => {});
  const pill = await page.evaluate(() => document.getElementById('mk-refresh-pill')?.innerText || '');
  await page.waitForTimeout(2000);
  const after = await text(page, '#mk-schedule .mks-refresh');
  check('7: final result recorded as Complete or Partial ("Last checked … · complete / partial: …")', /Last checked .*· (complete|partial)/i.test(`${pill} ${after}`), `pill "${pill}" · line "${after.slice(0, 160)}" (before: "${before.slice(0, 100)}")`);
  await page.screenshot({ path: `${OUT}/g-live-refresh-done-1700px-${STAMP}.png` });
}

const startedAt = new Date().toISOString();
const before = await dbState();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const via = await strategy(browser);
const page = await open(browser, 'marketing', MK_READY);
await page.locator('#marketing-root').screenshot({ path: `${OUT}/g-live-marketing-tab-1700px-${STAMP}.png` });
await marketing(page);
const mid = await dbState();
const changed = Object.keys(before).filter((k) => before[k] !== mid[k]);
check('Viewing writes nothing (before the one Refresh press)', !changed.length, changed.map((k) => `${k}: ${before[k]} → ${mid[k]}`).join(' | ') || 'no change');
await refresh(page);
await page.close();
await browser.close();
const after = await dbState();
const changed2 = Object.keys(mid).filter((k) => mid[k] !== after[k]);
const { data: runs } = await sb.from('marketing_collector_runs').select('kind, status, started_at, host').gte('started_at', startedAt).order('started_at');
check('Refresh changed no dashboard records (only the provider-check queue / run rows)', !changed2.length, changed2.map((k) => `${k}: ${mid[k]} → ${after[k]}`).join(' | ') || 'no change');
check('PC collector / check runs in the window (attributed)', true, (runs || []).map((r) => `${r.kind} ${r.status} ${String(r.started_at).slice(11, 16)} ${r.host || ''}`).join(' · ') || 'none');
check('Non-GETs: only the one status-refresh POST allowed', allowed.length === 1, `${allowed.join(', ')} · ${blocked.length} refused`);
check('No page errors', !errors.length, errors.slice(0, 3).join(' | '));
fs.writeFileSync(`${OUT}/_audit-g-live-result.json`, JSON.stringify({ results, via, before, mid, after, runs }, null, 1));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(`Academy cohort source: ${via}`);
console.log(results.every((r) => r.ok) ? `ALL PASS (${results.length} / ${results.length})` : `${results.filter((r) => !r.ok).length} FAILED`);

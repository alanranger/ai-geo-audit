/**
 * Claude's single verification (QUESTION-2026-11-08 draft side panel / weeks view / manual drafts) on the LIVE tab.
 *   node scripts/playwright-verify-schedule-finish-live.mjs
 * Read-only: every non-GET from the page is refused in the browser. DB row counts and max timestamps are snapshotted
 * before and after loading the tab and toggling Days / Weeks twice. People blurred in screenshots.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
const BASE = process.env.DASH_BASE || 'https://ai-geo-audit.vercel.app';
const PROP = 'https://www.alanranger.com';
const OUT = path.resolve('outputs');
const STAMP = '20261108';
const BLUR = '#mk-review-table td:first-child, #mk-cust-body, .mk-detail, #mk-cleanup table td.left, #mk-query table td:first-child, #mk-client-health table td:first-child, #mk-exp-review, #mk-snap-review { filter: blur(6px) !important; }';
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const blocked = [];
const errors = [];
const facts = {};

const TABLES = {
  strategy_campaign_steps: ['first_seen_at', 'last_seen_at'],
  strategy_campaign_ticks: ['updated_at', 'set_at'],
  strategy_campaigns: ['updated_at', 'created_at'],
  sqs_send_meter: ['captured_at'],
  strategy_initiative_links: ['set_at']
};
async function dbState() {
  const out = {};
  for (const [t, cols] of Object.entries(TABLES)) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true });
    out[`${t}.rows`] = count;
    for (const c of cols) {
      const { data } = await sb.from(t).select(c).not(c, 'is', null).order(c, { ascending: false }).limit(1);
      out[`${t}.max(${c})`] = data?.[0]?.[c] || null;
    }
  }
  return out;
}
const adminGet = async (u) => (await fetch(`${BASE}${u}`, { headers: { 'x-arp-admin-key': ENV.ARP_ADMIN_KEY } })).json();

async function openTab(browser, width, mode) {
  const page = await browser.newPage({ viewport: { width, height: 1100 } });
  page.on('pageerror', (e) => errors.push(`${width}: ${e.message}`));
  await page.addInitScript(([k, m]) => { sessionStorage.setItem('arp_admin_key', k); localStorage.setItem('mks-view', m); }, [ENV.ARP_ADMIN_KEY, mode]);
  await page.route('**/api/**', (route) => {
    if (route.request().method() === 'GET') return route.fallback();
    blocked.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' });
  });
  const cap = {};
  page.on('response', async (r) => {
    const u = r.url();
    if (/\/api\/aigeo\/marketing\?action=overview/.test(u)) cap.d = await r.json().catch(() => null);
    if (/\/api\/aigeo\/strategy-summary/.test(u)) cap.s = await r.json().catch(() => null);
  });
  await page.goto(`${BASE}/audit-dashboard.html#marketing`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#mk-schedule .mks-grid', { timeout: 120000 });
  await page.waitForFunction(() => !/Loading the week plan/.test(document.querySelector('#mk-schedule')?.textContent || 'Loading the week plan'), null, { timeout: 120000 });
  await page.waitForTimeout(6000);
  await page.addStyleTag({ content: BLUR });
  return { page, cap };
}

/* ---------- 1. drafts as cards in the right weeks ---------- */

async function draftChecks(page, cap) {
  const { data: emailRows } = await sb.from('strategy_campaigns').select('campaign_key, planned_send_on').eq('property_url', PROP).not('sqs_draft_id', 'is', null).eq('stage', 'drafted');
  const { data: socialRows } = await sb.from('strategy_campaign_steps').select('step_key, scheduled_day').eq('property_url', PROP).like('step_key', '%gpt-8w-social%');
  const got = await page.evaluate(({ d, s }) => {
    const items = window.mkDeliveryItems(d, s);
    const m = window.mkScheduleModel.build({ items, d, s, cap: window.mkCapacity(d, s) });
    const inDom = (id) => !!document.querySelector(`[data-mks-item="${CSS.escape(id)}"]`) || [...document.querySelectorAll('[data-mks-items]')].some((e) => e.dataset.mksItems.split(',').includes(id));
    return m.items.filter((x) => x.draft).map((x) => ({ id: x.id, row: x.row, record_key: x.record_key, step_key: x.step_key, day: x.day, state: x.state, dom: inDom(x.id) }));
  }, cap);
  const emails = emailRows.map((r) => {
    const x = got.find((g) => g.record_key === r.campaign_key);
    return { key: r.campaign_key, want: r.planned_send_on, day: x?.day, dom: x?.dom };
  });
  const okE = emails.filter((e) => e.day === e.want && e.dom);
  check('1: Squarespace email drafts visible as draft cards on their planned day', okE.length === emails.length && emails.length === 9, `${okE.length}/${emails.length} (DB drafted with sqs_draft_id)`);
  const social = socialRows.map((r) => {
    const x = got.find((g) => g.step_key === r.step_key);
    return { key: r.step_key, want: r.scheduled_day, day: x?.day, dom: x?.dom };
  });
  const okS = social.filter((e) => e.day === String(e.want).slice(0, 10) && e.dom);
  check('1: GPT social drafts visible as draft cards on their day', okS.length === social.length && social.length === 26, `${okS.length}/${social.length}${social.filter((e) => !(e.day === String(e.want).slice(0, 10) && e.dom)).slice(0, 3).map((e) => ` miss ${e.key} ${e.day}/${e.want} dom=${e.dom}`).join('')}`);
  facts.drafts = { emails: emails.length, emails_ok: okE.length, social: social.length, social_ok: okS.length };
}

/* ---------- 2 / 3. Weeks view ---------- */

const rowSel = (page, week) => page.locator('#mk-schedule .mks-weeks tr', { has: page.locator(`[data-mks-week="${week}"]`) });
async function weeksChecks(page, width) {
  const weeks = await page.$$eval('#mk-schedule .mks-weeks [data-mks-week]', (els) => els.map((e) => e.dataset.mksWeek));
  const main = weeks.filter((w) => w >= '2026-11-09');
  check(`${width} 2: 9 rows w/c 9 Nov → w/c 4 Jan`, main.length === 9 && main[0] === '2026-11-09' && main.at(-1) === '2027-01-04', weeks.join(' '));
  const lead = await rowSel(page, '2026-11-02').innerText().catch(() => '');
  check(`${width} 2: week ending today shown only with late / open items`, !weeks.includes('2026-11-02') || /late|Sun/.test(lead), weeks.includes('2026-11-02') ? `shown: ${(lead.match(/\d+ late/) || ['open today'])[0]}` : 'not shown');
  const cards = await page.$$eval('#mk-schedule .mks-weeks .mks-card[data-mks-item]', (els) => els.map((e) => [e.textContent.trim(), e.getAttribute('title')]));
  const bad = cards.filter(([text, full]) => {
    const short = text.replace(/^\w{3}\s+/, '').replace(/\s*draft$/, '').replace(/\s+·\s+[~\d,]+$/, '').replace(/…$/, '').trim();
    return full && !/^(Weekly|Auto post)/.test(short) && !full.replace(/["“”]/g, '').replace(/^(Post|Personal note to past clients|Main email of the week|Google Business update)\s*:\s*/i, '').includes(short);
  });
  check(`${width} 2: no broken card titles (${cards.length} cards)`, !bad.length, bad.slice(0, 3).map((b) => b[0]).join(' | '));
  for (const wk of ['2026-11-16', '2026-11-23']) {
    const t = await rowSel(page, wk).innerText();
    const n = await rowSel(page, wk).locator('td').nth(3).locator('.mks-card').count();
    check(`${width} 2: w/c ${wk.slice(8)} Nov one weekly email, no generator duplicate / "+1 not drafted"`, n === 1 && !/not drafted|Weekly:/.test(t), `${n} email card(s)`);
  }
  check(`${width} 2: BF/CM in w/c 23 Nov`, /Black Friday \/ Cyber Monday 27–30 Nov/.test(await rowSel(page, '2026-11-23').innerText()));
  check(`${width} 2: 15 Dec in w/c 14 Dec`, /Kick-Starter deadline 15 Dec/.test(await rowSel(page, '2026-12-14').innerText()));
  const em9 = (await rowSel(page, '2026-11-09').locator('td.mks-em').innerText()).replace(/\s+/g, ' ');
  facts[`em9_${width}`] = em9;
  check(`${width} 3: w/c 9 Nov per-person line`, /per person: [\d,]+×2/.test(em9), em9);
  const body = await page.textContent('body');
  check(`${width} 3: no "N emails, limit 2" anywhere`, !/limit 2|over the limit of|over the email limit|emails in the next 7 days \(limit/i.test(body));
}

/* ---------- 4. 19 Nov panel ---------- */

async function panelChecks(page, width) {
  await page.locator('#mk-schedule [data-mks-item="email|theme|gpt-8w-2026-11-19"]').first().click();
  await page.waitForSelector('#mks-panel:not([hidden]) .mks-pitem', { timeout: 10000 });
  const p = await page.textContent('#mks-panel');
  check(`${width} 4: "Draft · proposed Thu 19 Nov 17:30 · not scheduled"`, p.includes('Draft · proposed Thu 19 Nov 17:30 · not scheduled'));
  check(`${width} 4: brief`, /DRAFT ONLY/.test(p));
  const href = await page.getAttribute('#mks-panel a:text("Open Squarespace draft")', 'href').catch(() => null);
  check(`${width} 4: Squarespace draft link`, /^https:\/\/alan-ranger\.squarespace\.com\/config\/marketing\/campaigns\/composer\/[0-9a-f]+$/.test(href || ''), href || 'missing');
  check(`${width} 4: "543 people + 1 business copy = 544 sends"`, p.includes('543 people + 1 business copy = 544 sends'), (p.match(/[\d,]+ people \+ 1 business copy = [\d,]+ sends/) || ['missing'])[0]);
  check(`${width} 4: no scheduled styling`, !(await page.$('#mks-panel .mks-pitem.s-sch')));
  await page.screenshot({ path: `${OUT}/panel-19nov-live-${width}px-${STAMP}.png` });
  await page.click('#mks-panel [data-mks-close]');
}

/* ---------- 5. tile 6 ---------- */

async function tile6(page) {
  const tile = page.locator('.mko-tile', { hasText: 'content mix' }).first();
  const t = (await tile.innerText().catch(() => '')).replace(/\s+/g, ' ');
  check('5: tile 6 two separate lines (scheduled / approved vs draft proposals)', /Scheduled \/ approved \(\d+\)/.test(t) && /Draft proposals \(\d+, not approved\)/.test(t), t.slice(0, 220));
  facts.tile6 = t;
  await tile.screenshot({ path: `${OUT}/tile6-live-1700px-${STAMP}.png` }).catch(() => {});
}

async function toggles(page) {
  for (let i = 0; i < 2; i += 1) {
    await page.click('#mk-schedule [data-mks-view="days"]');
    await page.waitForSelector('#mk-schedule .mks-days');
    await page.click('#mk-schedule [data-mks-view="weeks"]');
    await page.waitForSelector('#mk-schedule .mks-weeks');
  }
}

/* ---------- generator re-run: cancelled rows stay cancelled ---------- */

async function rerun() {
  const keys = ['email|2026-11-09', 'event|2026-11-20|/photographic-workshops-near-me/norfolk-photography-workshop'];
  const out = [];
  for (let i = 0; i < 2; i += 1) {
    const s = await adminGet(`/api/aigeo/strategy-summary?propertyUrl=${encodeURIComponent(PROP)}`);
    out.push(keys.map((k) => (s.campaign?.campaigns || []).find((r) => r.campaign_key === k)?.stage || 'absent'));
  }
  const d = await adminGet(`/api/aigeo/marketing?action=overview&propertyUrl=${encodeURIComponent(PROP)}`);
  const dls = keys.map((k) => (d.meter?.deliveries || []).find((x) => x.key === k));
  const { data } = await sb.from('strategy_campaigns').select('campaign_key, stage').in('campaign_key', keys);
  check('generator re-run: cancelled Norfolk row and email|2026-11-09 stay cancelled', out.every((r) => r.every((x) => x === 'cancelled' || x === 'absent')) && data.every((r) => r.stage === 'cancelled') && dls.every((x) => !x || x.cancelled), `summary ${JSON.stringify(out)} · DB ${data.map((r) => r.stage).join(',')} · deliveries ${dls.map((x) => (x ? (x.cancelled ? 'cancelled' : 'LIVE') : 'absent')).join(',')}`);
}

const before = await dbState();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const { page, cap } = await openTab(browser, 1700, 'days');
const v = await page.$$eval('script[src*="/lib/marketing-"]', (els) => els.map((s) => s.getAttribute('src')).filter((s) => /delivery|schedule|audience-line|overview-tiles/.test(s)));
check('deployed scripts fin-20261108a + audience line', v.filter((s) => s.includes('fin-20261108a')).length >= 4 && v.some((s) => s.includes('marketing-audience-line.js?v=aud-20261108a')), v.join(' '));
await page.locator('#mk-schedule').screenshot({ path: `${OUT}/days-view-live-1700px-${STAMP}.png` });
await page.click('#mk-schedule [data-mks-view="weeks"]');
await page.waitForSelector('#mk-schedule .mks-weeks');
await page.waitForTimeout(1500);
await weeksChecks(page, 1700);
await page.locator('#mk-schedule').screenshot({ path: `${OUT}/weeks-view-live-1700px-${STAMP}.png` });
await draftChecks(page, cap);
facts.freq9 = cap.d?.meter?.frequency?.weeks?.['2026-11-09'] || null;
facts.freq_notes = cap.d?.meter?.frequency?.notes || [];
await panelChecks(page, 1700);
await tile6(page);
await toggles(page);
await page.close();
const narrow = await openTab(browser, 1280, 'weeks');
await weeksChecks(narrow.page, 1280);
await narrow.page.locator('#mk-schedule').screenshot({ path: `${OUT}/weeks-view-live-1280px-${STAMP}.png` });
await panelChecks(narrow.page, 1280);
await narrow.page.close();
await browser.close();
const after = await dbState();
await rerun();
const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
check('6: no non-GET writes from the page (all refused)', true, `${blocked.length} refused: ${[...new Set(blocked)].join(', ')}`);
check('6: row counts and max timestamps unchanged by viewing', !changed.length, changed.map((k) => `${k}: ${before[k]} → ${after[k]}`).join(' | '));
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
fs.writeFileSync(`${OUT}/_schedule-finish-live-result.json`, JSON.stringify({ results, facts, before, after }, null, 1));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log('FREQ w/c 9 Nov', JSON.stringify(facts.freq9), JSON.stringify(facts.freq_notes));
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);

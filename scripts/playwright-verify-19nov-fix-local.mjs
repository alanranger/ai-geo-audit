/**
 * QUESTION-2026-11-10 19nov-card-light-logic-label-and-gone-vs-scheduled, LOCAL code on LIVE data, 1700px, read-only.
 *  - before: production as served;
 *  - after: production with the changed browser files served from this folder and GET ?action=overview,
 *    ?action=delivery-status and /api/aigeo/marketing-schedule-extras answered in-process by this repo (live Supabase);
 *  - simulated-1723: the same, with the 19 Nov schedule row shown as Squarespace had it 17:23–17:53 (state gone,
 *    gone_at 17:23:48) in memory only, to show the red "Not in Squarespace Scheduled — check" rule. Nothing is written.
 * Every non-GET request is refused (403). Screenshots show campaign titles only.
 *   node scripts/playwright-verify-19nov-fix-local.mjs        (PHASE=live: production after deploy, no simulation)
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
Object.assign(process.env, ENV);
const BASE = 'https://ai-geo-audit.vercel.app';
const LIVE = process.env.PHASE === 'live';
const TAG = LIVE ? 'live' : 'local';
const V = 'gone-20261110a';
const COMMIT = '75a403f2';
const KEY = 'theme|gpt-8w-2026-11-19';
const ID = '6af0811d60d4554034f4b5bb';
const FILES = ['/lib/marketing-sqs-cycles.js', '/lib/marketing-overview-tiles.js', '/lib/marketing-schedule-list.js', '/lib/marketing-schedule-model.js', '/lib/marketing-delivery.js'];
const TABLES = { strategy_campaigns: 'updated_at', sqs_scheduled_emails: 'collected_at', strategy_content_assets: 'set_at', marketing_segment_exports: 'created_at' };
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const refused = [];
const errors = [];

async function dbState() {
  const out = {};
  for (const [t, c] of Object.entries(TABLES)) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true });
    const { data } = await sb.from(t).select(c).not(c, 'is', null).order(c, { ascending: false }).limit(1);
    Object.assign(out, { [`${t}.rows`]: count ?? 'n/a', [`${t}.max`]: data?.[0]?.[c] || null });
  }
  return out;
}

/* ---------- in-process API answers (read-only) ---------- */

const { overview } = await import('../lib/marketing/overview.mjs');
const { buildStatusBoard } = await import('../lib/marketing/delivery-status-board.mjs');
const { default: extras } = await import('../api/aigeo/marketing-schedule-extras.js');
/** The 19 Nov schedule row as the collector held it 17:23–17:53, in memory: every other row and table unchanged. */
const goneRow = (r) => (r.email_id === ID ? { ...r, state: 'gone', gone_at: '2026-11-10T17:23:48.928Z' } : r);
function wrap(q) {
  return new Proxy(q, {
    get(t, k) {
      if (k === 'then') return (ok, bad) => t.then((r) => ok({ ...r, data: Array.isArray(r.data) ? r.data.map(goneRow) : r.data }), bad);
      const v = t[k];
      return typeof v === 'function' ? (...a) => wrap(v.apply(t, a)) : v;
    }
  });
}
const simSb = new Proxy(sb, { get: (t, k) => (k === 'from' ? (table) => (table === 'sqs_scheduled_emails' ? wrap(t.from(table)) : t.from(table)) : (typeof t[k] === 'function' ? t[k].bind(t) : t[k])) });
const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
async function localMarketing(url, sim) {
  const client = sim ? simSb : sb;
  if (url.searchParams.get('action') === 'overview') return json({ ok: true, ...(await overview(client, {})) });
  if (url.searchParams.get('action') === 'delivery-status') return json({ ok: true, ...(await buildStatusBoard(client)) });
  return null;
}
async function localExtras(url) {
  let out = null;
  const res = { setHeader() {}, status(c) { this.c = c; return this; }, json(j) { out = j; return this; } };
  await extras({ method: 'GET', query: Object.fromEntries(url.searchParams), headers: { 'x-arp-admin-key': ENV.ARP_ADMIN_KEY } }, res);
  return json(out);
}

function makeRoute(mode) {
  return async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    if (req.method() !== 'GET') { refused.push(`${req.method()} ${url.pathname}`); return r.fulfill({ status: 403, contentType: 'application/json', body: '{"ok":false,"error":"refused by the read-only check"}' }); }
    if (mode === 'before' || LIVE) return r.fallback();
    if (FILES.includes(url.pathname)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`.${url.pathname}`, 'utf8') });
    if (url.pathname === '/api/aigeo/marketing') { const a = await localMarketing(url, mode === 'simulated'); if (a) return r.fulfill(a); }
    if (url.pathname === '/api/aigeo/marketing-schedule-extras') return r.fulfill(await localExtras(url));
    return r.fallback();
  };
}

async function render(browser, mode) {
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1200 } });
  await ctx.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); localStorage.setItem('mks-layout', 'list'); localStorage.setItem('mks-lrange', '9'); localStorage.setItem('mks-channel', 'all'); }, ENV.ARP_ADMIN_KEY);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${mode}: ${e.message}`));
  await ctx.route('**/*', makeRoute(mode));
  await page.goto(`${BASE}/audit-dashboard.html#marketing`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#mk-sqs-cycles') && document.querySelector('#mk-overview-tiles .mko-mix'), null, { timeout: 240000 });
  await page.waitForSelector(`[data-mkl-item="email|${KEY}"]`, { timeout: 120000 });
  await page.waitForTimeout(5000);
  await page.addStyleTag({ content: '#debugPanel { display: none !important; }' });
  return { ctx, page };
}

function snap(key) {
  const txt = (el) => (el?.innerText || '').replace(/\s+/g, ' ').trim();
  const card = document.querySelector(`[data-mkl-item="email|${key}"]`);
  const cyc = document.getElementById('mk-sqs-cycles');
  const cap = [...document.querySelectorAll('#mk-overview-tiles .mko-tile')].find((t) => /Email capacity/.test(t.querySelector('.mko-title')?.textContent || ''));
  const rows = [...(cyc?.querySelectorAll('[data-mkc-col]') || [])].map((c) => [...c.querySelectorAll('.mkc-e')].map((r) => ({ key: r.dataset.mkcOpen, tag: r.dataset.mkcTag, date: r.querySelector('.mkc-dt')?.textContent, n: r.querySelector('.mkc-n')?.textContent, alert: r.querySelector('.mkc-al')?.textContent || null })));
  const emailCards = [...document.querySelectorAll('[data-mkl-item^="email|"]')].map((el) => ({ id: el.dataset.mklItem, text: txt(el).slice(0, 220) }));
  return {
    card: txt(card), card_html: card?.outerHTML.length || 0, cycles_rag: cyc?.className, cycles: rows,
    cap_rag: cap?.className, cap: txt(cap), email_cards: emailCards,
    mix: txt([...document.querySelectorAll('#mk-overview-tiles .mko-tile')].find((t) => /content mix/.test(t.textContent))).slice(0, 120)
  };
}
async function shots(page, mode) {
  const at = `${mode}-${TAG}-1700px-20261110`;
  await page.locator('#mk-overview-tiles .mko-grid').screenshot({ path: `outputs/19nov-fix-tiles-${at}.png` });
  const card = page.locator(`[data-mkl-item="email|${KEY}"]`).first();
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: `outputs/19nov-fix-card-${at}.png` });
}

const ROW = (s, col, key) => s.cycles[col]?.find((r) => r.key === key);
function checks(b, a, sim) {
  check(`before: the 19 Nov card shows the stale label ("${(/Light & Logic[^·]*·[^·]*/.exec(b.card) || ['none'])[0].trim()}")`, /Light & Logic/.test(b.card));
  check('after: the 19 Nov card shows no Light & Logic label (module recorded 9 Nov, email edited in Squarespace 10 Nov 17:05, edition on hold)', !/Light & Logic/.test(a.card), a.card.slice(0, 200));
  const dec = a.email_cards.find((c) => c.id === 'email|theme|gpt-8w-2026-12-17');
  check(`17 Dec card: module still recorded and not edited since (label kept: "${dec ? (/Light & Logic[^·]*·[^·]*/.exec(dec.text) || ['none'])[0].trim() : 'card not in range'}") → for GPT to confirm`, true);
  const b19 = ROW(b, 1, KEY);
  const a19 = ROW(a, 1, KEY);
  check(`before: the 19 Nov email is missing from the billing-cycle tile (treated as sent: "linked, not collected yet") → ${b19 ? `${b19.tag} ${b19.n}` : 'absent'}`, !b19);
  check(`after: the 19 Nov email is SCHED 561 in Next cycle (${a19 ? `${a19.date} ${a19.tag} ${a19.n}` : 'absent'})`, a19 && a19.tag === 'SCHED' && a19.n === '561' && a19.date === '19 Nov' && !a19.alert);
  const eleven = a.cycles[0].filter((r) => /12nov/.test(r.key));
  check(`the four 11 Nov emails are dated 11 Nov in the billing-cycle tile (${eleven.map((r) => `${r.date} ${r.n}`).join(' · ')}); the "12 Nov 12:51" heading is the cycle reset`, eleven.length === 4 && eleven.every((r) => r.date === '11 Nov'));
  const cards11 = a.email_cards.filter((c) => /12nov/.test(c.id));
  check(`schedule cards: 11 Nov at 7:30pm–8:00pm (${cards11.length} cards)`, cards11.length === 4 && cards11.every((c) => /7:30pm|7:45pm|8:00pm/.test(c.text)), cards11.map((c) => c.text.slice(0, 90)).join(' | '));
  const noSeg = ['theme|gpt-8w-academy-2026-12-01', 'theme|gpt-8w-pnm-2026-12-14'].map((k) => ROW(a, 1, k) || ROW(a, 2, k));
  check(`drafts with no segment flagged "audience not chosen" (${noSeg.map((r) => (r ? `${r.date} ${r.n} ${r.alert}` : 'absent')).join(' · ')})`, noSeg.every((r) => r?.alert === 'audience not chosen'));
  check(`capacity tile next cycle (after): "${(/Next cycle[^]*$/.exec(a.cap) || [''])[0].slice(0, 140)}"`, /Next cycle/.test(a.cap));
  if (!sim) return;
  const s19 = ROW(sim, 1, KEY);
  check(`simulated 17:23: billing-cycle row = DRAFT ${s19?.n} + red "${s19?.alert}", tile red`, s19 && s19.tag === 'DRAFT' && /Not in Squarespace Scheduled — check/.test(s19.alert || '') && /r-red/.test(sim.cycles_rag));
  check('simulated 17:23: capacity tile red with the "Not in Squarespace Scheduled — check" line', /r-red/.test(sim.cap_rag) && /Not in Squarespace Scheduled — check/.test(sim.cap), (/Not in Squarespace Scheduled — check[^]*?reserved/.exec(sim.cap) || [''])[0]);
  check(`simulated 17:23: the card reads "Not in Squarespace Scheduled — check" (${sim.card.slice(0, 160)})`, /Not in Squarespace Scheduled — check/.test(sim.card));
}

const before = await dbState();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const out = {};
for (const mode of LIVE ? ['after'] : ['before', 'after', 'simulated']) {
  const r = await render(browser, mode);
  if (LIVE) {
    const tags = await r.page.evaluate((files) => files.map((f) => document.querySelector(`script[src^="${f}"]`)?.getAttribute('src')), FILES);
    check(`production serves the ?v=${V} tags`, tags.every((s) => String(s).endsWith(`?v=${V}`)), tags.join(' '));
    const clean = (t) => t.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    const served = await r.page.evaluate(async (list) => Promise.all(list.map(async (s) => (await fetch(s, { cache: 'no-store' })).text())), tags);
    const same = tags.map((s, i) => clean(served[i]) === clean(execSync(`git show ${COMMIT}:${s.split('?')[0].slice(1)}`, { encoding: 'utf8' })));
    check(`the five served files are identical to ${COMMIT}`, same.every(Boolean), tags.map((s, i) => `${s.split('?')[0]} ${same[i] ? 'same' : 'DIFFERS'}`).join(' · '));
    const api = await r.page.evaluate(async (k) => {
      const h = { 'x-arp-admin-key': k };
      const d = await (await fetch('/api/aigeo/marketing?action=overview', { headers: h })).json();
      const x = await (await fetch('/api/aigeo/marketing-schedule-extras?propertyUrl=https%3A%2F%2Fwww.alanranger.com', { headers: h })).json();
      const dl = (d.meter?.deliveries || []).find((y) => y.key === 'theme|gpt-8w-2026-11-19');
      return { has_field: Array.isArray(d.meter?.capacity?.not_in_scheduled), gone: d.meter?.capacity?.not_in_scheduled?.length, dl: dl && { bucket: dl.bucket, sent: !!dl.sent, status: dl.status?.code }, promos: (x.promotions || []).map((p) => `${p.campaign_key} confirmed=${p.confirmed}`) };
    }, ENV.ARP_ADMIN_KEY);
    check(`production server code: 19 Nov ${JSON.stringify(api.dl)}; capacity.not_in_scheduled = ${api.gone}; modules ${api.promos.join(' · ')}`, api.has_field && api.dl?.bucket === 'committed' && !api.dl.sent && api.dl.status === 'scheduled' && api.promos.some((p) => /2026-11-19 confirmed=false/.test(p)));
  }
  out[mode] = await r.page.evaluate(snap, KEY);
  await shots(r.page, mode === 'simulated' ? 'simulated-1723' : mode);
  await r.ctx.close();
}
await browser.close();
if (LIVE) {
  const a = out.after;
  check(`live: 19 Nov card without the Light & Logic label (${a.card.slice(0, 120)})`, !/Light & Logic/.test(a.card));
  const a19 = ROW(a, 1, KEY);
  check(`live: 19 Nov in Next cycle as SCHED 561 (${a19 ? `${a19.date} ${a19.tag} ${a19.n}` : 'absent'})`, a19?.tag === 'SCHED' && a19.n === '561' && !a19.alert);
  const eleven = a.cycles[0].filter((r) => /12nov/.test(r.key));
  check(`live: the four 11 Nov emails dated 11 Nov (${eleven.map((r) => `${r.date} ${r.n}`).join(' · ')})`, eleven.length === 4 && eleven.every((r) => r.date === '11 Nov'));
  const noSeg = ['theme|gpt-8w-academy-2026-12-01', 'theme|gpt-8w-pnm-2026-12-14'].map((k) => ROW(a, 1, k) || ROW(a, 2, k));
  check(`live: drafts with no segment flagged (${noSeg.map((r) => (r ? `${r.date} ${r.n} ${r.alert}` : 'absent')).join(' · ')})`, noSeg.every((r) => r?.alert === 'audience not chosen'));
  check(`live: no "Not in Squarespace Scheduled" warning today (all scheduled emails listed) · capacity "${(/Next cycle[^]*?reserved\)/.exec(a.cap) || [''])[0]}"`, !/Not in Squarespace Scheduled/.test(a.cap) && !/r-red/.test(a.cap_rag) && !/r-red/.test(a.cycles_rag));
} else checks(out.before, out.after, out.simulated);
const after = await dbState();
const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
check('viewing writes nothing (row counts + newest timestamps)', !changed.length, changed.map((k) => `${k}: ${before[k]} → ${after[k]}`).join(' | ') || `${Object.keys(TABLES).length} tables unchanged`);
check('every non-GET refused', true, `${refused.length} refused: ${[...new Set(refused)].join(', ') || 'none attempted'}`);
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
fs.writeFileSync(`outputs/_19nov-fix-${TAG}-result.json`, JSON.stringify({ results, out }, null, 1));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);
process.exit(0);

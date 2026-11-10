/**
 * Content-mix double counting (Alan, 10 Nov 19:31), LOCAL code on LIVE data, 1700px, read-only. "Before" = production
 * as served; "after" = production with lib/marketing-channels-tile.js served from this folder and GET
 * /api/aigeo/strategy-summary answered in-process by this repo (superseded steps left out; generated social steps a
 * GPT post covers not counted). Every non-GET request is refused (403). Campaign titles only.
 *   node scripts/playwright-verify-content-mix-dedupe-local.mjs      (PHASE=live: production after deploy)
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
const V = 'dc-20261110a';
const COMMIT = process.env.COMMIT || 'HEAD';
const FILES = ['/lib/marketing-channels-tile.js'];
const TABLES = { strategy_campaigns: 'updated_at', marketing_social_placements: 'set_at', strategy_campaign_ticks: 'set_at' };
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const refused = [];
const errors = [];
const API = {};

async function dbState() {
  const out = {};
  for (const [t, c] of Object.entries(TABLES)) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true });
    const { data } = await sb.from(t).select(c).not(c, 'is', null).order(c, { ascending: false }).limit(1);
    Object.assign(out, { [`${t}.rows`]: count ?? 'n/a', [`${t}.max`]: data?.[0]?.[c] || null });
  }
  return out;
}
async function localSummary() {
  const { default: handler } = await import('../api/aigeo/strategy-summary.js');
  let body = null;
  await handler({ method: 'GET', query: {}, headers: {} }, { status() { return this; }, setHeader() {}, json(j) { body = JSON.stringify(j); return this; }, send(t) { body = typeof t === 'string' ? t : JSON.stringify(t); return this; } });
  return body;
}
/** PHASE=live "before": the parent commit's channel tile against today's production summary would not show the old counts, so live compares with the stored local "before" numbers instead. */
function makeRoute(after) {
  return async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    if (req.method() !== 'GET') { refused.push(`${req.method()} ${url.pathname}`); return r.fulfill({ status: 403, contentType: 'application/json', body: '{"ok":false,"error":"refused by the read-only check"}' }); }
    if (!after || LIVE) return r.fallback();
    if (FILES.includes(url.pathname)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`.${url.pathname}`, 'utf8') });
    if (url.pathname === '/api/aigeo/strategy-summary') return r.fulfill({ status: 200, contentType: 'application/json', body: API.summary });
    return r.fallback();
  };
}
async function render(browser, after) {
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1200 } });
  await ctx.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); }, ENV.ARP_ADMIN_KEY);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${after ? 'after' : 'before'}: ${e.message}`));
  await ctx.route('**/*', makeRoute(after));
  await page.goto(`${BASE}/audit-dashboard.html#marketing`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#mk-channels [data-mkch-rec]') && document.querySelector('#mk-channels [data-mkch-row="youtube"] td:last-child')?.textContent !== 'loading…', null, { timeout: 240000 });
  await page.waitForSelector('#mk-social .mksoc-g', { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(4000);
  await page.addStyleTag({ content: '#debugPanel { display: none !important; }' });
  return { ctx, page };
}

function snap() {
  const num = (s) => (s === '—' || s == null ? null : Number(String(s).replace(/[^\d]/g, '')));
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) }; };
  const norm = (t) => (t || '').replace(/\b\d{1,2}:\d{2}\b/g, 'HH:MM').replace(/\(\d+(\.\d+)? h ago\)/g, '(N h ago)').replace(/\d+ days? left|\d+ h left/g, 'N left').replace(/\s+/g, ' ').trim();
  const t = document.getElementById('mk-channels');
  const rows = [...t.querySelectorAll('tr[data-mkch-row]')].map((r) => {
    const td = [...r.querySelectorAll('td')];
    const planned = Number((r.querySelector('[data-mkch-flag="planned"]')?.textContent.match(/^\d+/) || [0])[0]);
    const cov = r.querySelector('[data-mkch-covered]');
    return { key: r.dataset.mkchRow, sched: num(td[1].textContent), waiting: num(td[2].textContent), drafts: num(td[3].textContent), planned, covered: cov ? Number(cov.dataset.mkchCovered) : 0, covered_tip: cov?.getAttribute('title') || null, flags: [...r.querySelectorAll('[data-mkch-flag]')].map((f) => f.textContent) };
  });
  const mixTile = [...document.querySelectorAll('#mk-overview-tiles .mko-tile')].find((x) => /content mix/.test(x.querySelector('.mko-title')?.textContent || ''));
  const others = [...document.querySelectorAll('#mk-overview-tiles .mko-grid > .mko-tile')].filter((x) => !/content mix|by channel/.test(x.querySelector('.mko-title')?.textContent || '')).map((x) => ({ title: x.querySelector('.mko-title')?.textContent.trim(), ...box(x), text: norm(x.innerText) }));
  return { rows, rec: t.querySelector('[data-mkch-rec]')?.dataset.mkchRec, rec_text: t.querySelector('[data-mkch-rec]')?.textContent, rec_tip: t.querySelector('[data-mkch-rec]')?.getAttribute('title'), mix_head: num(mixTile.querySelector('.mko-head > span')?.firstChild?.textContent), mix_chip: num(mixTile.querySelector('.mko-chip')?.textContent), mix_box: box(mixTile), others };
}

const IN_MIX = ['email', 'fbig', 'linkedin', 'outlook', 'other'];
const live = (r) => r.sched + r.waiting + r.planned;
const BOOKED = new Set(['scheduled', 'checking', 'late', 'sent', 'published', 'verification_unavailable', 'done']);
const group = (ch) => (/Facebook|Instagram/.test(ch || '') ? 'fbig' : (/LinkedIn/.test(ch || '') ? 'linkedin' : null));
function genuine(summary) {
  const items = summary.quarter_plan.purpose_mix.items;
  const posts = new Set(items.filter((x) => !String(x.key).startsWith('step|') && x.code && group(x.channel)).map((x) => `${group(x.channel)}|${x.day}`));
  const planned = items.filter((x) => !x.draft && !x.waiting && !BOOKED.has(x.code) && group(x.channel));
  return { planned: planned.length, beside_gpt: planned.filter((x) => posts.has(`${group(x.channel)}|${x.day}`)).map((x) => `${x.day} ${x.key}`) };
}
function checks(b, a, summary) {
  const row = (s, k) => s.rows.find((r) => r.key === k) || { sched: 0, waiting: 0, drafts: 0, planned: 0, covered: 0 };
  for (const k of ['email', 'fbig', 'linkedin']) {
    const [x, y] = [row(b, k), row(a, k)];
    check(`${k}: before ${live(x)} live (${x.sched} sched + ${x.waiting} waiting + ${x.planned} planned) + ${x.drafts} drafts → after ${live(y)} live (${y.sched} + ${y.waiting} + ${y.planned}) + ${y.drafts} drafts · ${y.covered} covered by GPT post`, y.sched === x.sched && y.waiting === x.waiting && y.drafts === x.drafts, 'booked / waiting / drafts unchanged; only planned-with-no-post can drop');
  }
  const m = summary.quarter_plan.purpose_mix;
  check(`content mix: ${b.mix_head} + ${b.mix_chip} drafts → ${a.mix_head} + ${a.mix_chip} drafts (left out: ${m.superseded.length} superseded, ${m.covered.length} covered by GPT post)`, a.mix_head === m.deliveries && a.mix_chip === m.draft.deliveries);
  const sumLive = a.rows.filter((r) => IN_MIX.includes(r.key)).reduce((t, r) => t + live(r), 0);
  const sumDrafts = a.rows.filter((r) => IN_MIX.includes(r.key)).reduce((t, r) => t + r.drafts, 0);
  check(`still reconciles: Σ rows ${sumLive} = content mix ${a.mix_head}; Σ drafts ${sumDrafts} = chip ${a.mix_chip} (${a.rec_text})`, sumLive === a.mix_head && sumDrafts === a.mix_chip && a.rec === 'ok');
  const g = genuine(summary);
  check(`amber "planned, no post yet" counts only steps with no GPT post that day: ${g.planned} planned, ${g.beside_gpt.length} beside a GPT post`, !g.beside_gpt.length && g.planned === a.rows.filter((r) => ['fbig', 'linkedin'].includes(r.key)).reduce((t, r) => t + r.planned, 0), g.beside_gpt.join(' | '));
  const cov = a.rows.filter((r) => r.covered);
  check(`"covered by GPT post" shown with a hover: ${cov.map((r) => `${r.key} ${r.covered}`).join(' · ')}`, cov.length && cov.every((r) => /GPT post/.test(r.covered_tip || '')), cov[0]?.covered_tip?.split('\n').slice(0, 3).join(' | '));
  check('email: no step is "covered" (rule never applied to email)', !row(a, 'email').covered);
  const moved = a.others.filter((t) => { const x = b.others.find((y) => y.title === t.title); return !x || x.x !== t.x || x.y !== t.y || x.w !== t.w || x.text !== t.text; });
  check(`other overview tiles unchanged (${a.others.length}: position, width, text)`, !moved.length && a.mix_box.x === b.mix_box.x && a.mix_box.w === b.mix_box.w, moved.map((t) => t.title).join(', '));
}

const before = await dbState();
if (!LIVE) API.summary = await localSummary();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const out = {};
for (const [mode, after] of LIVE ? [['after', true]] : [['before', false], ['after', true]]) {
  const r = await render(browser, after);
  if (LIVE) {
    const tag = await r.page.evaluate(() => document.querySelector('script[src^="/lib/marketing-channels-tile.js"]')?.getAttribute('src'));
    const served = await r.page.evaluate(async (s) => (await fetch(s, { cache: 'no-store' })).text(), tag);
    const clean = (t) => t.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    check(`production serves ${tag}, identical to ${COMMIT}`, String(tag).endsWith(`?v=${V}`) && clean(served) === clean(execSync(`git show ${COMMIT}:lib/marketing-channels-tile.js`, { encoding: 'utf8' })));
    API.summary = await r.page.evaluate(async () => (await fetch('/api/aigeo/strategy-summary')).text());
  }
  out[mode] = await r.page.evaluate(snap);
  await r.page.locator('#mk-overview-tiles .mko-grid').screenshot({ path: `outputs/content-mix-dedupe-tiles-${mode}-${TAG}-1700px-20261110.png` });
  await r.page.locator('#mk-channels').screenshot({ path: `outputs/content-mix-dedupe-channel-${mode}-${TAG}-1700px-20261110.png` });
  await r.ctx.close();
}
await browser.close();
const summary = JSON.parse(API.summary);
if (LIVE) {
  const prior = JSON.parse(fs.readFileSync('outputs/_content-mix-dedupe-local-result.json', 'utf8')).out.before;
  checks(prior, out.after, summary);
} else checks(out.before, out.after, summary);
const after = await dbState();
const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
check('viewing writes nothing (row counts + newest timestamps)', !changed.length, changed.map((k) => `${k}: ${before[k]} → ${after[k]}`).join(' | ') || `${Object.keys(TABLES).length} tables unchanged`);
check('every non-GET refused', true, `${refused.length} refused: ${[...new Set(refused)].join(', ') || 'none attempted'}`);
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
fs.writeFileSync(`outputs/_content-mix-dedupe-${TAG}-result.json`, JSON.stringify({ results, out, covered: summary.quarter_plan.purpose_mix.covered, superseded: summary.quarter_plan.purpose_mix.superseded }, null, 1));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);
process.exit(0);

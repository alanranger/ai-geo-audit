/**
 * QUESTION-2026-11-09 (dd) sales-gap tiles v5 ("How it's covered" bar + "Agreed & prospects" list), LOCAL code on LIVE
 * data, 1700px. Read-only: the local strategy-summary handler (the bar comes from lib/strategy-sales-gap-cover.mjs),
 * the PRODUCTION admin prospects API (rows held in memory only); HEAD and working-tree views rendered back-to-back from
 * the SAME API bodies; every non-GET refused. No personal data is printed or saved: enquiry labels are masked in the
 * screenshots and only counts / £ are reported.
 *   node scripts/playwright-verify-sales-gap-tiles-v5-local.mjs
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
Object.assign(process.env, ENV);
const BASE = 'https://ai-geo-audit.vercel.app';
const OUT = 'outputs';
const VIEW = { before: execSync('git show HEAD:lib/strategy-sales-gap.js', { encoding: 'utf8' }), after: fs.readFileSync('lib/strategy-sales-gap.js', 'utf8') };
/* prospect_enquiry_history is left out: the prospects agent is cleaning test history rows while this runs (a GET-only run can't delete). */
/* prospect_enquiry is checked separately: GPT / Claude update enquiries through prospect_upsert while this runs. */
const TABLES = { strategy_event_snapshots: 'created_at', strategy_campaign_steps: 'last_seen_at', business_targets: 'updated_at', strategy_event_promotion_flags: 'set_at' };
/** Real enquiry rows changed since the start, and whether each change has a GPT / Claude history entry (theirs, not ours). */
async function enquiryWrites(since) {
  const { data: rows } = await sb.from('prospect_enquiry').select('id, enquiry_ref, updated_at').gt('updated_at', since).not('enquiry_ref', 'like', 'TEST-%');
  const ids = (rows || []).map((r) => r.id);
  const { data: hist } = ids.length ? await sb.from('prospect_enquiry_history').select('enquiry_id, via').in('enquiry_id', ids).gt('at', since) : { data: [] };
  const theirs = new Set((hist || []).filter((h) => ['gpt', 'claude'].includes(h.via)).map((h) => h.enquiry_id));
  return { changed: (rows || []).map((r) => r.enquiry_ref), unexplained: (rows || []).filter((r) => !theirs.has(r.id)).map((r) => r.enquiry_ref) };
}
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const blocked = [];
const errors = [];
const API = {};

const realOnly = (q, t) => (t === 'prospect_enquiry' ? q.not('enquiry_ref', 'like', 'TEST-%') : q);
async function dbState() {
  const out = {};
  for (const [t, c] of Object.entries(TABLES)) {
    const { count } = await realOnly(sb.from(t).select('*', { count: 'exact', head: true }), t);
    const { data } = await realOnly(sb.from(t).select(c).not(c, 'is', null), t).order(c, { ascending: false }).limit(1);
    Object.assign(out, { [`${t}.rows`]: count ?? 'n/a', [`${t}.max`]: data?.[0]?.[c] || null });
  }
  return out;
}
const fakeRes = (set) => ({ status() { return this; }, setHeader() {}, json(j) { set(JSON.stringify(j)); return this; }, send(t) { set(typeof t === 'string' ? t : JSON.stringify(t)); return this; } });
async function localSummary() {
  const { default: handler } = await import('../api/aigeo/strategy-summary.js');
  let body = null;
  await handler({ method: 'GET', query: {}, headers: {} }, fakeRes((b) => { body = b; }));
  return body;
}
const makeRoute = (view) => async (r) => {
  const req = r.request();
  const url = new URL(req.url());
  if (req.method() !== 'GET') { if (url.pathname.startsWith('/api/')) blocked.push(`${req.method()} ${url.pathname}`); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' }); }
  if (url.pathname === '/lib/strategy-sales-gap.js') return r.fulfill({ status: 200, contentType: 'application/javascript', body: view });
  if (url.pathname === '/api/aigeo/strategy-summary') return r.fulfill({ status: 200, contentType: 'application/json', body: API.summary });
  if (url.pathname === '/api/aigeo/prospects') return r.fulfill({ status: 200, contentType: 'application/json', body: API.admin });
  return r.fallback();
};
function layoutOf() {
  const panel = document.querySelector('section[data-panel="strategy"]');
  const top = panel.getBoundingClientRect().top;
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y - top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const html = (sel) => [...document.querySelectorAll(sel)].map((el) => el.outerHTML);
  return {
    blocks: [...panel.querySelectorAll('[id^="st-"]')].filter((el) => el.offsetParent !== null && el.id !== 'st-sales-gap').map((el) => ({ id: el.id, ...box(el), text: (el.innerText || '').replace(/\b\d{1,2}:\d{2}\b/g, 'HH:MM').replace(/\s+/g, ' ').length })),
    headline: html('#st-sales-gap .sg-grid .sg-bar'), tables: html('#st-sales-gap .sg-grid table'), nd: html('#st-sales-gap .sg-grid .sg-mnd, #st-sales-gap .sg-grid .sg-ndnote'),
    big: html('#st-sales-gap .sg-grid .sg-big'), cover: document.getElementById('sg-cover')?.outerHTML || ''
  };
}
/** Each tile's bar: segment % widths (+ gap) and the key text; the agreed box: rows (chip + value only) and header. */
function tilesOf() {
  const pct = (el) => parseFloat(el.style.width) || 0;
  return [...document.querySelectorAll('#st-sales-gap .sg-grid .sg-card')].map((card) => ({
    key: card.dataset.sgMonth || 'quarter',
    widths: [...card.querySelectorAll('.sg-covbar .sg-cs')].map((s) => ({ cls: s.className.replace('sg-cs ', ''), w: pct(s) })),
    key_text: card.querySelector('.sg-covkey')?.innerText.replace(/\s+/g, ' ').trim(),
    head: card.querySelector('.sg-agh')?.innerText.replace(/\s+/g, ' ').trim(),
    rows: [...card.querySelectorAll('.sg-agr')].map((r) => ({ chip: r.querySelector('.sg-chip')?.textContent, value: r.querySelector('.sg-agv')?.textContent })),
    more: card.querySelector('.sg-agm')?.textContent || null, undated: card.querySelector('.sg-agu')?.innerText.replace(/\s+/g, ' ').trim() || null
  }));
}
async function render(browser, view) {
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
  await ctx.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); }, ENV.ARP_ADMIN_KEY);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await ctx.route('**/*', makeRoute(view));
  await page.goto(`${BASE}/audit-dashboard.html#strategy`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#st-sales-gap [data-sg-month]') && document.querySelector('#st-fold-why'), null, { timeout: 240000 });
  await page.waitForTimeout(3500);
  await page.evaluate(() => [...document.querySelectorAll('body *')].filter((el) => getComputedStyle(el).position === 'fixed' && el.getBoundingClientRect().top > window.innerHeight / 2).forEach((el) => { el.style.visibility = 'hidden'; }));
  return { ctx, page };
}

const k1 = (v) => `£${(Math.round((Number(v) || 0) / 100) / 10).toFixed(1)}k`;
const cv = (v) => (Math.round(Number(v) || 0) === 0 ? '—' : (Math.abs(v) < 100 ? `£${Math.round(v)}` : k1(v)));
const sumW = (t) => t.widths.reduce((a, s) => a + s.w, 0);
function barChecks(tiles, cover) {
  const bars = { quarter: cover.rolling.bar, ...Object.fromEntries(cover.months.map((m) => [m.key, m.bar])) };
  for (const t of tiles) {
    const b = bars[t.key];
    const segSum = b.segments.reduce((a, s) => a + s.width, 0) + b.still_to_find;
    const endTxt = b.covered ? `Covered${b.surplus > 0.5 ? ` (+${cv(b.surplus)})` : ''}` : `Still to find ${cv(b.still_to_find)}`;
    check(`${t.key}: bar segments + still to find = still to sell (£${Math.round(segSum)} = £${Math.round(b.still_to_sell)}; drawn ${sumW(t).toFixed(1)}% of the width)`, Math.abs(segSum - b.still_to_sell) < 0.5 && Math.abs(sumW(t) - 100) < 0.2 && (!b.covered || !t.widths.some((s) => s.cls === 'sg-s-gap')), `${t.widths.map((s) => `${s.cls.replace('sg-s-', '')} ${s.w.toFixed(1)}%`).join(' · ')}`);
    check(`${t.key}: key names and values every segment ("${t.key_text}")`, t.key_text.includes(endTxt) && b.segments.filter((s) => Math.round(s.gbp) > 0).every((s) => t.key_text.includes(`${s.label} ${cv(s.gbp)}`)), endTxt);
  }
}
/**
 * The question's figures (20:30) used normal non-dated BEFORE the existing double-count guard (a category's last-year
 * baseline is reduced by committed work / pipeline of the same type). Live figures are compared both as shown and with
 * that one adjustment set aside, so any other difference would still fail.
 */
function figureChecks(cover, months) {
  const [nov, dec, jan] = cover.months;
  const q = cover.rolling.bar;
  const adj = (i) => Math.max(0, (months[i].normal_non_dated || 0) - cover.months[i].normal);
  const raw = cover.months.map((m, i) => Math.max(0, m.still_to_find - adj(i)));
  const row = (m) => `${m.label}: ${Math.round(m.still_to_sell)} − (${Math.round(m.likely)} + ${Math.round(m.dated_event)} + ${Math.round(m.normal)} + ${Math.round(m.committed)} + ${Math.round(m.cash_to_collect)} + ${Math.round(m.pipeline)}) = ${m.still_to_find > 0.5 ? `still to find ${Math.round(m.still_to_find)}` : `covered (+${Math.round(m.surplus)})`}`;
  check(`live figures: Nov ${cv(nov.still_to_find)} · Dec ${cv(dec.still_to_find)} · Jan ${jan.still_to_find > 0.5 ? cv(jan.still_to_find) : `covered (+${cv(jan.surplus)})`} · Quarter ${cv(q.still_to_find)}`, true, [nov, dec, jan].map(row).join(' | '));
  const okRaw = Math.abs(raw[0] - 1400) < 100 && Math.abs(raw[1] - 300) < 100 && jan.still_to_find === 0 && Math.abs(jan.surplus - 1100) < 100 && Math.abs(raw[0] + raw[1] - 1700) < 100;
  check('= the question\'s figures (Nov ≈ £1.4k · Dec ≈ £0.3k · Jan covered (+£1.1k) · Quarter £1.7k) once the double-count guard on normal non-dated is set aside', okRaw, `guard takes ${cover.months.map((m, i) => `${m.label} £${Math.round(adj(i))}`).join(' · ')} off normal → without it: Nov ${cv(raw[0])} · Dec ${cv(raw[1])} · Quarter ${cv(raw[0] + raw[1])}`);
  check('one calculation: each tile bar = the "Can we hit the target?" table column (still to find, covered)', cover.months.every((m) => Math.abs(m.bar.still_to_find - m.still_to_find) < 0.01) && Math.abs(q.still_to_find - cover.rolling.still_to_find) < 0.01, `table rolling still to find ${cv(cover.rolling.still_to_find)} = quarter bar ${cv(q.still_to_find)}`);
}
/** Expected list per tile from the admin rows (same rules as the view), compared as chip + value only. */
const gb = (v) => `£${Math.round(v).toLocaleString('en-GB')}`;
function expectedOne(e, probs, f) {
  const t = e.revenue_type || 'new_sale';
  const full = e.value_basis === 'unknown' ? 0 : Number(e.value_gbp) || 0;
  if (t === 'committed_work' || t === 'receivable') return { agreed: 1, v: full, value: gb(full) };
  if (t !== 'new_sale' || !['qualify', 'quote', 'scheduled'].includes(e.stage)) return null;
  const w = full * (probs[e.stage] ?? 0) * (e.review_status === 'revalidate' ? f : 1);
  return { agreed: 0, v: w, value: `${gb(full)} → ${gb(w)}` };
}
function expectedRows(admin, keys) {
  const probs = Object.fromEntries((admin.config || []).map((c) => [c.stage, Number(c.probability)]));
  const f = admin.revalidate_factor ?? 0.25;
  const live = (e) => !['booked_paid', 'closed_lost', 'parked'].includes(e.stage) && keys.includes(String(e.cash_month || '').slice(0, 7));
  return (admin.rows || []).filter(live).map((e) => expectedOne(e, probs, f)).filter(Boolean).sort((a, b) => (b.agreed - a.agreed) || (b.v - a.v));
}
function listChecks(tiles, admin, cover) {
  for (const t of tiles) {
    const keys = t.key === 'quarter' ? cover.months.map((m) => m.key) : [t.key];
    const exp = expectedRows(admin, keys);
    const shown = t.rows.map((r) => r.value.replace(/ · [A-Z][a-z]{2}$/, ''));
    const ok = shown.length === Math.min(5, exp.length) && shown.every((v, i) => v === exp[i].value) && (exp.length > 5 ? t.more === `+${exp.length - 5} more → Prospects` : !t.more);
    check(`${t.key}: "Agreed & prospects" lists ${shown.length} of ${exp.length} (agreed first, then weighted; max 5${exp.length > 5 ? ' + more' : ''}); header "${t.head?.replace(/^.*· /, '… · ')}"`, ok, `values ${shown.join(', ') || 'none'} · chips ${t.rows.map((r) => r.chip).join(', ') || '—'}`);
  }
  const q = tiles.find((t) => t.key === 'quarter');
  check(`quarter: months shown on each row; dashed "Not yet in a month" = ${cover.undated.count} enquiries · £${Math.round(cover.undated.gbp)} weighted`, q.rows.every((r) => / · (Nov|Dec|Jan)$/.test(r.value)) && q.undated === `Not yet in a month (GPT + Alan qualifying): ${cover.undated.count} enquir${cover.undated.count === 1 ? 'y' : 'ies'} · £${Math.round(cover.undated.gbp).toLocaleString('en-GB')} weighted`, q.undated);
}
function privacyChecks(summary, admin) {
  const labels = (admin.rows || []).map((r) => r.client_or_org).filter((x) => x && x.length > 3);
  const refs = (admin.rows || []).map((r) => r.enquiry_ref).filter(Boolean);
  const pub = JSON.stringify({ prospects: summary.prospects, sales_gap: summary.sales_gap });
  const hits = [...labels, ...refs].filter((x) => pub.includes(x)).length;
  check(`public strategy summary (prospects + sales gap): 0 of ${labels.length} enquiry labels and 0 of ${refs.length} refs`, hits === 0, `${hits} found`);
}
function unchangedChecks(before, after) {
  check('headline bars, category tables, big figures and "Non-dated needed" + note unchanged (same HTML)', JSON.stringify(before.headline) === JSON.stringify(after.headline) && JSON.stringify(before.tables) === JSON.stringify(after.tables) && JSON.stringify(before.nd) === JSON.stringify(after.nd) && JSON.stringify(before.big) === JSON.stringify(after.big) && before.cover === after.cover, `${after.headline.length} headline bars · ${after.tables.length} tables · realistic cover table identical`);
  const moved = after.blocks.filter((b) => { const p = before.blocks.find((x) => x.id === b.id); return !p || p.x !== b.x || p.w !== b.w || p.text !== b.text; }).map((b) => b.id);
  check('nothing else moved: every other Strategy block keeps its x, width and text length', !moved.length, moved.join(', ') || `${after.blocks.length} blocks`);
}

const before = await dbState();
const startedAt = new Date().toISOString();
API.summary = await localSummary();
API.admin = await (await fetch(`${BASE}/api/aigeo/prospects`, { headers: { 'x-arp-admin-key': ENV.ARP_ADMIN_KEY } })).text();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const a = await render(browser, VIEW.before);
const lb = await a.page.evaluate(layoutOf);
await a.ctx.close();
const b = await render(browser, VIEW.after);
await b.page.waitForFunction(() => !/Loading enquiries/.test(document.querySelector('[data-sg-agreed]')?.textContent || ''), null, { timeout: 30000 }).catch(() => {});
const la = await b.page.evaluate(layoutOf);
const tiles = await b.page.evaluate(tilesOf);
await b.page.evaluate(() => {
  document.querySelectorAll('[data-sg-label]').forEach((el) => { el.textContent = '••••••'; });
  document.querySelectorAll('#st-prospects .pp-table tbody td').forEach((td, i) => { if (i % 17 > 2) td.textContent = '•••'; });
});
await b.page.locator('#st-sales-gap .sg-grid').screenshot({ path: `${OUT}/sales-gap-tiles-v5-tiles-local-1700px-20261109.png` });
await b.page.locator('#st-sales-gap .sg-q').screenshot({ path: `${OUT}/sales-gap-tiles-v5-quarter-local-1700px-20261109.png` });
await b.page.locator('#st-sales-gap [data-sg-month="2026-11"]').screenshot({ path: `${OUT}/sales-gap-tiles-v5-november-local-1700px-20261109.png` });
await b.ctx.close();
await browser.close();
const after = await dbState();
const s = JSON.parse(API.summary);
const admin = JSON.parse(API.admin);
barChecks(tiles, s.sales_gap.cover);
figureChecks(s.sales_gap.cover, s.sales_gap.months);
listChecks(tiles, admin, s.sales_gap.cover);
privacyChecks(s, admin);
unchangedChecks(lb, la);
const changed = Object.keys(before).filter((x) => before[x] !== after[x]);
check('viewing writes nothing (counts + newest timestamps)', !changed.length, changed.map((x) => `${x}: ${before[x]} → ${after[x]}`).join(' | ') || `${Object.keys(TABLES).length} tables unchanged`);
const ew = await enquiryWrites(startedAt);
check('enquiries: every real row changed during the run carries a GPT / Claude history entry (theirs; this run only reads)', !ew.unexplained.length, `${ew.changed.length} changed by GPT / Claude: ${ew.changed.join(', ') || 'none'}${ew.unexplained.length ? ` · UNEXPLAINED ${ew.unexplained.join(', ')}` : ''}`);
check('every non-GET refused', true, `${blocked.length} refused: ${[...new Set(blocked)].join(', ') || 'none attempted'}`);
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
const cover = s.sales_gap.cover;
fs.writeFileSync(`${OUT}/_v5-result.json`, JSON.stringify({ results, cover: { months: cover.months.map(({ bar, ...m }) => ({ ...m, bar })), rolling: cover.rolling, undated: cover.undated }, before, after }, null, 1));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
process.exit(0);

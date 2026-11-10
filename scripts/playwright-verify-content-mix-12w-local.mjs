/**
 * QUESTION-2026-11-10 content-mix-tile-12-weeks: Marketing tile 6 "Next 12 weeks: content mix", LOCAL code on LIVE
 * data, 1700px. "Before" = production as served; "after" = production with lib/marketing-overview-tiles.js served from
 * this folder and GET /api/aigeo/strategy-summary answered in-process by this repo's handler (live Supabase). Every
 * non-GET request is refused (403). Expected counts are rebuilt independently: stored sends from strategy_campaigns
 * (SQL), plan steps + manual steps from the summary's own campaign weeks, each kept when dated today … today + 83.
 *   node scripts/playwright-verify-content-mix-12w-local.mjs      (PHASE=live: production files + APIs, after deploy)
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
const V = 'cm12-20261110a';
/** PHASE=live "before": the deployed page with the parent commit's tile script (same live data, old tile wording). */
const COMMIT = '455f0676';
const TABLES = { strategy_campaigns: 'updated_at', strategy_campaign_steps: 'last_seen_at', strategy_initiative_links: 'created_at' };
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
const fakeRes = (set) => ({ status() { return this; }, setHeader() {}, json(j) { set(JSON.stringify(j)); return this; }, send(t) { set(typeof t === 'string' ? t : JSON.stringify(t)); return this; }, end() { return this; } });
async function localSummary() {
  const { default: handler } = await import('../api/aigeo/strategy-summary.js');
  let body = null;
  await handler({ method: 'GET', query: {}, headers: {} }, fakeRes((b) => { body = b; }));
  return body;
}

function makeRoute(after) {
  return async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    if (req.method() !== 'GET') { refused.push(`${req.method()} ${url.pathname}`); return r.fulfill({ status: 403, contentType: 'application/json', body: '{"ok":false,"error":"refused by the read-only check"}' }); }
    if (LIVE && !after && url.pathname === '/lib/marketing-overview-tiles.js') return r.fulfill({ status: 200, contentType: 'application/javascript', body: execSync(`git show ${COMMIT}~1:lib/marketing-overview-tiles.js`, { encoding: 'utf8' }) });
    if (!after || LIVE) return r.fallback();
    if (url.pathname === '/lib/marketing-overview-tiles.js') return r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync('lib/marketing-overview-tiles.js', 'utf8') });
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
  await page.waitForFunction(() => document.querySelector('#mk-overview-tiles .mko-mix'), null, { timeout: 240000 });
  await page.waitForSelector('#mk-social .mksoc-g', { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(4000);
  await page.addStyleTag({ content: '#debugPanel { display: none !important; }' });
  return { ctx, page };
}

function layoutOf() {
  const panel = document.querySelector('section[data-panel="marketing"]') || document.getElementById('marketing-root');
  const top = panel.getBoundingClientRect().top;
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y - top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const norm = (t) => (t || '').replace(/\b\d{1,2}:\d{2}\b/g, 'HH:MM').replace(/\(\d+(\.\d+)? h ago\)/g, '(N h ago)').replace(/\d+ days? left|\d+ h left/g, 'N left').replace(/\s+/g, ' ').trim();
  const tiles = [...document.querySelectorAll('#mk-overview-tiles .mko-grid > .mko-tile')].map((el) => ({ title: el.querySelector('.mko-title')?.textContent.trim(), ...box(el), text: norm(el.innerText) }));
  const sections = [...document.querySelectorAll('#marketing-root > *, #marketing-root .rt-section[id]')].filter((el) => el.id && el.offsetParent !== null && el.id !== 'mk-overview-tiles').map((el) => ({ id: el.id, ...box(el) }));
  return { tiles, sections };
}
function mixTileOf() {
  const t = [...document.querySelectorAll('#mk-overview-tiles .mko-tile')].find((el) => /content mix/.test(el.querySelector('.mko-title')?.textContent || ''));
  const num = (s) => Number(String(s || '').replace(/[^\d]/g, ''));
  const rows = [...t.querySelectorAll('.mko-mixrow')].map((r) => ({ label: r.querySelector('.mko-mixl')?.textContent, n: num(r.querySelector('.mko-mixn')?.textContent), segs: [...r.querySelectorAll('.mko-seg')].map((s) => num(s.textContent)) }));
  return {
    title: t.querySelector('.mko-title')?.textContent.trim(), tip: t.querySelector('.mko-title')?.getAttribute('title') || '',
    head: num(t.querySelector('.mko-head > span')?.firstChild?.textContent), unit: t.querySelector('.mko-head .mko-unit')?.textContent,
    range: t.querySelector('.mko-head > span')?.getAttribute('title'), chip: num(t.querySelector('.mko-chip')?.textContent), rows,
    details: [...t.querySelectorAll('.mko-det li')].map((li) => li.textContent), src: t.querySelector('.mko-src')?.textContent
  };
}

/* ---------- expected counts, rebuilt apart from the tile code ---------- */

const addDays = (s, n) => new Date(Date.parse(`${s}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const d10 = (v) => (v ? String(v).slice(0, 10) : null);
const notDelivery = (s) => s.channel === 'Quarter action' || s.gbp === 'check' || !!s.optional || ['skipped', 'not_needed'].includes(s.state?.status) || !!(s.is_email && s.covered_by?.length);
const scheduledOf = (r) => r.scheduled_for || [...(r.stage_history || [])].reverse().find((h) => h.stage === 'scheduled' && h.scheduled_for)?.scheduled_for || null;
async function expected(s, today) {
  const to = addDays(today, 83);
  const inWin = (day) => !!day && day >= today && day <= to;
  const weeks = s.campaign?.weeks || [];
  const viewTo = weeks.length ? addDays(weeks[weeks.length - 1].week, 6) : null;
  const steps = weeks.flatMap((w) => w.steps || []).filter((x) => !notDelivery(x));
  const viaStep = new Set(steps.map((x) => x.link?.campaign_key).filter(Boolean));
  const manual = (s.campaign?.carried?.future || []).filter((x) => !notDelivery(x) && viewTo && x.day > viewTo);
  const { data: rows } = await sb.from('strategy_campaigns').select('campaign_key, kind, stage, sent_on, actual_sends, scheduled_for, planned_send_on, window_start, stage_history').eq('property_url', 'https://www.alanranger.com');
  const sends = (rows || []).filter((r) => r.kind !== 'weekly_email' && ['drafted', 'approved', 'scheduled', 'sent', 'measured'].includes(r.stage))
    .map((r) => ({ key: r.campaign_key, stage: r.stage, day: d10(r.sent_on || scheduledOf(r) || r.planned_send_on || r.window_start) }))
    .filter((r) => !(viaStep.has(r.key) && viewTo && r.day <= viewTo));
  const parts = { steps: steps.filter((x) => inWin(x.day)), manual: manual.filter((x) => inWin(x.day)), sends: sends.filter((x) => inWin(x.day)) };
  return { to, parts, total: parts.steps.length + parts.manual.length + parts.sends.length, drafted_sends: parts.sends.filter((x) => x.stage === 'drafted').length };
}

function tileChecks(t, s, exp, today) {
  const m = s.quarter_plan.purpose_mix;
  check(`title reads "Next 12 weeks: content mix" ("${t.title}")`, t.title === 'Next 12 weeks: content mix');
  check('hover tip on the title is the question\'s exact text', t.tip === 'All scheduled deliveries and drafts across every channel in the next 12 weeks, by purpose. Drafts are shown apart and are not yet committed.', t.tip);
  check(`window = today + 84 days, rolling (${m.window.from} → ${m.window.to}; headline tooltip "${t.range}")`, m.window.from === today && m.window.to === exp.to && m.window.days === 84 && /→/.test(t.range));
  check(`headline ${t.head} "${t.unit}" = server scheduled / approved count ${m.deliveries}; chip +${t.chip} = drafts ${m.draft.deliveries}`, t.head === m.deliveries && t.unit === 'deliveries · next 12 weeks' && t.chip === m.draft.deliveries);
  const p = exp.parts;
  check(`counts = DB / plan items dated ${today} … ${exp.to}: ${m.deliveries} + ${m.draft.deliveries} drafts = ${exp.total} (plan steps ${p.steps.length} · manual steps ${p.manual.length} · stored sends ${p.sends.length}, of which drafted ${exp.drafted_sends})`, m.deliveries + m.draft.deliveries === exp.total, `sends: ${p.sends.map((x) => `${x.day} ${x.stage} ${x.key}`).join(' | ')}`);
  const bar = (label) => t.rows.filter((r) => r.label === label);
  const sum = (rows) => rows.reduce((a, r) => a + r.n, 0);
  check(`bars sum to the headline: Scheduled ${sum(bar('Scheduled'))}${bar('Waiting').length ? ` + Waiting ${sum(bar('Waiting'))}` : ''} = ${t.head}; Drafts bar ${sum(bar('Drafts'))} = chip ${t.chip}`, sum(bar('Scheduled')) + sum(bar('Waiting')) === t.head && sum(bar('Drafts')) === t.chip);
  check('each bar\'s purpose segments add up to its count', t.rows.every((r) => !r.segs.length || r.segs.reduce((a, b) => a + b, 0) === r.n), t.rows.map((r) => `${r.label} ${r.segs.join('+')}=${r.n}`).join(' · '));
  check('details dropdown uses the 12-week range; no "4 weeks" left on the tile', t.details.some((x) => /\(today \+ 84 days, rolling\)/.test(x)) && !/4 weeks/.test(JSON.stringify(t)), t.details.at(-1));
  const qp = Object.values(s.quarter_plan.initiatives || {}).flatMap((i) => i.measure?.lines || []).map((l) => l.label).filter((l) => /weeks: \d+ deliveries/.test(l));
  check(`Strategy quarter plan's programme measure reads the same mix: "${qp.join(' | ')}"`, qp.length > 0 && qp.every((l) => l === `Next 12 weeks: ${m.deliveries} deliveries`));
}
function sameChecks(lb, la) {
  const tb = lb.tiles.find((x) => /content mix/.test(x.title));
  const ta = la.tiles.find((x) => /content mix/.test(x.title));
  check(`tile 6 keeps its position and size (${ta.w}×${ta.h} at ${ta.x},${ta.y})`, tb.x === ta.x && tb.y === ta.y && tb.w === ta.w && tb.h === ta.h, `before ${tb.w}×${tb.h} at ${tb.x},${tb.y}`);
  const others = la.tiles.filter((x) => !/content mix/.test(x.title));
  const moved = others.filter((t) => { const b = lb.tiles.find((x) => x.title === t.title); return !b || b.x !== t.x || b.y !== t.y || b.w !== t.w || b.h !== t.h || b.text !== t.text; });
  check(`every other overview tile unchanged (position, size, text): ${others.length} tiles`, others.length === lb.tiles.length - 1 && !moved.length, moved.map((t) => t.title).join(', ') || others.map((t) => t.title).join(' · '));
  const off = la.sections.filter((x) => { const b = lb.sections.find((y) => y.id === x.id); return !b || b.x !== x.x || b.y !== x.y || b.w !== x.w; });
  check(`nothing else on the tab moved: ${la.sections.length} sections keep x, y and width`, !off.length && la.sections.length === lb.sections.length, off.map((x) => x.id).join(', '));
}

const before = await dbState();
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
API.summary = LIVE ? await (await fetch(`${BASE}/api/aigeo/strategy-summary`)).text() : await localSummary();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const a = await render(browser, false);
const lb = await a.page.evaluate(layoutOf);
const tBefore = await a.page.evaluate(mixTileOf);
await a.ctx.close();
const b = await render(browser, true);
if (LIVE) {
  const tag = await b.page.evaluate(() => document.querySelector('script[src*="/lib/marketing-overview-tiles.js"]')?.getAttribute('src'));
  check(`production serves marketing-overview-tiles.js?v=${V}`, String(tag).endsWith(`?v=${V}`), tag);
}
const la = await b.page.evaluate(layoutOf);
const t = await b.page.evaluate(mixTileOf);
const shown = LIVE ? await b.page.evaluate(async () => (await (await fetch('/api/aigeo/strategy-summary')).text())) : API.summary;
const tileEl = b.page.locator('#mk-overview-tiles .mko-tile', { hasText: 'content mix' });
await tileEl.screenshot({ path: `outputs/content-mix-12w-${TAG}-1700px-20261110.png` });
await b.page.locator('#mk-overview-tiles .mko-grid').screenshot({ path: `outputs/content-mix-12w-overview-${TAG}-1700px-20261110.png` });
await b.ctx.close();
await browser.close();
const s = JSON.parse(shown);
const exp = await expected(s, today);
tileChecks(t, s, exp, today);
sameChecks(lb, la);
check(`before (${LIVE ? `parent of ${COMMIT}'s tile script on today's data` : 'production, 4-week view'}): "${tBefore.title}" ${tBefore.head} + ${tBefore.chip} drafts → after: ${t.head} + ${t.chip} drafts`, true);
const after = await dbState();
const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
check('viewing writes nothing (row counts + newest timestamps)', !changed.length, changed.map((k) => `${k}: ${before[k]} → ${after[k]}`).join(' | ') || `${Object.keys(TABLES).length} tables unchanged`);
check('every non-GET refused', true, `${refused.length} refused: ${[...new Set(refused)].join(', ') || 'none attempted'}`);
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
fs.writeFileSync(`outputs/_content-mix-12w-${TAG}-result.json`, JSON.stringify({ results, tile: t, before_tile: tBefore, expected: exp }, null, 1));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);
process.exit(0);

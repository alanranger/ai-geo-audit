/**
 * QUESTION-2026-11-10 channel-tile-separate-rows-fix (Alan 20:14): "Next 12 weeks: by channel" as seven top-level rows,
 * LOCAL lib/marketing-channels-tile.js on LIVE production data, 1700px, read-only. "Before" = production as served;
 * "after" = the same page with only that one file served from this folder. Every non-GET request is refused (403).
 * Checks: 7 rows in Alan's order (first "Squarespace email", none indented); each social row = that platform's
 * placements in Supabase (today + 84 days, content-mix steps only) plus the channel's steps with no placement yet;
 * email / Google Business / Shorts = their sources; numbers on the channel-name line (bounding boxes); nothing else on
 * the tab changed. Writes the tile screenshot and a side-by-side with the approved mock-up.
 *   node scripts/playwright-verify-channel-tile-7rows-local.mjs
 *   PHASE=live: production as deployed ("before" = production with the parent commit's tile file; tag + file checked)
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
const BASE = 'https://ai-geo-audit.vercel.app';
const FILE = '/lib/marketing-channels-tile.js';
const LIVE = process.env.PHASE === 'live';
const TAG = LIVE ? 'live' : 'local';
const COMMIT = '3b2dd20d';
const V = 'ch7-20261110a';
const MOCK = 'C:/Users/alan/Google Drive/Claude shared resources/Claude Questions for Cursor/channels-tile-v1.html';
const OUT = `outputs/channel-tile-7rows-${TAG}-1700px-20261110.png`;
const SIDE = `outputs/channel-tile-7rows-${LIVE ? 'live-' : ''}vs-mock-1700px-20261110.png`;
const ORDER = ['Squarespace email', 'Facebook', 'Instagram', 'Instagram Stories', 'LinkedIn', 'Google Business', 'YouTube Shorts'];
const SOCIAL = { Facebook: ['facebook_feed', /Facebook/], Instagram: ['instagram_feed', /Instagram/], 'Instagram Stories': ['instagram_story', null], LinkedIn: ['linkedin_feed', /LinkedIn/] };
const TABLES = { strategy_campaigns: 'updated_at', marketing_social_placements: 'set_at', strategy_campaign_ticks: 'set_at', sqs_scheduled_emails: 'collected_at' };
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const refused = [];
const errors = [];
const log = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);

async function dbState() {
  const out = {};
  for (const [t, c] of Object.entries(TABLES)) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true });
    const { data } = await sb.from(t).select(c).not(c, 'is', null).order(c, { ascending: false }).limit(1);
    Object.assign(out, { [`${t}.rows`]: count ?? 'n/a', [`${t}.max`]: data?.[0]?.[c] || null });
  }
  return out;
}
function makeRoute(after) {
  return async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    if (req.method() !== 'GET') { refused.push(`${req.method()} ${url.pathname}`); return r.fulfill({ status: 403, contentType: 'application/json', body: '{"ok":false,"error":"refused by the read-only check"}' }); }
    if (url.pathname !== FILE || after === LIVE) return r.fallback();
    const body = LIVE ? execSync(`git show ${COMMIT}~1:lib/marketing-channels-tile.js`, { encoding: 'utf8' }) : fs.readFileSync(`.${FILE}`, 'utf8');
    return r.fulfill({ status: 200, contentType: 'application/javascript', body });
  };
}
async function render(browser, after) {
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1200 } });
  await ctx.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); localStorage.setItem('mks-channel', 'all'); }, ENV.ARP_ADMIN_KEY);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${after ? 'after' : 'before'}: ${e.message}`));
  await ctx.route('**/*', makeRoute(after));
  await page.goto(`${BASE}/audit-dashboard.html#marketing`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#mk-sqs-cycles') && document.querySelector('#mk-overview-tiles .mko-mix'), null, { timeout: 180000 });
  await page.waitForFunction(() => document.querySelector('#mk-channels [data-mkch-row="youtube"] td:last-child')?.textContent !== 'loading…', null, { timeout: 90000 });
  await page.waitForSelector('#mk-social .mksoc-g', { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(4000);
  await page.addStyleTag({ content: '#debugPanel { display: none !important; }' });
  return { ctx, page };
}

function layoutOf() {
  const panel = document.getElementById('marketing-root');
  const top = panel.getBoundingClientRect().top;
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y - top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const norm = (t) => (t || '').replace(/\b\d{1,2}:\d{2}\b/g, 'HH:MM').replace(/\(\d+(\.\d+)? h ago\)/g, '(N h ago)').replace(/\d+ days? left|\d+ h left/g, 'N left').replace(/\s+/g, ' ').trim();
  const tiles = [...document.querySelectorAll('#mk-overview-tiles .mko-grid > .mko-tile')].map((el) => ({ id: el.id || null, title: el.querySelector('.mko-title')?.textContent.trim(), ...box(el), text: norm(el.innerText) }));
  const sections = [...document.querySelectorAll('#marketing-root > *, #marketing-root .rt-section[id]')].filter((el) => el.id && el.offsetParent !== null && el.id !== 'mk-overview-tiles').map((el) => ({ id: el.id, ...box(el), text: norm(el.innerText).length }));
  return { tiles, sections, grid: box(document.querySelector('#mk-overview-tiles .mko-grid')) };
}
/** The tile's rows as rendered, with the label / number / Next / note boxes for the alignment check. */
function channelOf() {
  const t = document.getElementById('mk-channels');
  const num = (s) => (s === '—' ? null : Number(String(s || '').replace(/[^\d]/g, '')));
  const rect = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, cy: (r.top + r.bottom) / 2 }; };
  const textRect = (td) => { const g = document.createRange(); g.selectNodeContents(td.firstChild || td); return rect(g); };
  const rows = [...t.querySelectorAll('tbody > tr')].map((r) => {
    const td = [...r.children];
    return {
      key: r.dataset.mkchRow, go: r.dataset.mkchGo, cls: r.className, label: td[0].querySelector('.mkch-name')?.textContent, indent: getComputedStyle(td[0]).paddingLeft,
      sched: num(td[1].textContent), waiting: num(td[2].textContent), drafts: num(td[3].textContent), next: td[4].textContent, title: r.getAttribute('title'),
      flags: [...r.querySelectorAll('[data-mkch-flag]')].map((f) => f.textContent),
      box: { name: rect(td[0].querySelector('.mkch-name') || td[0]), nums: td.slice(1, 4).map(textRect), next: textRect(td[4]), notes: [...r.querySelectorAll('[data-mkch-flag]')].map(rect), row: rect(r) }
    };
  });
  const face = t.cloneNode(true);
  return { rows, head: t.querySelector('.mko-head')?.textContent.trim(), tip: t.querySelector('.mko-title')?.getAttribute('title'), faceText: face.innerText, tileBox: rect(t) };
}

/* ---------- expected counts from the sources ---------- */

const dayOf = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const isEmail = (ch) => /Squarespace/i.test(ch || '') || (/email/i.test(ch || '') && !/Outlook/i.test(ch || ''));
const BOOKED = new Set(['scheduled', 'checking', 'late', 'sent', 'published', 'verification_unavailable', 'done']);
/** Supabase placements → the three columns: on the platform; approved by Alan (waiting for the window); else drafts. */
function dbBucket(p) {
  if (['scheduled', 'published'].includes(p.platform_state) || ['scheduled', 'published'].includes(p.stage) || p.actual_at) return 'sched';
  return /approved by alan/i.test(p.assets?.editorial?.approval || '') ? 'waiting' : 'drafts';
}
async function expectedSocial(mix) {
  const steps = new Map(mix.items.map((x) => [x.key, x]));
  const { data, error } = await sb.from('marketing_social_placements').select('step_key, placement, stage, platform_state, planned_at, actual_at, assets').eq('property_url', 'https://www.alanranger.com').limit(5000);
  if (error) throw new Error(error.message);
  const out = {};
  for (const [label, [place, re]] of Object.entries(SOCIAL)) {
    const pls = data.filter((p) => p.placement === place && steps.has(p.step_key) && p.planned_at && dayOf(p.planned_at) >= mix.window.from && dayOf(p.planned_at) <= mix.window.to);
    const c = { sched: 0, waiting: 0, drafts: 0, planned: 0, db_rows: pls.length };
    for (const p of pls) c[dbBucket(p)] += 1;
    const placed = new Set(pls.map((p) => p.step_key));
    for (const x of re ? mix.items.filter((y) => re.test(y.channel) && !placed.has(y.key)) : []) c[x.draft ? 'drafts' : 'planned'] += 1;
    out[label] = c;
  }
  return out;
}
function expectedOther(summary, board, mix) {
  const email = { sched: 0, waiting: 0, drafts: 0 };
  for (const x of mix.items.filter((y) => isEmail(y.channel))) { const k = x.draft ? 'drafts' : (x.waiting ? 'waiting' : (BOOKED.has(x.code) ? 'sched' : null)); if (k) email[k] += 1; }
  const c = summary.campaign;
  const ex = [...(c?.weeks || []).flatMap((w) => w.steps || []), ...(c?.carried?.future || [])].filter((x) => x.gbp === 'exception' && !['skipped', 'not_needed'].includes(x.state?.status) && x.day >= mix.window.from && x.day <= mix.window.to);
  const gbp = { sched: ex.filter((x) => x.state?.status === 'done').length, waiting: 0, drafts: 0 };
  const sh = (board.content || []).filter((a) => a.format === 'short_video').map((a) => ({ day: dayOf(a.release_at || a.provider?.publish_at), code: a.status?.code })).filter((a) => a.day >= mix.window.from && a.day <= mix.window.to);
  const yt = { sched: sh.filter((a) => BOOKED.has(a.code)).length, waiting: 0, drafts: sh.filter((a) => !BOOKED.has(a.code)).length };
  return { 'Squarespace email': email, 'Google Business': gbp, 'YouTube Shorts': yt };
}

/* ---------- checks ---------- */

function structureChecks(c) {
  check(`exactly 7 top-level rows in order: ${c.rows.map((r) => r.label).join(' · ')}`, c.rows.length === 7 && c.rows.every((r, i) => r.label === ORDER[i]));
  check(`first row labelled "Squarespace email" (hover "${c.rows[0]?.title?.split('\n')[0]}", filter → ${c.rows[0]?.go})`, c.rows[0]?.label === 'Squarespace email' && /Squarespace email/.test(c.rows[0]?.title || '') && c.rows[0]?.go === 'email');
  const indents = [...new Set(c.rows.map((r) => r.indent))];
  check(`no indented / sub rows (one row class "${[...new Set(c.rows.map((r) => r.cls))].join('|')}", one left padding ${indents.join('|')}, no "└")`, c.rows.every((r) => r.cls === 'mkch-r') && indents.length === 1 && !/└/.test(c.faceText));
  check(`headline "${c.head}"`, /^7 channels · next post and gaps$/.test(c.head));
  check('face: no "= content mix …" line, no grey "covered by GPT post" note', !/= content mix|covered by GPT post/.test(c.faceText));
  check('title hover explains the reconciliation (deliveries vs posts per channel)', /content mix counts campaign deliveries/.test(c.tip || '') && /this tile counts posts per channel/.test(c.tip || ''), (c.tip || '').split('\n\n')[1]?.slice(0, 160));
}
function countChecks(c, exp) {
  for (const label of ORDER) {
    const r = c.rows.find((x) => x.label === label);
    const e = exp[label];
    const plannedFlag = Number((r.flags.find((f) => /planned step/.test(f)) || '0').match(/^\d+/)?.[0] || 0);
    const ok = r.sched === e.sched && r.waiting === e.waiting && r.drafts === e.drafts && (e.planned == null || plannedFlag === e.planned);
    check(`${label}: tile ${r.sched}/${r.waiting}/${r.drafts} = source ${e.sched}/${e.waiting}/${e.drafts}${e.db_rows != null ? ` (${e.db_rows} Supabase placements)` : ''}; next ${r.next}; notes: ${r.flags.join(' · ') || 'none'}`, ok);
  }
}
function alignChecks(c) {
  const worst = c.rows.map((r) => ({ label: r.label, d: Math.max(...r.box.nums.map((b) => Math.abs(b.bottom - r.box.name.bottom)), Math.abs(r.box.next.bottom - r.box.name.bottom)), notesBelow: r.box.notes.every((n) => n.top >= r.box.name.bottom - 1 && r.box.nums.every((b) => n.top >= b.bottom - 1)) }));
  const max = Math.max(...worst.map((w) => w.d));
  check(`numbers + Next on each channel-name line: worst text-bottom offset ${max.toFixed(1)}px (${worst.map((w) => `${w.label} ${w.d.toFixed(1)}`).join(', ')})`, max <= 2);
  check('gap notes sit under the channel name, below the numbers (never pushing them)', worst.every((w) => w.notesBelow));
  check('every row\'s numbers are inside their own row box (not the row above)', c.rows.every((r) => r.box.nums.every((b) => b.top >= r.box.row.top && b.bottom <= r.box.row.bottom)));
}
function unchangedChecks(lb, la) {
  for (const b of lb.tiles.filter((t) => t.id !== 'mk-channels')) {
    const a = la.tiles.find((t) => t.title === b.title);
    check(`${b.title}: same text, x and width (${b.x}/${b.w} → ${a?.x}/${a?.w})`, a && a.text === b.text && a.x === b.x && a.w === b.w);
  }
  const shift = la.grid.h - lb.grid.h;
  const off = la.sections.filter((s) => { const b = lb.sections.find((x) => x.id === s.id); return !b || b.x !== s.x || b.w !== s.w || b.text !== s.text || Math.abs(s.y - b.y - shift) > 2; });
  check(`nothing else on the tab changed: ${la.sections.length} sections keep x, width and text, shifting by the tile area's height change only (${shift}px)`, !off.length, off.map((s) => s.id).join(', '));
}

/** Production serves the ?v= tag and exactly the committed file. */
async function liveChecks(page) {
  const tag = await page.evaluate((f) => document.querySelector(`script[src^="${f}"]`)?.getAttribute('src'), FILE);
  check(`production serves ${tag}`, tag === `${FILE}?v=${V}`);
  const clean = (t) => t.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const served = await page.evaluate(async (s) => (await fetch(s, { cache: 'no-store' })).text(), tag);
  check(`served file identical to ${COMMIT}:lib/marketing-channels-tile.js`, clean(served) === clean(execSync(`git show ${COMMIT}:lib/marketing-channels-tile.js`, { encoding: 'utf8' })));
}
async function sideBySide(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`file:///${MOCK.replace(/ /g, '%20')}`);
  const mockPng = 'outputs/_channels-tile-v1-mock.png';
  await page.locator('.t.new').screenshot({ path: mockPng });
  const img = (p) => `data:image/png;base64,${fs.readFileSync(p).toString('base64')}`;
  await page.setContent(`<body style="margin:0;background:#0b0e14;color:#d6dbe4;font:13px Segoe UI,Arial"><div style="display:flex;gap:24px;padding:16px;align-items:flex-start"><div><div style="margin-bottom:6px">APPROVED MOCK-UP channels-tile-v1 (figures indicative, 10 Nov 19:00)</div><img src="${img(mockPng)}"></div><div><div style="margin-bottom:6px">${LIVE ? `PRODUCTION ${COMMIT}` : 'LOCAL BUILD on live data'}, 1700px (${new Date().toISOString().slice(0, 16)}Z)</div><img src="${img(OUT)}"></div></div></body>`);
  await page.screenshot({ path: SIDE, fullPage: true });
  await ctx.close();
}

const before = await dbState();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
log(LIVE ? `before: production with ${COMMIT}~1's tile file` : 'before: production as served');
const a = await render(browser, false);
const lb = await a.page.evaluate(layoutOf);
await a.ctx.close();
log(LIVE ? 'after: production as deployed' : 'after: local tile file');
const b = await render(browser, true);
if (LIVE) await liveChecks(b.page);
const la = await b.page.evaluate(layoutOf);
const c = await b.page.evaluate(channelOf);
const src = await b.page.evaluate(async () => ({ summary: await (await fetch('/api/aigeo/strategy-summary')).json(), board: await window.mkLoadDeliveryStatus(false) }));
await b.page.locator('#mk-channels').screenshot({ path: OUT });
await b.page.locator('#mk-overview-tiles .mko-grid').screenshot({ path: `outputs/channel-tile-7rows-overview-${TAG}-1700px-20261110.png` });
await b.ctx.close();
log('checks');
const mix = src.summary.quarter_plan.purpose_mix;
const exp = { ...(await expectedSocial(mix)), ...expectedOther(src.summary, src.board, mix) };
structureChecks(c);
countChecks(c, exp);
alignChecks(c);
unchangedChecks(lb, la);
await sideBySide(browser);
await browser.close();
const after = await dbState();
const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
check('viewing writes nothing (row counts + newest timestamps)', !changed.length, changed.map((k) => `${k}: ${before[k]} → ${after[k]}`).join(' | ') || `${Object.keys(TABLES).length} tables unchanged`);
check('every non-GET refused', true, `${refused.length} refused: ${[...new Set(refused)].join(', ') || 'none attempted'}`);
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
fs.writeFileSync(`outputs/_channel-tile-7rows-${TAG}-result.json`, JSON.stringify({ results, channel: c, expected: exp, window: mix.window, mix: { deliveries: mix.deliveries, drafts: mix.draft?.deliveries, covered: mix.covered?.length, superseded: mix.superseded?.length }, before: lb, after: la }, null, 1));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);
console.log(path.resolve(OUT), path.resolve(SIDE));
process.exit(0);

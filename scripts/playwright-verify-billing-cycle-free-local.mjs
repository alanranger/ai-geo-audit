/**
 * QUESTION-2026-11-11 billing-cycle-tile-reserves-and-free-to-spend, LOCAL code on LIVE data, 1700px, read-only.
 * "Before" = production as served; "after" = production with lib/marketing-sqs-cycles.js and lib/marketing-delivery.js
 * served from this folder and ?action=overview answered in-process by the local server code (lib/marketing/overview.mjs,
 * same Supabase reads the API makes). Expected figures come from sqs_scheduled_emails + business_targets directly.
 * Non-GET refused.   node scripts/playwright-verify-billing-cycle-free-local.mjs      (PHASE=live: production after deploy)
 */
import fs from 'node:fs';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { overview } from '../lib/marketing/overview.mjs';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
const BASE = 'https://ai-geo-audit.vercel.app';
const LIVE = process.env.PHASE === 'live';
const TAG = LIVE ? 'live' : 'local';
const FILES = ['/lib/marketing-sqs-cycles.js', '/lib/marketing-delivery.js', '/lib/marketing-tab.js'];
const TABLES = { strategy_campaigns: 'updated_at', sqs_scheduled_emails: 'collected_at', marketing_segment_exports: 'created_at', business_targets: 'updated_at' };
const RESET = '2026-11-12T12:51:47.184Z';
const BOUNDS = [[RESET, '2026-12-12T12:51:47.184Z'], ['2026-12-12T12:51:47.184Z', '2027-01-12T12:51:47.184Z'], ['2027-01-12T12:51:47.184Z', '2027-02-12T12:51:47.184Z']];
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const refused = [];
const errors = [];
let localOverview = null;

async function dbState() {
  const out = {};
  for (const [t, c] of Object.entries(TABLES)) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true });
    const { data } = await sb.from(t).select(c).not(c, 'is', null).order(c, { ascending: false }).limit(1);
    Object.assign(out, { [`${t}.rows`]: count ?? 'n/a', [`${t}.max`]: data?.[0]?.[c] || null });
  }
  return out;
}
async function overviewBody() {
  if (!localOverview) localOverview = JSON.stringify({ ok: true, ...(await overview(sb, {})) });
  return localOverview;
}
function makeRoute(mode) {
  return async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    if (req.method() !== 'GET') { refused.push(`${req.method()} ${url.pathname}`); return r.fulfill({ status: 403, contentType: 'application/json', body: '{"ok":false}' }); }
    if (mode === 'before' || LIVE) return r.fallback();
    if (FILES.includes(url.pathname)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`.${url.pathname}`, 'utf8') });
    if (url.pathname === '/api/aigeo/marketing' && url.searchParams.get('action') === 'overview') return r.fulfill({ status: 200, contentType: 'application/json', body: await overviewBody() });
    return r.fallback();
  };
}
async function render(browser, mode) {
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1200 } });
  await ctx.addInitScript((k) => sessionStorage.setItem('arp_admin_key', k), ENV.ARP_ADMIN_KEY);
  await ctx.route('**/*', makeRoute(mode));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${mode}: ${e.message}`));
  await page.goto(`${BASE}/audit-dashboard.html#marketing`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#mk-sqs-cycles [data-mkc-col]') && document.querySelector('#mk-overview-tiles .mko-mix'), null, { timeout: 240000 });
  await page.waitForSelector('#mk-social .mksoc-g', { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(4000);
  await page.addStyleTag({ content: '#debugPanel { display: none !important; }' });
  return { ctx, page };
}

function snap() {
  const num = (s) => (s == null || /—/.test(s) ? null : Number(String(s).replace('−', '-').replace(/[^\d-]/g, '')));
  const norm = (t) => (t || '').replace(/\b\d{1,2}:\d{2}\b/g, 'HH:MM').replace(/\(\d+(\.\d+)? h ago\)/g, '(N h ago)').replace(/\d+ days? left|\d+ h left/g, 'N left').replace(/\s+/g, ' ').trim();
  const t = document.getElementById('mk-sqs-cycles');
  const cols = [...t.querySelectorAll('[data-mkc-col]')].map((c) => ({
    head: c.querySelector('.mkc-h')?.textContent,
    rows: [...c.querySelectorAll('.mkc-e')].map((r) => ({ key: r.dataset.mkcOpen, tag: r.dataset.mkcTag, n: num(r.querySelector('.mkc-n')?.textContent) })),
    total_label: c.querySelector('[data-mkc-total] span')?.textContent, total: num(c.querySelector('[data-mkc-total] b')?.textContent),
    lines: [...c.querySelectorAll('[data-mkc-line]')].map((l) => ({ key: l.dataset.mkcLine, label: l.querySelector('span')?.textContent, value: num(l.querySelector('b')?.textContent), tip: l.getAttribute('title') || '' })),
    free: c.querySelector('[data-mkc-free]') ? { label: c.querySelector('[data-mkc-free] span')?.textContent, value: num(c.querySelector('[data-mkc-free] span:last-child')?.textContent), neg: c.querySelector('[data-mkc-free]').classList.contains('neg'), tip: c.querySelector('[data-mkc-free]').getAttribute('title') || '' } : null,
    left_label: c.querySelector('[data-mkc-left] span')?.textContent, left: num(c.querySelector('[data-mkc-left] span:last-child')?.textContent),
    drafts_line: c.querySelector('[data-mkc-left-drafts]')?.textContent || null,
    order: [...c.querySelectorAll('[data-mkc-line], [data-mkc-free]')].map((l) => l.dataset.mkcLine || 'free')
  }));
  const af = t.querySelector('[data-mkc-after-free]');
  const tiles = [...document.querySelectorAll('#mk-overview-tiles .mko-grid > .mko-tile')].map((x) => { const r = x.getBoundingClientRect(); return { n: x.querySelector('.mko-num')?.textContent || 'cyc', x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), text: norm(x.innerText) }; });
  const cap = [...document.querySelectorAll('#mk-overview-tiles .mko-tile')].find((x) => x.querySelector('.mko-num')?.textContent === '8');
  const capRows = cap ? [...cap.querySelectorAll('.mkd-kv tr')].map((tr) => ({ label: tr.cells[0]?.textContent, value: norm(tr.cells[1]?.textContent), tip: tr.getAttribute('title') })) : [];
  const top = document.getElementById('marketing-root').getBoundingClientRect().top;
  const sections = [...document.querySelectorAll('#marketing-root > *, #marketing-root .rt-section[id]')].filter((el) => el.id && el.offsetParent !== null && el.id !== 'mk-overview-tiles').map((el) => { const r = el.getBoundingClientRect(); return { id: el.id, x: Math.round(r.x), y: Math.round(r.y - top), w: Math.round(r.width) }; });
  const settings = [...document.querySelectorAll('#mk-settings [data-mk-set]')].map((el) => [el.dataset.mkSet, el.value]);
  return { cols, after_free: af ? { value: Number(af.dataset.mkcAfterFree), text: af.textContent, tip: af.getAttribute('title') } : null, tiles, cap_rows: capRows, sections, settings };
}

async function expected() {
  const { data: s } = await sb.from('sqs_scheduled_emails').select('scheduled_for, recipients, campaign_key').eq('state', 'scheduled');
  const { data: bt } = await sb.from('business_targets').select('id, effective_from, campaign_targets').eq('property_url', 'https://www.alanranger.com').order('effective_from', { ascending: false }).limit(1);
  const e = bt?.[0]?.campaign_targets?.email || {};
  const ll = Number(e.light_and_logic_budget_sends);
  const adhoc = Number(e.adhoc_reserve_sends);
  const cycles = BOUNDS.map(([a, b]) => {
    const rows = s.filter((x) => Date.parse(x.scheduled_for) >= Date.parse(a) && Date.parse(x.scheduled_for) < Date.parse(b));
    const sched = rows.reduce((t, x) => t + x.recipients, 0);
    const llSched = rows.some((x) => /light-and-logic-email/.test(x.campaign_key || ''));
    return { n: rows.length, sched, ll: llSched ? 0 : ll, adhoc, free: 5000 - sched - (llSched ? 0 : ll) - adhoc };
  });
  return { row: bt?.[0]?.id, ll, adhoc, note: e.email_budget_note, cycles };
}
const n = (v) => Number(v).toLocaleString('en-GB');
function lineChecks(c, e, x) {
  const v = Object.fromEntries(c.lines.map((l) => [l.key, l.value]));
    check(`${c.head}: lines in order Scheduled → Light & Logic (planned) → Kept back for ad-hoc → Free for new campaigns`, JSON.stringify(c.order.filter((k) => k !== 'frozen')) === JSON.stringify(['scheduled', 'll', 'adhoc', 'free']), c.order.join(' → '));
    check(`${c.head}: Scheduled emails ${v.scheduled} = sqs_scheduled_emails ${e.sched} (${e.n} emails, provider-scheduled only)`, v.scheduled === e.sched && c.lines[0].label === `Scheduled emails (${e.n})`, c.lines[0].label);
    check(`${c.head}: Light & Logic (planned) ${v.ll} · ad-hoc ${v.adhoc} (Targets settings row ${x.row}: ${x.ll} / ${x.adhoc})`, v.ll === e.ll && v.adhoc === e.adhoc);
    check(`${c.head}: Free for new campaigns ${c.free?.value} = 5,000 − ${n(e.sched)} − ${e.ll} − ${e.adhoc} = ${n(e.free)}${c.free?.neg ? ' (red)' : ''}`, c.free?.label === 'Free for new campaigns' && c.free.value === e.free && c.free.neg === (e.free < 0));
    check(`${c.head}: every line has a hover`, c.lines.every((l) => l.tip.length > 20) && c.free?.tip.length > 20, c.lines.map((l) => `${l.key}: ${l.tip.slice(0, 70)}`).join(' | '));
}
function futureChecks(a, x) {
  [1, 2].forEach((i) => {
    const c = a.cols[i];
    lineChecks(c, x.cycles[i - 1], x);
    const llRows = c.rows.filter((r) => /light-and-logic-email/.test(r.key || ''));
    check(`${c.head}: Light & Logic rows ${llRows.map((r) => `${r.tag} ${r.n}`).join(', ') || 'none'} (PLANNED, costed at the 700 budget, once)`, llRows.length > 0 && llRows.every((r) => (r.tag === 'PLANNED' && r.n === x.ll) || r.tag === 'SCHED'));
    const m = /^(\d+) scheduled · (\d+) planned · (\d+) drafts?$/.exec(c.total_label || '');
    check(`${c.head}: counts line "${c.total_label}" matches the rows`, !!m && Number(m[1]) === c.rows.filter((r) => ['SCHED', 'FROZEN', 'SENT'].includes(r.tag)).length && Number(m[2]) === c.rows.filter((r) => r.tag === 'PLANNED').length);
  });
  const e3 = x.cycles[2];
  check(`after-cycle footnote: "${a.after_free?.text}" = 5,000 − ${n(e3.sched)} − ${e3.ll} − ${e3.adhoc} = ${n(e3.free)}`, a.after_free?.value === e3.free);
}
function capacityChecks(b, a) {
  const next = a.cap_rows.find((r) => /^Next cycle/.test(r.label || ''));
  const free = a.cols[1].free?.value;
  check(`Email capacity tile next-cycle line "${next?.value}" uses the tile's Free for new campaigns ${n(free)}`, !!next && next.value.startsWith(`${n(free)} free for new campaigns`));
  const other = (rows) => rows.filter((r) => !/^Next cycle/.test(r.label || '')).map((r) => `${r.label}=${r.value}`).join(' | ');
  if (b) check('Email capacity tile: every other line unchanged', other(b.cap_rows) === other(a.cap_rows), other(a.cap_rows).slice(0, 200));
}
function settingsChecks(b, a, x) {
  const s = Object.fromEntries(a.settings);
  check(`Marketing settings: Light & Logic budget ${s['email.light_and_logic_budget_sends']} · ad-hoc ${s['email.adhoc_reserve_sends']} editable (saved with a dated history row)`, s['email.light_and_logic_budget_sends'] === String(x.ll) && s['email.adhoc_reserve_sends'] === String(x.adhoc));
  const old = (rows) => JSON.stringify(rows.filter(([k]) => !/_budget_sends|adhoc_reserve/.test(k)));
  if (b) check('Marketing settings: the existing inputs unchanged', old(b.settings) === old(a.settings), old(a.settings));
}
function unchangedChecks(b, a) {
  const c0 = (s) => JSON.stringify({ rows: s.cols[0].rows, total: s.cols[0].total, left: s.cols[0].left, label: s.cols[0].left_label, lines: s.cols[0].lines.length, free: s.cols[0].free });
  check(`"This cycle" column unchanged (no reserve deduction): ${a.cols[0].left_label} ${a.cols[0].left}`, c0(b) === c0(a));
  const diff = a.tiles.filter((t) => { const x = b.tiles.find((y) => y.n === t.n); return !x || x.x !== t.x || x.w !== t.w || (!['cyc', '8'].includes(t.n) && x.text !== t.text); }).map((t) => t.n);
  check('other tiles unchanged (positions, widths; text of all but the cycle tile and the capacity tile)', !diff.length, diff.join(', '));
  const off = a.sections.filter((s) => { const x = b.sections.find((y) => y.id === s.id); return !x || x.x !== s.x || x.w !== s.w; });
  check(`no section moved sideways or changed width (${a.sections.length} sections)`, !off.length, off.map((s) => s.id).join(', '));
  const dy = a.sections.map((s) => s.y - (b.sections.find((y) => y.id === s.id)?.y ?? s.y)).filter((d) => d);
  check('vertical shift below the tiles (taller footer only)', true, dy.length ? `${[...new Set(dy)].join(', ')} px` : 'none');
}

const before = await dbState();
const x = await expected();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const out = {};
for (const mode of LIVE ? ['after'] : ['before', 'after']) {
  const r = await render(browser, mode);
  out[mode] = await r.page.evaluate(snap);
  await r.page.locator('#mk-sqs-cycles').screenshot({ path: `outputs/billing-cycle-free-${mode}-${TAG}-1700px-20261111.png` });
  if (mode === 'after') await r.page.locator('#mk-overview-tiles .mko-grid').screenshot({ path: `outputs/billing-cycle-free-overview-${TAG}-1700px-20261111.png` });
  await r.ctx.close();
}
await browser.close();
futureChecks(out.after, x);
capacityChecks(out.before, out.after);
settingsChecks(out.before, out.after, x);
if (!LIVE) unchangedChecks(out.before, out.after);
const after = await dbState();
const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
check('viewing writes nothing (row counts + newest timestamps)', !changed.length, changed.map((k) => `${k}: ${before[k]} → ${after[k]}`).join(' | ') || `${Object.keys(TABLES).length} tables unchanged`);
check('every non-GET refused', true, `${refused.length} refused${refused.length ? `: ${[...new Set(refused)].slice(0, 4).join(', ')}` : ''}`);
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
fs.writeFileSync(`outputs/_billing-cycle-free-${TAG}-result.json`, JSON.stringify({ expected: x, results, out }, null, 1));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);
process.exit(0);

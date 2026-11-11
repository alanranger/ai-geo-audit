/**
 * QUESTION-2026-11-11 billing-cycle-tile-draft-counts-and-unknown-audiences, LOCAL browser code on LIVE data, 1700px,
 * read-only. "Before" = production as served; "after" = production with lib/marketing-sqs-cycles.js,
 * lib/marketing-overview-tiles.js and lib/marketing-channels-tile.js served from this folder; "simulated" = after, with
 * ONE future email turned into a draft with no audience in memory only (to show the "not costed" rule, which today's
 * data doesn't trigger). Expected per-cycle recipients come from sqs_scheduled_emails directly. Non-GET refused.
 *   node scripts/playwright-verify-billing-cycle-costed-local.mjs      (PHASE=live: production after deploy)
 */
import fs from 'node:fs';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
const BASE = 'https://ai-geo-audit.vercel.app';
const LIVE = process.env.PHASE === 'live';
const TAG = LIVE ? 'live' : 'local';
const FILES = ['/lib/marketing-sqs-cycles.js', '/lib/marketing-overview-tiles.js', '/lib/marketing-channels-tile.js'];
const SIM_KEY = 'theme|gpt-8w-academy-2026-12-01';
const TABLES = { strategy_campaigns: 'updated_at', sqs_scheduled_emails: 'collected_at', marketing_segment_exports: 'created_at' };
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
/** In memory only: the 1 Dec Academy email as a draft with no audience (no schedule, no amount). */
function simulate(body) {
  const j = JSON.parse(body);
  const d = (j.meter?.deliveries || []).find((x) => x.campaign_key === SIM_KEY);
  if (d) Object.assign(d, { bucket: 'draft', amount: null, audience: null, provider: null, operator: null, snapshot: null, record_stage: 'drafted', stage: 'unbudgeted', estimate: null, aud: null });
  return JSON.stringify(j);
}
function makeRoute(mode) {
  return async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    if (req.method() !== 'GET') { refused.push(`${req.method()} ${url.pathname}`); return r.fulfill({ status: 403, contentType: 'application/json', body: '{"ok":false}' }); }
    if (mode === 'before') return r.fallback();
    if (!LIVE && FILES.includes(url.pathname)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`.${url.pathname}`, 'utf8') });
    if (mode === 'simulated' && url.pathname === '/api/aigeo/marketing' && url.searchParams.get('action') === 'overview') { const res = await r.fetch(); return r.fulfill({ response: res, body: simulate(await res.text()) }); }
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
  await page.waitForFunction(() => document.querySelector('#mk-sqs-cycles') && document.querySelector('#mk-channels') && document.querySelector('#mk-overview-tiles .mko-mix'), null, { timeout: 240000 });
  await page.waitForSelector('#mk-social .mksoc-g', { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(4000);
  await page.addStyleTag({ content: '#debugPanel { display: none !important; }' });
  return { ctx, page };
}

function snap() {
  const num = (s) => (s == null || /—/.test(s) ? null : Number(String(s).replace(/[^\d−-]/g, '').replace('−', '-')));
  const norm = (t) => (t || '').replace(/\b\d{1,2}:\d{2}\b/g, 'HH:MM').replace(/\(\d+(\.\d+)? h ago\)/g, '(N h ago)').replace(/\d+ days? left|\d+ h left/g, 'N left').replace(/\s+/g, ' ').trim();
  const t = document.getElementById('mk-sqs-cycles');
  const cols = [...t.querySelectorAll('[data-mkc-col]')].map((c) => ({
    head: c.querySelector('.mkc-h')?.textContent, sub: c.querySelector('.mkc-d')?.textContent,
    rows: [...c.querySelectorAll('.mkc-e')].map((r) => ({ key: r.dataset.mkcOpen, tag: r.dataset.mkcTag, n: num(r.querySelector('.mkc-n')?.textContent), at: r.querySelector('.mkc-dt')?.textContent })),
    total_label: c.querySelector('[data-mkc-total] span')?.textContent, total: num(c.querySelector('[data-mkc-total] b')?.textContent),
    uncosted: c.querySelector('[data-mkc-uncosted]')?.textContent || null,
    left_label: c.querySelector('[data-mkc-left] span')?.textContent, left: num(c.querySelector('[data-mkc-left] span:last-child')?.textContent),
    drafts_line: c.querySelector('[data-mkc-left-drafts] span')?.textContent || null
  }));
  const tiles = [...document.querySelectorAll('#mk-overview-tiles .mko-grid > .mko-tile')].map((x) => { const r = x.getBoundingClientRect(); return { n: x.querySelector('.mko-num')?.textContent || 'cyc', x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), text: norm(x.innerText) }; });
  const mix = [...document.querySelectorAll('#mk-overview-tiles .mko-tile')].find((x) => /content mix/.test(x.textContent));
  const top = document.getElementById('marketing-root').getBoundingClientRect().top;
  const sections = [...document.querySelectorAll('#marketing-root > *, #marketing-root .rt-section[id]')].filter((el) => el.id && el.offsetParent !== null && el.id !== 'mk-overview-tiles').map((el) => { const r = el.getBoundingClientRect(); return { id: el.id, x: Math.round(r.x), y: Math.round(r.y - top), w: Math.round(r.width) }; });
  return {
    cols, outside: [...t.querySelectorAll('[data-mkc-outside]')].map((o) => ({ text: o.textContent, tip: o.getAttribute('title') })), tiles, sections,
    mix_tips: [mix.querySelector('.mko-chip')?.getAttribute('title'), ...[...mix.querySelectorAll('.mko-bar, .mko-seg')].map((e) => e.getAttribute('title'))].filter(Boolean).join(' | ') + ' | ' + [...mix.querySelectorAll('.mko-det li')].map((li) => li.textContent).join(' | '),
    channel_tip: document.querySelector('#mk-channels .mko-title')?.getAttribute('title') || ''
  };
}

const RESERVED = new Set(['SCHED', 'FROZEN', 'SENT']);
function columnChecks(s, label) {
  for (const c of s.cols) {
    const sched = c.rows.filter((r) => RESERVED.has(r.tag)).length;
    const drafts = c.rows.length - sched;
    const noAud = c.rows.filter((r) => r.n == null).length;
    const m = /^(\d+) scheduled · (\d+) drafts?$/.exec(c.total_label || '');
    const countOk = c.head === 'This cycle' ? true : !!m && Number(m[1]) === sched && Number(m[2]) === drafts;
    check(`${label} · ${c.head}: footer "${c.total_label}" = rows shown (${sched} reserved + ${drafts} drafts)${noAud ? ` · "${c.uncosted}"` : ''}`, countOk && (!noAud || new RegExp(`^${noAud} drafts? without an audience yet \\(not costed\\)`).test(c.uncosted || '')));
    const expectLabel = c.head === 'This cycle' ? 'Left after these' : (noAud ? 'Left after costed sends' : 'Left if all go');
    const costed = c.rows.reduce((t, r) => t + (r.n || 0), 0);
    const totalOk = c.head === 'This cycle' ? c.total === c.rows.filter((r) => RESERVED.has(r.tag)).reduce((t, r) => t + (r.n || 0), 0) : c.total === costed && c.left === 5000 - costed;
    check(`${label} · ${c.head}: "${c.left_label}" ${c.left} (costed total ${c.total}${noAud ? `, ${noAud} not costed` : ''})${c.drafts_line ? ` · drafts line "${c.drafts_line}"` : ''}`, c.left_label === expectLabel && totalOk);
  }
}
async function dbChecks(s) {
  const { data } = await sb.from('sqs_scheduled_emails').select('email_id, campaign_key, scheduled_for, recipients').eq('state', 'scheduled');
  const shownSched = s.cols.flatMap((c) => c.rows.filter((r) => r.tag === 'SCHED'));
  const beyond = (s.outside.find((o) => /after these three cycles/.test(o.text))?.tip || '').split('\n').filter((l) => / · SCHED · /.test(l));
  check(`all ${data.length} Squarespace scheduled emails accounted for: ${shownSched.length} in the three cycles + ${beyond.length} after them`, shownSched.length + beyond.length === data.length, s.outside.map((o) => o.text).join(' | '));
  const reset = Date.parse('2026-11-12T12:51:47.184Z');
  const bounds = [[0, reset], [reset, Date.parse('2026-12-12T12:51:47.184Z')], [Date.parse('2026-12-12T12:51:47.184Z'), Date.parse('2027-01-12T12:51:47.184Z')]];
  bounds.forEach(([a, b], i) => {
    const db = data.filter((x) => Date.parse(x.scheduled_for) >= a && Date.parse(x.scheduled_for) < b).reduce((t, x) => t + x.recipients, 0);
    const tile = s.cols[i].rows.filter((r) => r.tag === 'SCHED').reduce((t, r) => t + r.n, 0);
    check(`${s.cols[i].head}: SCHED recipients on the tile ${tile} = sqs_scheduled_emails ${db} (real recipient counts)`, tile === db);
  });
}
function unchangedChecks(b, a) {
  const diff = a.tiles.filter((t) => { const x = b.tiles.find((y) => y.n === t.n); return !x || x.x !== t.x || x.y !== t.y || x.w !== t.w || (t.n !== 'cyc' && t.n !== '6b' && x.text !== t.text); }).map((t) => t.n);
  check(`other tiles unchanged (positions, widths; text of 6, 7, 8, 9, 10)`, !diff.length, diff.join(', '));
  const off = a.sections.filter((s) => { const x = b.sections.find((y) => y.id === s.id); return !x || x.x !== s.x || x.w !== s.w || x.y !== s.y; });
  check(`nothing else moved (${a.sections.length} sections)`, !off.length, off.map((s) => s.id).join(', '));
  check('content-mix tooltips say "Draft / in preparation", never "not approved"', /Draft \/ in preparation/.test(a.mix_tips) && !/not approved/.test(a.mix_tips), a.mix_tips.slice(0, 160));
  check('by-channel tile hover: "Drafts = draft / in preparation" with editorial and audience approval kept separate', /Drafts = draft \/ in preparation: not yet scheduled on the platform \(editorial approval and audience approval are tracked separately\)/.test(a.channel_tip) && !/not approved/.test(a.channel_tip));
}

const before = await dbState();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const out = {};
for (const mode of LIVE ? ['after', 'simulated'] : ['before', 'after', 'simulated']) {
  const r = await render(browser, mode);
  out[mode] = await r.page.evaluate(snap);
  await r.page.locator('#mk-sqs-cycles').screenshot({ path: `outputs/billing-cycle-costed-${mode}-${TAG}-1700px-20261111.png` });
  if (mode === 'after') await r.page.locator('#mk-overview-tiles .mko-grid').screenshot({ path: `outputs/billing-cycle-costed-overview-${TAG}-1700px-20261111.png` });
  await r.ctx.close();
}
await browser.close();
columnChecks(out.after, 'live');
await dbChecks(out.after);
columnChecks(out.simulated, 'simulated (1 Dec as a draft with no audience, in memory)');
const sim = out.simulated.cols[1];
check(`simulated: Next cycle shows "Left after costed sends" and "1 draft without an audience yet (not costed)"; no size invented for it`, sim.left_label === 'Left after costed sends' && /^1 draft without an audience yet \(not costed\)/.test(sim.uncosted || '') && sim.rows.find((r) => r.key === SIM_KEY)?.n == null);
if (!LIVE) unchangedChecks(out.before, out.after);
else unchangedChecks(out.after, out.after);
const after = await dbState();
const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
check('viewing writes nothing (row counts + newest timestamps)', !changed.length, changed.map((k) => `${k}: ${before[k]} → ${after[k]}`).join(' | ') || `${Object.keys(TABLES).length} tables unchanged`);
check('every non-GET refused', true, `${refused.length} refused`);
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
fs.writeFileSync(`outputs/_billing-cycle-costed-${TAG}-result.json`, JSON.stringify({ results, out }, null, 1));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);
process.exit(0);

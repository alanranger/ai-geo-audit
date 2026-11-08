/**
 * Live check for QUESTION-2026-11-08-alan-decisions-exception-snapshots-plansheet-lakedistrict (production, 1700px).
 * Read-only in the browser: every non-GET from the page is refused; DB row counts + newest timestamps compared before /
 * after viewing. Then ONE manual PATCH tick on the plan-sheet action (must be 409) with the row re-read, and the
 * engaged-group freeze as a dry run (no snapshot is created).
 *   node scripts/playwright-verify-decisions-live.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
Object.assign(process.env, { SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: ENV.SUPABASE_SERVICE_ROLE_KEY });
const BASE = process.env.DASH_BASE || 'https://ai-geo-audit.vercel.app';
const OUT = path.resolve('outputs');
const STAMP = '20261108';
const BLUR = '#mk-review-table td:first-child, #mk-cust-body, .mk-detail, #mk-cleanup table td.left, #mk-query table td:first-child, #mk-client-health table td:first-child, #mk-exp-review, #mk-snap-review { filter: blur(6px) !important; }';
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const blocked = [];
const errors = [];
const TABLES = {
  strategy_quarter_actions: 'updated_at', strategy_campaign_steps: 'last_seen_at', strategy_campaign_ticks: 'updated_at', strategy_campaigns: 'updated_at', sqs_send_meter: 'captured_at',
  marketing_frequency_exceptions: 'set_at', marketing_segment_exports: 'created_at', marketing_event_facts: 'set_at', marketing_social_placements: 'set_at', strategy_event_snapshots: 'created_at'
};
const AFTER_ROW = { is_ticked: false, ticked_at: null, updated_at: '2026-11-08T12:14:54.428+00:00', status: 'waiting', waiting_on: 'next qualifying beginners course last night', due_week_start: '2026-10-26', label: 'Last-night plan sheet + 7-day follow-up email' };

async function dbState() {
  const out = {};
  for (const [t, c] of Object.entries(TABLES)) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true });
    const { data, error } = await sb.from(t).select(c).not(c, 'is', null).order(c, { ascending: false }).limit(1);
    Object.assign(out, { [`${t}.rows`]: count, [`${t}.max(${c})`]: error ? 'n/a' : data?.[0]?.[c] || null });
  }
  return out;
}
const planRow = async () => (await sb.from('strategy_quarter_actions').select('*').eq('action_key', 'q1-plan-sheet').single()).data;
const rowDiff = (row) => Object.keys(AFTER_ROW).filter((k) => JSON.stringify(row[k]) !== JSON.stringify(AFTER_ROW[k]));

async function open(browser, hash, ready) {
  const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
  const cap = {};
  page.on('pageerror', (e) => errors.push(`${hash}: ${e.message}`));
  page.on('response', async (r) => {
    if (/\/api\/aigeo\/strategy-summary/.test(r.url())) cap.s = await r.json().catch(() => cap.s);
    if (/\/api\/aigeo\/social-standard\?view=all/.test(r.url())) cap.x = await r.json().catch(() => cap.x);
  });
  await page.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); localStorage.setItem('mks-view', 'weeks'); }, ENV.ARP_ADMIN_KEY);
  await page.route('**/api/**', (route) => {
    if (route.request().method() === 'GET') return route.fallback();
    blocked.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' });
  });
  await page.goto(`${BASE}/audit-dashboard.html#${hash}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(ready, null, { timeout: 180000 });
  await page.waitForTimeout(5000);
  await page.addStyleTag({ content: BLUR });
  return { page, cap };
}
const rowOf = (page, week) => page.locator('#mk-schedule .mks-weeks tr', { has: page.locator(`[data-mks-week="${week}"]`) });
function findKey(x, key) {
  if (!x || typeof x !== 'object') return null;
  if (x.event_id === key) return x;
  for (const v of Object.values(x)) { const hit = findKey(v, key); if (hit) return hit; }
  return null;
}

async function marketing(browser) {
  const { page, cap } = await open(browser, 'marketing', () => document.querySelector('#mks-facts-check') && document.querySelector('#mk-schedule .mks-weeks') && !/Loading the week plan/.test(document.querySelector('#mk-schedule').textContent) && document.querySelector('#mk-exp-table'));
  const need = (await page.locator('#mk-schedule .mks-need').innerText()).replace(/\s+/g, ' ');
  check('1: "Needs you" no longer shows the 3-email client', !/3\+? emails|without an approved exception|per-person|frequency/i.test(need), need.slice(0, 220));
  const em = rowOf(page, '2026-11-09').locator('td.mks-em');
  const emText = (await em.innerText()).replace(/\s+/g, ' ');
  const amber = await em.locator('small').evaluateAll((els) => els.map((e) => e.className).join(' '));
  check('1: w/c 9 Nov per person: all 39 three-email people approved, not amber', /39×3 \(approved\)/.test(emText) && !/not approved|unapproved/.test(emText) && !/amber|red/.test(amber), `${emText} · class: ${amber || '—'}`);
  await page.locator('#mk-schedule').screenshot({ path: `${OUT}/decisions-needs-you-weeks-live-1700px-${STAMP}.png` });
  await page.evaluate(() => { document.querySelector('#mks-facts-check').open = true; });
  const facts = (await page.locator('#mks-facts-check').innerText()).replace(/\s+/g, ' ');
  const ld = findKey(cap.x, 'lake-district-2027-01-22');
  check('4: Lake District facts £1,075 confirmed, no contradiction flag', ld && ld.price?.live === 1075 && ld.price?.claims?.length === 1 && ld.price.claims[0].gbp === 1075 && !(ld.contradictions || []).length && !/1,195|Lake District[^·]*Price/i.test(facts), `live ${ld?.price?.live} · claims ${JSON.stringify((ld?.price?.claims || []).map((c) => c.gbp))} · contradictions ${(ld?.contradictions || []).length} · facts check: ${facts.slice(0, 160)}`);
  await page.locator('#mks-facts-check').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/decisions-facts-check-live-1700px-${STAMP}.png` });
  await page.evaluate(() => { const t = document.querySelector('#mk-exp-table'); let d = t; while (d) { if (d.tagName === 'DETAILS') d.open = true; d = d.parentElement; } });
  const preFix = await page.locator('#mk-exp-table').evaluate((t) => ({ rows: t.querySelectorAll('tbody tr').length, prefix: [...t.querySelectorAll('tbody tr')].filter((r) => /pre-fix snapshot/.test(r.textContent)).length }));
  check('2: snapshot list labels older snapshots "pre-fix"', preFix.prefix > 0 && preFix.prefix === preFix.rows, `${preFix.prefix} of ${preFix.rows} listed snapshots labelled pre-fix (none frozen with the new rule yet)`);
  await page.locator('#mk-exports').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/decisions-snapshots-prefix-live-1700px-${STAMP}.png` });
  await page.close();
}

async function strategy(browser) {
  const { page, cap } = await open(browser, 'strategy', () => [...document.querySelectorAll('h3')].some((h) => /Next campaign/.test(h.textContent)) && /plan sheet/i.test(document.body.textContent));
  const a = (cap.s?.actions || []).find((x) => x.action_key === 'q1-plan-sheet');
  const dom = await page.evaluate(() => [...document.querySelectorAll('tr, li, .qp-row, div')].filter((e) => e.children.length < 14 && /Last-night plan sheet/i.test(e.textContent) && e.textContent.length < 500).map((e) => ({ t: e.textContent.replace(/\s+/g, ' ').trim(), checked: !!e.querySelector('input[type=checkbox]:checked') })));
  const shown = dom.sort((x, y) => x.t.length - y.t.length)[0] || { t: '', checked: false };
  check('3: plan-sheet action unticked, waiting on evidence (Strategy tab)', a && a.is_ticked === false && a.evidence?.rule === 'plan-sheet-follow-up' && a.evidence?.state === 'waiting' && !dom.some((d) => d.checked) && /waiting/i.test(dom.map((d) => d.t).join(' ')), `summary: ticked ${a?.is_ticked}, evidence ${a?.evidence?.state} · DOM: ${shown.t.slice(0, 180)}`);
  await page.locator('text=Last-night plan sheet').first().scrollIntoViewIfNeeded().catch(() => {});
  await page.screenshot({ path: `${OUT}/decisions-strategy-plansheet-live-1700px-${STAMP}.png` });
  await page.close();
  return a;
}

async function freezeDryRun() {
  const { allSegments, evalCtx, loadPeople, withParams } = await import('../lib/marketing/overview.mjs');
  const { evaluate } = await import('../lib/marketing/segments.mjs');
  const { freezeSet } = await import('../lib/marketing/exports.mjs');
  const seg = (await allSegments(sb)).find((s) => s.segment_id === 'gpt-8w-engaged-review');
  const r = evaluate(await loadPeople(sb), [withParams(seg.definition, {})], await evalCtx(sb, {}), { includeOwner: true });
  const f = freezeSet(r);
  check('2: freeze of engaged (dry run, ec377f4c code, no snapshot created) = 543 people + 1 business copy = 544', f.people === 543 && f.members.length === 544, `old rule ${r.members.length} · new ${f.people} + ${f.business_copy_ids.length} = ${f.members.length} · left out ${JSON.stringify(f.left_out)}`);
}

const before = await dbState();
const rowBefore = await planRow();
check('3: DB row unchanged from the "after" row before the test', !rowDiff(rowBefore).length, rowDiff(rowBefore).join(', ') || 'identical');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
await marketing(browser);
const live = await strategy(browser);
await browser.close();
const after = await dbState();
const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
check('viewing writes nothing (row counts + newest timestamps, 10 tables)', !changed.length, changed.map((k) => `${k}: ${before[k]} → ${after[k]}`).join(' | ') || 'no change');
check('every non-GET from the page refused', true, `${blocked.length} refused: ${[...new Set(blocked)].join(', ')}`);
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
if (live?.evidence?.rule === 'plan-sheet-follow-up') {
  const r = await fetch(`${BASE}/api/aigeo/strategy-actions`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: rowBefore.id, is_ticked: true, propertyUrl: 'https://www.alanranger.com' }) });
  const j = await r.json().catch(() => ({}));
  const rowAfter = await planRow();
  check('3: live manual PATCH tick refused (409), row re-read unchanged', r.status === 409 && !rowDiff(rowAfter).length, `HTTP ${r.status} · ${String(j.error || '').slice(0, 90)} · row diff: ${rowDiff(rowAfter).join(', ') || 'none'}`);
} else check('3: live manual PATCH tick refused (409)', false, 'skipped: deployed summary has no plan-sheet evidence rule');
await freezeDryRun();
fs.writeFileSync(`${OUT}/_decisions-live-result.json`, JSON.stringify({ results, before, after }, null, 1));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);

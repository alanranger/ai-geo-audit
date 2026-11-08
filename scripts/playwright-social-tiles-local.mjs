/**
 * Local check of the "Social channels" row before deploy, at 1700px, against LIVE data:
 * the production dashboard is opened, but /lib/marketing-social-tiles.js is served from this folder and
 * /api/aigeo/social is answered in-process by this repo's api/aigeo/social.js (live Supabase, .env.vercel.prod).
 *   node scripts/playwright-social-tiles-local.mjs
 * Checks: 5 tiles in order under the Overview tiles; YouTube + Google Business figures equal SQL; Facebook / Instagram
 * "Not connected" with the Connect button; LinkedIn "Not entered"; sortable posts table; viewing writes nothing
 * (row counts before/after + no non-GET request); the LinkedIn form posts one entry (dry run: intercepted, not saved).
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const OUT = path.resolve('outputs');
const ENVF = fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/);
for (const l of ENVF) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '').trim();
}
const KEY = process.env.ARP_ADMIN_KEY;
const { default: handler } = await import('../api/aigeo/social.js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const writes = [];
const errors = [];
const fmt = (v) => Number(v).toLocaleString('en-GB');

async function counts() {
  const out = {};
  for (const t of ['social_connections', 'social_oauth_states', 'social_account_daily', 'social_posts', 'social_post_snapshots', 'strategy_campaign_ticks', 'acquisition_sync_runs']) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true });
    out[t] = count;
  }
  return out;
}

async function callHandler(req) {
  const u = new URL(req.url());
  const res = { code: 200, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, send(b) { this.body = b; return this; } };
  const body = req.postData() ? JSON.parse(req.postData()) : undefined;
  await handler({ method: req.method(), query: Object.fromEntries(u.searchParams), body, headers: { 'x-arp-admin-key': req.headers()['x-arp-admin-key'] || '' } }, res);
  return res;
}

const LIVE = process.argv.includes('--live');
const TAG = LIVE ? 'production-live' : 'live';

async function openTab(browser, envPatch) {
  const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((k) => sessionStorage.setItem('arp_admin_key', k), KEY);
  if (!LIVE) await page.route('**/lib/marketing-social-tiles.js*', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync('lib/marketing-social-tiles.js', 'utf8') }));
  await page.route('**/api/aigeo/social*', async (route) => {
    const req = route.request();
    if (req.method() !== 'GET') {
      writes.push({ method: req.method(), body: JSON.parse(req.postData() || '{}') });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, daily_rows: 1, post_rows: 0, week_ending: 'DRY RUN (not saved)' }) });
    }
    if (LIVE) return route.continue();
    const saved = { ...process.env };
    Object.assign(process.env, envPatch || {});
    const r = await callHandler(req).finally(() => { for (const k of Object.keys(envPatch || {})) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
    return route.fulfill({ status: r.code, contentType: 'application/json', body: r.body });
  });
  await page.goto('https://ai-geo-audit.vercel.app/audit-dashboard.html#marketing', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#mk-social .mksoc-g', { timeout: 120000 });
  await page.waitForTimeout(2500);
  await page.addStyleTag({ content: '#debugPanel { display: none !important; }' });
  return page;
}

async function expectedFromSql() {
  const { data: yt } = await sb.from('youtube_channel_stats').select('captured_date,subscribers,views_window,watch_time_minutes_window,impressions_ctr_window').order('captured_date', { ascending: false }).limit(40);
  const back = new Date(Date.parse(`${yt[0].captured_date}T00:00:00Z`) - 28 * 864e5).toISOString().slice(0, 10);
  const prev = yt.find((r) => r.captured_date <= back);
  const { data: gbp } = await sb.from('gbp_performance_monthly').select('*').order('month', { ascending: false }).limit(3);
  const views = (m) => m.impressions_search_mobile + m.impressions_search_desktop + m.impressions_maps_mobile + m.impressions_maps_desktop;
  const full = gbp[0].month.slice(0, 7) === new Date().toISOString().slice(0, 7) ? gbp[1] : gbp[0];
  return {
    yt: { subs: fmt(yt[0].subscribers), gain: fmt(yt[0].subscribers - prev.subscribers), gain_pct: `(${Math.round(((yt[0].subscribers - prev.subscribers) / prev.subscribers) * 100)}%)`, views: fmt(yt[0].views_window), hrs: `${fmt(Math.round(yt[0].watch_time_minutes_window / 60))} hrs`, ctr: `${(Math.round(Number(yt[0].impressions_ctr_window) * 10) / 10).toFixed(1)}%` },
    gbp: { views: fmt(views(full)), interactions: fmt(full.interactions), clicks: fmt(full.website_clicks) }
  };
}

const tileText = (page, key) => page.locator(`[data-mksoc-tile="${key}"]`).innerText();

async function verify(page, exp) {
  const order = await page.$$eval('#mk-social [data-mksoc-tile]', (els) => els.map((e) => e.dataset.mksocTile));
  check('5 tiles in order', order.join(',') === 'facebook,instagram,linkedin,youtube,gbp', order.join(','));
  const placed = await page.evaluate(() => { const a = document.getElementById('mk-overview-tiles'); return a?.nextElementSibling?.id === 'mk-social' && document.getElementById('mk-social').nextElementSibling?.id === 'mk-schedule'; });
  check('row sits directly under the Overview tiles, above the schedule', placed);
  const yt = await tileText(page, 'youtube');
  for (const [k, v] of Object.entries(exp.yt)) check(`YouTube ${k} = SQL (${v})`, yt.includes(v), yt.replace(/\s+/g, ' ').slice(0, 160));
  const g = await tileText(page, 'gbp');
  for (const [k, v] of Object.entries(exp.gbp)) check(`Google Business ${k} = SQL (${v})`, g.includes(v));
  const connected = /Connected · Page/.test(await tileText(page, 'facebook'));
  for (const key of ['facebook', 'instagram']) {
    const t = await tileText(page, key);
    if (connected) check(`${key}: connected, followers shown`, /Connected · Page/.test(t) && /followers/.test(t), t.replace(/\s+/g, ' ').slice(0, 220));
    else check(`${key}: "Not connected" + Connect button, no invented figures`, /Not connected/.test(t) && /Connect Facebook & Instagram/.test(t) && !/followers/.test(t), t.replace(/\s+/g, ' ').slice(0, 200));
  }
  if (connected) {
    const reachRow = await page.locator('[data-mksoc-tile="instagram"] .mksoc-r', { hasText: 'Reach (28 days)' }).innerText();
    const tip = await page.locator('[data-mksoc-tile="instagram"] .mksoc-r', { hasText: 'Reach (28 days)' }).locator('[title]').first().getAttribute('title').catch(() => '');
    check('Instagram reach: "not comparable yet" or a change on a ≥90%-covered earlier period (tooltip gives the days)', /not comparable yet/.test(reachRow) ? /have data/.test(tip) : /[▲▼±]/.test(reachRow), `${reachRow.replace(/\s+/g, ' ')} | ${tip}`);
  }
  check('LinkedIn: not entered / manual / GPT', /Not entered|manual|GPT/.test(await tileText(page, 'linkedin')));
  const first = await page.$$eval('#mksoc-posts tbody tr', (rows) => rows.length);
  const ev = await page.$$eval('#mksoc-posts tbody tr', (rows) => rows.map((r) => [...r.querySelectorAll('td')].map((td) => td.textContent.trim())).filter((c) => c[13] && c[13] !== '—').map((c) => `${c[2]}|${c[3].slice(0, 30)}|${c[6]}|${c[13].slice(0, 20)}`));
  check('posts table: today\'s evidenced placements listed (2 Stories, LinkedIn, FB + IG feed)', ev.filter((x) => x.startsWith('Story')).length === 2 && ev.length >= 7, ev.join(' || '));
  const ids = await page.$$eval('#mksoc-posts tbody tr td:nth-child(4) a', (as) => as.map((a) => a.href));
  check('no collected post listed twice', new Set(ids).size === ids.length, `${ids.length} links`);
  await page.click('#mksoc-posts th[data-mksoc-sort="reach"]');
  const reach = await page.$$eval('#mksoc-posts tbody tr td:nth-child(7)', (tds) => tds.map((t) => Number(t.textContent.replace(/[^\d]/g, '')) || 0));
  check('posts table: ≥10 rows, sorts by reach', first >= 10 && reach.every((v, i) => i === 0 || reach[i - 1] >= v), reach.join(','));
  await page.click('#mksoc-posts th[data-mksoc-sort="posted_at"]');
}

async function linkedinDryRun(page) {
  await page.click('[data-mksoc-tile="linkedin"] [data-mksoc="linkedin"]');
  await page.fill('[data-li="followers"]', '3050');
  await page.fill('[data-li="impressions_7d"]', '1400');
  await page.screenshot({ path: `${OUT}/social-linkedin-entry-form-${TAG}-1700px-20261108.png` });
  const before = writes.length;
  await page.click('[data-mksoc="li-save"]');
  await page.waitForTimeout(800);
  const w = writes.slice(before);
  if (w.length !== 1) console.log('linkedin writes seen:', JSON.stringify(w));
  check('LinkedIn Save sends exactly one linkedin-entry request (dry run, not saved)', w.length === 1 && w[0].body.action === 'linkedin-entry' && w[0].body.followers === '3050' && w[0].body.posts.length === 0, JSON.stringify(w[0]?.body || {}));
  await page.click('[data-mksoc="close"]').catch(() => {});
}

const exp = await expectedFromSql();
const c0 = await counts();
/** Production only: the collect route the nightly cron calls. No auth → 401; with the admin key (same GET handler) → skipped. */
async function cronPath() {
  const url = 'https://ai-geo-audit.vercel.app/api/aigeo/social?action=collect';
  const open = await fetch(url);
  check('collect route refuses a call without the cron secret / admin key (401)', open.status === 401, String(open.status));
  const before = await counts();
  const r = await fetch(url, { headers: { 'x-arp-admin-key': KEY } });
  const j = await r.json().catch(() => ({}));
  const after = await counts();
  check('collect without a connection: 200, skipped "not_connected", not an error', r.status === 200 && j.ok === true && j.skipped === 'not_connected' && j.rows === 0, `${r.status} ok=${j.ok} skipped=${j.skipped} rows=${j.rows}`);
  const social = (c) => JSON.stringify([c.social_connections, c.social_oauth_states, c.social_account_daily, c.social_posts]);
  check('collect without a connection writes no social rows (one "skipped" run-log row only)', social(before) === social(after) && after.acquisition_sync_runs - before.acquisition_sync_runs <= 1, `runs ${before.acquisition_sync_runs} → ${after.acquisition_sync_runs}`);
  const { data } = await sb.from('acquisition_sync_runs').select('status,error_message,trigger_source').eq('job', 'social_meta').order('started_at', { ascending: false }).limit(1);
  check('run log says skipped', data?.[0]?.status === 'skipped' && data[0].error_message === 'not_connected', JSON.stringify(data?.[0] || {}));
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await openTab(browser);
if (LIVE) {
  const tags = await page.evaluate(() => [...document.querySelectorAll('script[src*="marketing-social-tiles"]')].map((s) => s.getAttribute('src')));
  check('deployed script tag', tags.length === 1 && tags[0].includes('v=social-20261108a'), tags.join(' '));
}
await page.locator('#mk-social').screenshot({ path: `${OUT}/social-channels-${TAG}-1700px-20261108.png` });
await page.locator('#mk-social .mksoc-g').screenshot({ path: `${OUT}/social-channels-tiles-${TAG}-1700px-20261108.png` });
await page.locator('#mksoc-posts').screenshot({ path: `${OUT}/social-recent-posts-evidence-${TAG}-1700px-20261108.png` });
await verify(page, exp);
if (LIVE) check('Connect button disabled while the Meta env vars are missing', await page.$eval('[data-mksoc-tile="facebook"] [data-mksoc="connect"]', (b) => b.disabled) && /META_APP_ID, META_APP_SECRET, SOCIAL_TOKEN_KEY/.test(await tileText(page, 'facebook')));
const c1 = await counts();
check('viewing writes nothing (row counts unchanged, no POST)', JSON.stringify(c0) === JSON.stringify(c1) && writes.length === 0, `${JSON.stringify(c0)} → ${JSON.stringify(c1)}`);
await page.click('#mk-fold-rules > summary');
await page.waitForSelector('#mk-social-rules h3');
await page.locator('#mk-social-rules').screenshot({ path: `${OUT}/social-connections-rules-${TAG}-1700px-20261108.png` });
await linkedinDryRun(page);
await page.close();
if (!LIVE && c0.social_connections === 0) {
  const ready = await openTab(browser, { META_APP_ID: 'set-in-vercel', META_APP_SECRET: 'set-in-vercel', SOCIAL_TOKEN_KEY: 'c2V0LWluLXZlcmNlbC1zZXQtaW4tdmVyY2VsLTMyYg==' });
  await ready.locator('#mk-social .mksoc-g').screenshot({ path: `${OUT}/social-channels-tiles-after-env-1700px-20261108.png` });
  const enabled = await ready.$eval('[data-mksoc-tile="facebook"] [data-mksoc="connect"]', (b) => !b.disabled);
  check('once the env vars exist the Connect button is enabled (not clicked)', enabled);
  await ready.close();
}
await browser.close();
const c2 = await counts();
check('nothing written by viewing / the LinkedIn dry run', JSON.stringify(c0) === JSON.stringify(c2), JSON.stringify(c2));
if (LIVE) await cronPath();
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);

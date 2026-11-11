/**
 * QUESTION-2026-11-11 refresh-status-stuck-checking, LOCAL code on LIVE data, 1700px. The production page loads the
 * local lib/marketing-sync-run.js, lib/marketing-delivery.js and lib/marketing-channels-tile.js. GET status-refresh-progress
 * and GET delivery-status are answered by the LOCAL marketing handler (the new settle / sweep code closes the run);
 * POST status-refresh goes to production (Meta's token key only exists there; its start logic is unchanged). Every
 * other write is refused and listed. Clicking Refresh status is a read / collect request: it never sends. Names blurred.
 *   node scripts/playwright-verify-refresh-stuck-local.mjs [--live]   (--live: deployed code, nothing local)
 */
import fs from 'node:fs';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const LIVE = process.argv.includes('--live');
const SHOT = LIVE ? 'live' : 'local';
const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
Object.assign(process.env, { SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: ENV.SUPABASE_SERVICE_ROLE_KEY, ARP_ADMIN_KEY: ENV.ARP_ADMIN_KEY });
const { default: handler } = await import('../api/aigeo/marketing.js');
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const LOCAL_GETS = new Set(['status-refresh-progress', 'delivery-status']);
const PASS_POSTS = new Set(['status-refresh', 'health-badges', 'query-run', 'query-fields', 'segment-preview', 'snapshot-review']);
const BLUR = '#mk-query table td:first-child, #mq-results, #mq-detail, #mk-review-table td:first-child, #mk-cust-body, .mk-detail, #mk-waiting, #mk-schedule .mks-body, #mk-results table { filter: blur(6px) !important; }';
const results = [];
const check = (name, ok, note = '') => { results.push({ name, ok: !!ok, note: String(note).replace(/\s+/g, ' ').slice(0, 500) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} · ${String(note).replace(/\s+/g, ' ').slice(0, 220)}`); };
const refused = [];
const passed = [];
const localCalls = [];
const errors = [];

async function local(method, query) {
  let status = 200;
  let out = '';
  const res = { status(s) { status = s; return this; }, setHeader() {}, send(b) { out = b; return this; }, json(j) { out = JSON.stringify(j); return this; }, end() { return this; } };
  await handler({ method, query, body: null, headers: { 'x-arp-admin-key': ENV.ARP_ADMIN_KEY } }, res);
  return { status, body: out };
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1700, height: 1150 } });
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript((k) => sessionStorage.setItem('arp_admin_key', k), ENV.ARP_ADMIN_KEY);
if (!LIVE) {
  for (const f of ['marketing-sync-run.js', 'marketing-delivery.js', 'marketing-channels-tile.js']) {
    await page.route(`**/lib/${f}*`, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`lib/${f}`, 'utf8') }));
  }
}
await page.route('**/api/**', async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  const action = url.searchParams.get('action') || JSON.parse(req.postData() || '{}').action;
  if (req.method() === 'GET') {
    if (!LIVE && url.pathname === '/api/aigeo/marketing' && LOCAL_GETS.has(action)) {
      localCalls.push(action);
      const r = await local('GET', Object.fromEntries(url.searchParams));
      return route.fulfill({ status: r.status, contentType: 'application/json', body: r.body });
    }
    return route.fallback();
  }
  if (url.pathname === '/api/aigeo/marketing' && PASS_POSTS.has(action)) { passed.push(action); return route.fallback(); }
  refused.push(`${req.method()} ${url.pathname} ${action || ''}`);
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' });
});

await page.goto('https://ai-geo-audit.vercel.app/audit-dashboard.html#marketing', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#mk-channels [data-mkch-row="email"]', { timeout: 180000 });
await page.waitForSelector('#mk-schedule [data-mks-refresh]', { timeout: 180000 });
/** The slow Strategy campaign-records section must be painted before the "nothing else changed" snapshot. */
const strategyReady = () => page.waitForSelector('#st-campaign-table', { state: 'attached', timeout: 120000 }).catch(() => {});
await strategyReady();
await page.addStyleTag({ content: BLUR });
await page.waitForTimeout(8000);

const emailRow = () => page.$eval('#mk-channels [data-mkch-row="email"]', (r) => ({ sched: r.querySelector('.s')?.textContent, waiting: r.querySelector('.w')?.textContent, drafts: r.querySelector('.d')?.textContent, tip: r.getAttribute('title') }));
const { count: liveSched } = await sb.from('sqs_scheduled_emails').select('*', { count: 'exact', head: true }).eq('state', 'scheduled').gt('scheduled_for', new Date().toISOString());
const e1 = await emailRow();
check('By channel: Squarespace email Sched = live scheduled in Squarespace (DB)', Number(e1.sched) === liveSched, `tile ${e1.sched} · DB live scheduled ${liveSched} · hover: ${e1.tip}`);
await page.locator('#mk-channels').screenshot({ path: `outputs/refresh-stuck-channels-tile-${SHOT}-1700px-20261111.png` });
const capText = await page.$eval('#mk-overview-tiles', (t) => t.innerText.replace(/\s+/g, ' ')).catch(() => '');
check('Capacity / billing-cycle tiles: no "Sent … still reserved" line after the 21:52 meter read (tonight\'s sends released, not double counted)', !/SENT[^·]{0,80}still reserved/i.test(capText), (capText.match(/.{0,80}(SENT|sent:).{0,80}/) || ['no SENT rows'])[0]);

const signature = () => page.evaluate(() => {
  const root = document.getElementById('marketing-root');
  const out = (sel) => [...root.querySelectorAll(sel)].filter((e) => !e.closest('#mk-head-actions')).map((e) => (e.id || e.textContent.trim().slice(0, 40)));
  return JSON.stringify({ ids: out('[id]').filter((x) => !/^mk-(run|refresh)/.test(x)), h3: out('h3'), buttons: out('button').filter((t) => !/^(Running|Checking)/.test(t)) });
});
const sigBefore = await signature();
const btnBefore = await page.textContent('#mk-schedule [data-mks-refresh]');
check('Refresh status button idle before the click', btnBefore.trim() === 'Refresh status', btnBefore);

await page.evaluate(() => {
  window.__r = { steps: new Set(), pcts: new Set(), alive: new Set(), bg: false };
  new MutationObserver(() => {
    const m = document.getElementById('mk-run-modal');
    const s = m?.querySelector('[data-mksr-step]');
    if (s) { window.__r.steps.add(`${s.dataset.mksrStep}/${s.dataset.mksrTotal}`); window.__r.pcts.add(s.textContent.split('%')[0]); }
    const a = m?.querySelector('[data-mksr-alive]');
    if (a) window.__r.alive.add(a.textContent.replace(/\d+ s/g, 'n s').slice(0, 90));
    if (m?.querySelector('[data-mksr-bg]')) window.__r.bg = true;
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
});
const clickAt = new Date();
await page.click('#mk-schedule [data-mks-refresh]');
await page.waitForSelector('#mk-run-modal [data-mksr-step]', { timeout: 60000 });
const busyText = await page.textContent('#mk-schedule [data-mks-refresh]').catch(() => '');
await page.waitForTimeout(2500);
await page.screenshot({ path: `outputs/refresh-stuck-progress-${SHOT}-1700px-20261111.png` });
await page.waitForSelector('#mk-run-modal [data-mksr-step="2"]', { timeout: 120000 });
await page.waitForTimeout(1500);
await page.locator('#mk-run-modal .box').screenshot({ path: `outputs/refresh-stuck-progress-step2-${SHOT}-1700px-20261111.png` });
await page.waitForSelector('#mk-run-modal [data-mksr-result]', { timeout: 10 * 60000 });
await page.waitForSelector('#mk-run-modal [data-mksr-reload="done"], #mk-run-modal [data-mksr-reload="failed"]', { timeout: 150000 });
const secs = Math.round((Date.now() - clickAt) / 1000);
const seen = await page.evaluate(() => ({ steps: [...window.__r.steps], pcts: [...window.__r.pcts], alive: [...window.__r.alive], bg: window.__r.bg }));
check('Progress window: step 1, 2 and 3 of 3, real %, alive signal, "Run in background"', ['1/3', '2/3', '3/3'].every((s) => seen.steps.includes(s)) && seen.pcts.length >= 3 && seen.alive.some((a) => /alive/.test(a)) && seen.bg, `steps ${seen.steps.join(', ')} · % ${seen.pcts.slice(0, 12).join(', ')}… · ${seen.alive.slice(0, 3).join(' / ')}`);
const box = await page.locator('#mk-run-modal .box').innerText();
const state = await page.getAttribute('#mk-run-modal [data-mksr-result]', 'data-mksr-result');
const lines = box.split('\n').filter((l) => /^[✓✗⏳] /.test(l));
check(`Result window within the timeout (${secs} s): ✅ final result, or ⏳ with the clear queued message; 3 step lines, duration, OK; tiles reloaded`, (state === 'ok' || (state === 'pending' && box.includes('runs within 5 min; results will appear automatically'))) && lines.length === 3 && /Took \d/.test(box) && /reloaded/.test(box), box);
await page.locator('#mk-run-modal .box').screenshot({ path: `outputs/refresh-stuck-result-${SHOT}-1700px-20261111.png` });
await page.click('#mk-run-modal [data-mksr-ok]');
await page.waitForTimeout(3000);
const btnAfter = await page.textContent('#mk-schedule [data-mks-refresh]');
check('Button showed "Checking…" while running and is back to "Refresh status" (never stuck)', /Checking/.test(busyText) && btnAfter.trim() === 'Refresh status', `${busyText} → ${btnAfter}`);

const { data: run } = await sb.from('marketing_collector_runs').select('run_id, status, started_at, heartbeat_at, finished_at, summary').eq('kind', 'status-refresh').gte('started_at', new Date(clickAt.getTime() - 60000).toISOString()).order('started_at', { ascending: false }).limit(1).maybeSingle();
check('The refresh run row is closed (not running), with finished_at and an outcome', run && run.status !== 'running' && !!run.finished_at && !!run.summary?.outcome, run ? `${run.run_id} · ${run.status} · started ${run.started_at} · finished ${run.finished_at} · ${run.summary?.outcome?.text} · read ${JSON.stringify(run.summary?.squarespace_read || null)}` : 'no run found');
const { count: running } = await sb.from('marketing_collector_runs').select('*', { count: 'exact', head: true }).eq('status', 'running').lt('started_at', new Date(Date.now() - 15 * 60000).toISOString());
check('No run left "running" with no heartbeat for 15+ min', running === 0, `${running} old running rows`);

const e2 = await emailRow();
check('By channel after the reload: Squarespace email Sched still = live scheduled', Number(e2.sched) === liveSched, `${e2.sched} vs ${liveSched}`);
await strategyReady();
await page.waitForTimeout(8000);
const sigAfter = await signature();
const A = JSON.parse(sigBefore);
const B = JSON.parse(sigAfter);
const diff = Object.keys(A).map((k) => { const g = A[k].filter((x) => !B[k].includes(x)); const a = B[k].filter((x) => !A[k].includes(x)); return g.length || a.length ? `${k}: −[${g.join(', ')}] +[${a.join(', ')}]` : ''; }).filter(Boolean).join(' · ');
check('Nothing else on the tab changed (sections, headings, buttons)', !diff, diff || 'same');
check('Only status-refresh (+ read POSTs) reached production; every other write refused', passed.every((a) => PASS_POSTS.has(a)), `passed: ${[...new Set(passed)].join(', ')} · local GETs: ${[...new Set(localCalls)].join(', ')} · refused: ${[...new Set(refused)].join(' | ') || 'none'}`);
check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
fs.writeFileSync(`outputs/refresh-stuck-${SHOT}-results-20261111.json`, JSON.stringify({ at: new Date().toISOString(), secs, results, run, refused: [...new Set(refused)], passed: [...new Set(passed)], errors }, null, 2));
await browser.close();
console.log(`${results.filter((r) => r.ok).length}/${results.length} ok`);
process.exit(results.every((r) => r.ok) ? 0 : 1);

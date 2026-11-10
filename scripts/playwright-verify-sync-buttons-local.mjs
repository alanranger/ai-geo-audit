/**
 * Sync customers / Collect email results header buttons + the shared result window, LOCAL code on LIVE data, 1700px.
 * The production page is loaded with lib/marketing-tab.js and lib/marketing-sync-run.js served from this folder (the
 * new script tag is added to the page as the deploy will). Real runs (approved 10 Nov): POST sync and collect-request
 * reach production; every other write is refused and listed. Names blurred.
 *   node scripts/playwright-verify-sync-buttons-local.mjs --part=sync      header Sync customers + original Sync now
 *   node scripts/playwright-verify-sync-buttons-local.mjs --part=collect   header Collect email results (≈ 5–10 min)
 */
import fs from 'node:fs';
import { chromium } from 'playwright';

const PART = (process.argv.find((a) => a.startsWith('--part=')) || '--part=sync').slice(7);
/** --live: the deployed code as served (no local files); every write except the approved runs is still refused. */
const LIVE = process.argv.includes('--live');
const SHOT = LIVE ? 'live' : 'local';
const hold = { on: false, route: null };
const held = [];
const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
const BASE = 'https://ai-geo-audit.vercel.app';
const ALLOWED = new Set(['sync', 'collect-request']);
const READ_POSTS = new Set(['health-badges', 'query-run', 'query-fields', 'segment-preview', 'snapshot-review']);
const BLUR = '#mk-query table td:first-child, #mq-results, #mq-detail, #mk-review-table td:first-child, #mk-cust-body, .mk-detail, #mk-waiting, #mk-schedule .mks-body, #mk-results table { filter: blur(6px) !important; }';
const STAMP = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
const results = [];
const check = (name, ok, note = '') => { results.push({ name, ok: !!ok, note: String(note).replace(/\s+/g, ' ').slice(0, 400) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} · ${String(note).replace(/\s+/g, ' ').slice(0, 200)}`); };
const blocked = [];
const passed = [];
const errors = [];

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1700, height: 1150 } });
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript((k) => sessionStorage.setItem('arp_admin_key', k), ENV.ARP_ADMIN_KEY);
const local = (file) => (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(file, 'utf8') });
if (!LIVE) {
  await page.route('**/lib/marketing-tab.js*', local('lib/marketing-tab.js'));
  await page.route('**/lib/marketing-sync-run.js*', local('lib/marketing-sync-run.js'));
  await page.route('**/audit-dashboard.html*', async (route) => {
    const res = await route.fetch();
    const html = (await res.text()).replace(/(<script src="\/lib\/marketing-tab\.js\?v=[^"]*"><\/script>)/, '$1\n  <script src="/lib/marketing-sync-run.js?v=sync-20261110a"></script>');
    return route.fulfill({ response: res, body: html, headers: { ...res.headers(), 'content-type': 'text/html; charset=utf-8' } });
  });
}
await page.route('**/api/**', async (route) => {
  const req = route.request();
  if (req.method() === 'GET') return route.fallback();
  const url = new URL(req.url());
  const action = JSON.parse(req.postData() || '{}').action;
  if (hold.on && action === 'sync') { hold.route = route; held.push(action); return undefined; }
  if (url.pathname === '/api/aigeo/marketing' && (ALLOWED.has(action) || READ_POSTS.has(action))) { passed.push(action); return route.fallback(); }
  blocked.push(`${req.method()} ${url.pathname} ${action || ''}`);
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' });
});

await page.goto(`${BASE}/audit-dashboard.html#marketing`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#mk-head-actions [data-mksr="sync"]', { timeout: 180000 });
await page.waitForFunction(() => !/loading/.test(document.querySelector('[data-mksr-last="sync"]')?.textContent || 'loading'), null, { timeout: 180000 });
await page.waitForFunction(() => document.querySelector('#mk-overview-tiles') && !document.querySelector('#mk-overview-tiles > .rt-loading'), null, { timeout: 180000 });
await page.addStyleTag({ content: BLUR });
await page.waitForTimeout(4000);

/** Tab structure (sections, headings, buttons) outside the header and the run window: must be the same after a run. */
const signature = () => page.evaluate(() => {
  const root = document.getElementById('marketing-root');
  const out = (sel) => [...root.querySelectorAll(sel)].filter((e) => !e.closest('#mk-head-actions')).map((e) => (e.id || e.textContent.trim().slice(0, 40)));
  return JSON.stringify({ ids: out('[id]').filter((x) => !/^mk-(run|refresh)/.test(x)), h3: out('h3'), buttons: out('button').filter((t) => !/^(Running|Checking)/.test(t)) });
});
function sigDiff(a, b) {
  const A = JSON.parse(a);
  const B = JSON.parse(b);
  return Object.keys(A).map((k) => {
    const gone = A[k].filter((x) => !B[k].includes(x));
    const added = B[k].filter((x) => !A[k].includes(x));
    return gone.length || added.length ? `${k}: −[${gone.join(', ')}] +[${added.join(', ')}]` : '';
  }).filter(Boolean).join(' · ') || 'same items, different order';
}
/** Every paint of the run window: step x of n, % and the alive / stalled line. */
const watchModal = () => page.evaluate(() => {
  window.__mksr = { steps: new Set(), pcts: new Set(), alive: new Set() };
  new MutationObserver(() => {
    const m = document.getElementById('mk-run-modal');
    const s = m?.querySelector('[data-mksr-step]');
    if (s) { window.__mksr.steps.add(`${s.dataset.mksrStep}/${s.dataset.mksrTotal}`); window.__mksr.pcts.add(s.textContent.split('%')[0]); }
    const a = m?.querySelector('[data-mksr-alive]');
    if (a) window.__mksr.alive.add(a.textContent.split(' · ')[0].replace(/\d+ s$/, 'n s'));
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
});
const seen = () => page.evaluate(() => ({ steps: [...window.__mksr.steps], pcts: [...window.__mksr.pcts], alive: [...window.__mksr.alive] }));

async function hoverTip(sel, expected, shot) {
  await page.hover(sel);
  const tip = await page.getAttribute(sel, 'title');
  check(`${sel}: hover tip is the exact text`, tip === expected, tip);
  if (!shot) return;
  await page.evaluate(({ sel: s, tip: t }) => {
    const b = document.querySelector(s).getBoundingClientRect();
    const d = document.createElement('div');
    d.id = 'mksr-tip-shot';
    d.textContent = t;
    d.style.cssText = `position:fixed;left:${b.left}px;top:${b.bottom + 22}px;max-width:30rem;background:#f8fafc;color:#111;font:12px/1.4 system-ui;padding:6px 8px;border:1px solid #888;box-shadow:0 2px 6px rgba(0,0,0,.4);z-index:99999`;
    document.body.appendChild(d);
  }, { sel, tip });
  const box = await page.locator('section[data-panel="marketing"] .card--section-header').boundingBox();
  await page.screenshot({ path: shot, clip: { x: 0, y: Math.max(0, box.y - 10), width: 1700, height: box.height + 150 } });
  await page.evaluate(() => document.getElementById('mksr-tip-shot')?.remove());
}

/** Click → progress through every step → result window with per-step lines → reload done → OK closes it. */
async function runAndCheck(label, clickSel, totalSteps, kindLast, timeoutMs, shotBase, prepare) {
  const sigBefore = await signature();
  const lastBefore = await page.textContent(`[data-mksr-last="${kindLast}"]`);
  if (prepare) await prepare();
  await page.evaluate(() => { const t = document.getElementById('mk-overview-tiles'); if (t) t.dataset.mksrOld = '1'; });
  await watchModal();
  const t0 = Date.now();
  await page.click(clickSel);
  await page.waitForSelector('#mk-run-modal [data-mksr-step]', { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${shotBase}-progress-${SHOT}-1700px-20261110.png` });
  await page.waitForSelector('#mk-run-modal [data-mksr-result]', { timeout: timeoutMs });
  await page.waitForSelector('#mk-run-modal [data-mksr-reload="done"], #mk-run-modal [data-mksr-reload="failed"]', { timeout: 150000 });
  const s = await seen();
  const want = Array.from({ length: totalSteps }, (_, i) => `${i + 1}/${totalSteps}`);
  check(`${label}: progress passed every step (${want.join(', ')})`, want.every((w) => s.steps.includes(w)), `steps ${s.steps.join(', ')} · % ${s.pcts.join(', ')} · ${s.alive.join(' / ')}`);
  check(`${label}: real % moved between steps`, s.pcts.length >= totalSteps, s.pcts.join(', '));
  check(`${label}: alive / stalled signal shown`, s.alive.some((a) => /alive|stalled/.test(a)), s.alive.join(' / '));
  const box = await page.locator('#mk-run-modal .box').innerText();
  const ok = await page.getAttribute('#mk-run-modal [data-mksr-result]', 'data-mksr-result');
  const lines = box.split('\n').filter((l) => /^[✓✗] /.test(l));
  check(`${label}: result window ✅ Success with one line per step, the duration and OK`, ok === 'ok' && /✅ Success/.test(box) && lines.length === totalSteps && /Took \d/.test(box) && /\bOK\b/.test(box), box);
  check(`${label}: tiles reloaded (new tiles element, reload line done)`, await page.evaluate(() => !document.querySelector('#mk-overview-tiles[data-mksr-old]') && !!document.querySelector('#mk-overview-tiles > :not(.rt-loading)')) && /reloaded/.test(box), box.split('\n').find((l) => /reload/i.test(l)));
  await page.locator('#mk-run-modal .box').screenshot({ path: `${shotBase}-result-${SHOT}-1700px-20261110.png` });
  await page.click('#mk-run-modal [data-mksr-ok]');
  check(`${label}: OK closes the window`, !(await page.$('#mk-run-modal')), '');
  const lastAfter = await page.textContent(`[data-mksr-last="${kindLast}"]`);
  check(`${label}: "Last run" updated`, lastAfter !== lastBefore || lastAfter.includes(STAMP(new Date(t0).toISOString()).split(', ')[1] || '—'), `${lastBefore} → ${lastAfter}`);
  await page.waitForTimeout(2500);
  const sigAfter = await signature();
  check(`${label}: nothing else on the tab changed (sections, headings, buttons)`, sigAfter === sigBefore, sigAfter === sigBefore ? 'same' : sigDiff(sigBefore, sigAfter));
  return { secs: Math.round((Date.now() - t0) / 1000), lines };
}

/**
 * Live: the original "Sync now" opens the same window with the same tip, but its first sync call is held and then
 * aborted in the browser, so nothing runs on the server (the window then shows its ❌ path for that step).
 */
async function originalHeld() {
  await page.evaluate(() => { document.getElementById('mk-behind').open = true; });
  await page.waitForSelector('#mk-sources [data-mk="sync"]', { timeout: 60000 });
  await page.locator('#mk-sources').scrollIntoViewIfNeeded();
  await page.hover('#mk-sources [data-mk="sync"]');
  const tip = await page.getAttribute('#mk-sources [data-mk="sync"]', 'title');
  check('Original "Sync now": same hover tip as Sync customers', tip === TIPS.sync, tip);
  hold.on = true;
  await page.click('#mk-sources [data-mk="sync"]');
  await page.waitForSelector('#mk-run-modal [data-mksr-step="1"][data-mksr-total="4"]', { timeout: 30000 });
  await page.waitForTimeout(1500);
  const box = await page.locator('#mk-run-modal .box').innerText();
  check('Original "Sync now": opens the same window (Sync customers…, step 1 of 4, alive)', /^Sync customers…/.test(box) && /step 1 of 4: Squarespace profiles/.test(box) && /alive/.test(box), box);
  await page.screenshot({ path: `outputs/sync-buttons-original-sync-now-window-${SHOT}-1700px-20261110.png` });
  for (let i = 0; i < 20 && !hold.route; i += 1) await page.waitForTimeout(250);
  await hold.route?.abort('failed');
  hold.on = false;
  await page.waitForSelector('#mk-run-modal [data-mksr-result]', { timeout: 30000 });
  const res = await page.locator('#mk-run-modal .box').innerText();
  check('Original "Sync now": stopped before any server call (held, aborted); the window shows ❌ step 1', /❌ Failed at step 1 of 4/.test(res) && held.length === 1, res.split('\n').slice(0, 2).join(' · '));
  await page.waitForSelector('#mk-run-modal [data-mksr-reload="done"], #mk-run-modal [data-mksr-reload="failed"]', { timeout: 150000 });
  await page.click('#mk-run-modal [data-mksr-ok]');
}

if (LIVE) {
  const vers = await page.$$eval('script[src*="/lib/marketing-tab.js"], script[src*="/lib/marketing-sync-run.js"]', (s) => s.map((x) => x.getAttribute('src')));
  check('Deployed page loads marketing-tab.js and marketing-sync-run.js at ?v=sync-20261110a', vers.length === 2 && vers.every((v) => v.endsWith('?v=sync-20261110a')), vers.join(' · '));
}
const TIPS = await page.evaluate(() => window.mkSyncRun.TIPS);
const heads = await page.$$eval('#mk-head-actions [data-mksr]', (bs) => bs.map((b) => ({ t: b.textContent, cls: b.className, font: getComputedStyle(b).fontSize, bg: getComputedStyle(b).backgroundColor, h: Math.round(b.getBoundingClientRect().height), top: Math.round(b.getBoundingClientRect().top) })));
const title = await page.$eval('section[data-panel="marketing"] .card--section-header h2', (h) => Math.round(h.getBoundingClientRect().top));
check('Header: "Sync customers" and "Collect email results" side by side next to the title, same style', heads.length === 2 && heads[0].t === 'Sync customers' && heads[1].t === 'Collect email results' && heads[0].cls === heads[1].cls && heads[0].font === heads[1].font && heads[0].bg === heads[1].bg && heads[0].h === heads[1].h && heads[0].top === heads[1].top && Math.abs(heads[0].top - title) < 40, JSON.stringify(heads));
const lastLines = await page.$$eval('[data-mksr-last]', (e) => e.map((x) => x.textContent));
check('Header: "Last run" under each button', lastLines.length === 2 && lastLines.every((t) => /^Last run|^Running since/.test(t)), lastLines.join(' | '));

if (PART === 'sync') {
  await hoverTip('[data-mksr="sync"]', TIPS.sync, `outputs/sync-buttons-header-tip-sync-${SHOT}-1700px-20261110.png`);
  await hoverTip('[data-mksr="collect"]', TIPS.collect, `outputs/sync-buttons-header-tip-collect-${SHOT}-1700px-20261110.png`);
  const a = await runAndCheck('Header Sync customers', '[data-mksr="sync"]', 4, 'sync', 240000, 'outputs/sync-buttons-header-sync');
  if (LIVE) await originalHeld();
  const openBehind = async () => {
    await page.evaluate(() => { document.getElementById('mk-behind').open = true; });
    await page.waitForSelector('#mk-sources [data-mk="sync"]', { timeout: 60000 });
    await page.locator('#mk-sources').scrollIntoViewIfNeeded();
    const origTip = await page.getAttribute('#mk-sources [data-mk="sync"]', 'title');
    check('Original Sources & sync health "Sync now": same hover tip', origTip === TIPS.sync, origTip);
    await page.hover('#mk-sources [data-mk="sync"]');
  };
  const b = LIVE ? { secs: 0 } : await runAndCheck('Original Sync now', '#mk-sources [data-mk="sync"]', 4, 'sync', 240000, 'outputs/sync-buttons-original-sync-now', openBehind);
  await page.evaluate(() => { document.getElementById('mk-behind').open = true; document.getElementById('mk-fold-rules').open = true; });
  await page.waitForTimeout(6000);
  const social = await page.$$eval('[data-mksoc="collect"]', (bs) => bs.map((x) => x.textContent));
  check('Rules & data sources "Collect now" (Facebook & Instagram) still present, untouched (not clicked: a different collector)', social.length >= 1, `${social.length} on page`);
  results.push({ name: 'timings', ok: true, note: `header sync ${a.secs} s · original ${b.secs} s` });
} else if (PART === 'reload') {
  const a = await signature();
  const wait = Number((process.argv.find((x) => x.startsWith('--wait=')) || '--wait=0').slice(7));
  if (wait) await page.waitForTimeout(wait);
  await page.evaluate(() => window.renderMarketingTab(true));
  await page.waitForFunction(() => !document.querySelector('#mk-overview-tiles > .rt-loading') && !/loading/.test(document.querySelector('[data-mksr-last="sync"]')?.textContent || 'loading'), null, { timeout: 180000 });
  await page.waitForTimeout(6500);
  const b = await signature();
  check('Control (no run): a plain tab reload keeps the same structure', a === b, a === b ? 'same' : sigDiff(a, b));
} else {
  const c = await runAndCheck('Header Collect email results', '[data-mksr="collect"]', 3, 'collect', 25 * 60000, 'outputs/sync-buttons-header-collect');
  results.push({ name: 'timings', ok: true, note: `collect ${c.secs} s` });
}
check('Only sync / collect-request (+ read POSTs) reached production; every other write was refused here', passed.every((a) => ALLOWED.has(a) || READ_POSTS.has(a)), `passed: ${[...new Set(passed)].join(', ')} · refused: ${[...new Set(blocked)].join(' | ') || 'none'}`);
check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
fs.writeFileSync(`outputs/sync-buttons-${PART}-${SHOT}-results-20261110.json`, JSON.stringify({ part: PART, at: new Date().toISOString(), results, blocked, passed: [...new Set(passed)], errors }, null, 2));
await browser.close();
console.log(`${results.filter((r) => r.ok).length}/${results.length} ok`);
process.exit(results.every((r) => r.ok) ? 0 : 1);

// scripts/profile-tabs.mjs
// Profiles every dashboard tab on the live deployment: clicks each nav item,
// waits for network to settle, and ranks tabs by wall-clock settle time + API cost.
// Usage: node scripts/profile-tabs.mjs [baseUrl] [propertyUrl]

import { chromium } from 'playwright';

const BASE = process.argv[2] || 'https://ai-geo-audit.vercel.app/audit-dashboard.html';
const PROPERTY = process.argv[3] || 'https://www.alanranger.com';

const PANELS = [
  'dashboard', 'revenue-truth', 'revenue-funnel', 'scenario-planning',
  'optimisation', 'overview', 'money', 'ranking', 'ai-sources',
  'traditional-seo', 'backlinks', 'portfolio', 'authority',
  'implementation-progress', 'local', 'history'
];

const IDLE_MS = 2000;     // no new API request for this long => settled
const MIN_WAIT_MS = 1500; // always observe at least this long
const MAX_WAIT_MS = 60000; // hard cap per tab

function shortName(url) {
  try {
    const u = new URL(url);
    return u.pathname.replace(/^\/api\//, '') + (u.search ? '?' + u.search.slice(0, 40) : '');
  } catch { return url.slice(0, 80); }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext().then(c => c.newPage());

  await page.addInitScript((prop) => {
    try {
      localStorage.setItem('property_url', prop);
      localStorage.setItem('gsc_property_url', prop);
      localStorage.setItem('last_property_url', prop);
    } catch (e) { /* ignore */ }
  }, PROPERTY);

  // Network tracking, bucketed by the currently-loading tab.
  // A background poller repeats the SAME url forever, which would defeat a pure
  // network-idle detector. So "activity" = the first time a given endpoint is
  // seen within the current tab window; repeats are recorded but don't reset idle.
  let currentTab = 'INITIAL';
  const inflight = new Map(); // req -> { start, firstSeen }
  let lastNewActivity = Date.now();
  let seenThisTab = new Set();
  const tabStats = {}; // tab -> { calls: [{url, ms}] }
  const ensure = (t) => (tabStats[t] = tabStats[t] || { calls: [] });
  const pathOf = (url) => { try { return new URL(url).pathname; } catch { return url.split('?')[0]; } };

  page.on('request', (req) => {
    if (!req.url().includes('/api/')) return;
    const key = pathOf(req.url());
    const firstSeen = !seenThisTab.has(key);
    if (firstSeen) { seenThisTab.add(key); lastNewActivity = Date.now(); }
    inflight.set(req, { start: Date.now(), firstSeen });
    ensure(currentTab);
  });
  const finish = (req) => {
    const rec = inflight.get(req);
    if (rec == null) return;
    inflight.delete(req);
    if (!req.url().includes('/api/')) return;
    // a slow FIRST-SEEN endpoint keeps the settle window open until it returns;
    // repeated/persistent pollers (already-seen path) do not.
    if (rec.firstSeen) lastNewActivity = Date.now();
    ensure(currentTab).calls.push({ url: shortName(req.url()), ms: Date.now() - rec.start });
  };
  page.on('requestfinished', finish);
  page.on('requestfailed', finish);

  async function waitSettle(label) {
    const start = Date.now();
    currentTab = label;
    seenThisTab = new Set();
    lastNewActivity = Date.now();
    while (true) {
      await page.waitForTimeout(250);
      const elapsed = Date.now() - start;
      const idleFor = Date.now() - lastNewActivity;
      if (elapsed >= MIN_WAIT_MS && idleFor >= IDLE_MS) break;
      if (elapsed >= MAX_WAIT_MS) break;
    }
    return Date.now() - start;
  }

  console.log(`Loading ${BASE} (property=${PROPERTY})`);
  const loadStart = Date.now();
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90000 });
  const initialSettle = await waitSettle('dashboard(initial)');
  console.log(`Initial dashboard settle: ${(initialSettle / 1000).toFixed(1)}s (page load -> ${((Date.now() - loadStart) / 1000).toFixed(1)}s)`);

  const results = [];
  results.push({ tab: 'dashboard(initial)', settleS: initialSettle / 1000 });

  for (const panel of PANELS) {
    if (panel === 'dashboard') continue; // measured as initial
    const sel = `.aigeo-nav-item[data-panel="${panel}"]`;
    const btn = await page.$(sel);
    if (!btn) { console.log(`SKIP ${panel} (nav button not found)`); continue; }
    await btn.click();
    const settle = await waitSettle(panel);
    results.push({ tab: panel, settleS: settle / 1000 });
    const stat = tabStats[panel] || { calls: [] };
    console.log(`${panel.padEnd(24)} ${(settle / 1000).toFixed(1)}s  (${stat.calls.length} api calls)`);
  }

  console.log('\n================ RANKED BY SETTLE TIME ================');
  results.sort((a, b) => b.settleS - a.settleS);
  for (const r of results) {
    const stat = tabStats[r.tab] || { calls: [] };
    const totalMs = stat.calls.reduce((s, c) => s + c.ms, 0);
    const slowest = [...stat.calls].sort((a, b) => b.ms - a.ms).slice(0, 3)
      .map(c => `${c.url} ${(c.ms / 1000).toFixed(1)}s`).join(' | ');
    console.log(`${r.settleS.toFixed(1).padStart(6)}s  ${r.tab.padEnd(26)} ${stat.calls.length} calls, ${(totalMs / 1000).toFixed(1)}s total api`);
    if (slowest) console.log(`            slowest: ${slowest}`);
  }

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });

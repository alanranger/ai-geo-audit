// Measures REAL per-tab settle time: click a tab, then wait until tracked
// network requests stop firing (quiet for QUIET_MS) or HARD_CAP is hit.
// Unlike diagnose-tab-switch-storm.mjs (fixed 8s wait), this reports the
// actual wall-clock time each tab needs to finish its data fetches.
import { chromium } from 'playwright';

const BASE = 'https://ai-geo-audit.vercel.app/audit-dashboard.html';
const TRACK = /get-latest-audit|get-audit-history|06-site-urls|site-urls\.csv|money-pages|portfolio-segment|dataforseo|keyword-target|backlink|aigeo/i;
const QUIET_MS = 2000;     // network considered "settled" after this much silence
const HARD_CAP = 25000;    // never wait longer than this per tab

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

let lastReqAt = Date.now();
let liveCount = 0;
const perTab = {};
let currentTab = 'load';
page.on('request', (req) => {
  if (!TRACK.test(req.url())) return;
  lastReqAt = Date.now();
  liveCount++;
  perTab[currentTab] = (perTab[currentTab] || 0) + 1;
});

async function settle(cap = HARD_CAP) {
  const start = Date.now();
  while (Date.now() - start < cap) {
    if (Date.now() - lastReqAt >= QUIET_MS) break;
    await page.waitForTimeout(150);
  }
  return Date.now() - start;
}

const t0 = Date.now();
await page.goto(BASE, { waitUntil: 'load', timeout: 120000 });
const loadSettle = await settle();
console.log(`\n=== INITIAL LOAD: dom+load ${Date.now() - t0}ms, settle ${loadSettle}ms, tracked reqs ${liveCount} ===`);

const tabs = await page.$$eval('button.aigeo-nav-item[data-panel]', (els) =>
  els.map((e) => e.getAttribute('data-panel'))
);
console.log(`Found ${tabs.length} tabs\n`);
console.log('TAB'.padEnd(26) + 'settle(ms)'.padStart(12) + 'reqs'.padStart(8) + '   verdict');

const results = [];
for (const panel of tabs) {
  currentTab = panel;
  const before = perTab[panel] || 0;
  const ts = Date.now();
  try {
    await page.click(`button.aigeo-nav-item[data-panel="${panel}"]`, { timeout: 5000 });
  } catch (e) {
    console.log(`${panel.padEnd(26)}${'-'.padStart(12)}${'-'.padStart(8)}   click failed`);
    continue;
  }
  await page.waitForTimeout(300); // let click handler kick off fetches
  const s = await settle();
  const reqs = (perTab[panel] || 0) - before;
  const total = Date.now() - ts;
  const verdict = total < 1500 ? 'fast' : total < 4000 ? 'ok' : total < 8000 ? 'slow' : 'VERY SLOW';
  results.push({ panel, total, reqs, verdict });
  console.log(`${panel.padEnd(26)}${String(total).padStart(12)}${String(reqs).padStart(8)}   ${verdict}`);
}

console.log('\n=== SUMMARY ===');
const slow = results.filter((r) => r.total >= 4000).sort((a, b) => b.total - a.total);
if (slow.length === 0) {
  console.log('All tabs settled in < 4s — clean pass.');
} else {
  console.log('Slow tabs (>=4s):');
  slow.forEach((r) => console.log(`  ${r.panel}: ${r.total}ms (${r.reqs} reqs) [${r.verdict}]`));
}

await browser.close();

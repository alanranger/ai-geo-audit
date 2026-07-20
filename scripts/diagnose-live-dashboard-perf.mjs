/**
 * Live dashboard perf diagnosis — request patterns + tab timings.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'https://ai-geo-audit.vercel.app/audit-dashboard.html';
const OUT = 'logs/diagnose-live-dashboard-perf.json';

function summarizeUrl(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}${u.search ? u.search.slice(0, 40) : ''}`;
  } catch {
    return url.slice(0, 120);
  }
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const requests = [];
page.on('response', async (res) => {
  const req = res.request();
  requests.push({
    t: Date.now(),
    url: summarizeUrl(res.url()),
    status: res.status(),
    type: req.resourceType()
  });
});

const consoleLines = [];
page.on('console', (msg) => consoleLines.push(msg.text()));

console.log('=== Phase 1: initial load (domcontentloaded) ===');
const t0 = Date.now();
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
console.log(`domcontentloaded: ${Date.now() - t0}ms`);

console.log('=== Phase 2: observe network for 45s after load ===');
const observeStart = Date.now();
while (Date.now() - observeStart < 45000) {
  await page.waitForTimeout(5000);
  console.log(`  +${Date.now() - observeStart}ms requests so far: ${requests.length}`);
}

console.log('=== Phase 3: tab hash switches (load, not networkidle) ===');
const tabTimings = [];
for (const tab of ['money', 'dashboard', 'ranking-ai', 'revenue-truth', 'money']) {
  const start = Date.now();
  const before = requests.length;
  await page.goto(`${BASE}#${tab}`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForTimeout(8000);
  tabTimings.push({
    tab,
    ms: Date.now() - start,
    newRequests: requests.length - before
  });
}

const csvHits = requests.filter((r) =>
  /06-site-urls|site-urls\.csv|schema-tools-six|alan-shared-resources.*06-site-urls/i.test(r.url)
);
const byUrl = new Map();
for (const r of requests) {
  const k = r.url;
  const row = byUrl.get(k) || { count: 0, type: r.type };
  row.count += 1;
  byUrl.set(k, row);
}
const repeated = [...byUrl.entries()]
  .filter(([, v]) => v.count >= 3)
  .sort((a, b) => b[1].count - a[1].count)
  .slice(0, 25)
  .map(([url, v]) => ({ url, ...v }));

const deployed = await page.evaluate(async () => {
  const res = await fetch('/audit-dashboard.html', { cache: 'no-store' });
  const html = await res.text();
  return {
    bytes: html.length,
    mergeFn: html.includes('mergeCanonicalCsvIntoMoneyPagesMetrics'),
    mergeCallSites: (html.match(/mergeCanonicalCsvIntoMoneyPagesMetrics/g) || []).length,
    csvFetchSites: (html.match(/fetchAndParseSiteUrlsCsv/g) || []).length,
    hasCsvCache: html.includes('__siteUrlsCsvCache'),
    hasMergeOnceGuard: html.includes('__moneyPagesCsvMergeDone')
  };
});

const report = {
  observedAt: new Date().toISOString(),
  initialDomContentLoadedMs: Date.now() - t0,
  totalRequests: requests.length,
  csvFetchCount: csvHits.length,
  csvFetches: csvHits,
  tabTimings,
  topRepeatedRequests: repeated,
  deployed,
  sampleConsole: consoleLines.filter((l) =>
    /Money Pages|CSV|merge|site-urls|error|timeout|Failed/i.test(l)
  ).slice(0, 40)
};

fs.mkdirSync('logs', { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

console.log('\n=== SUMMARY ===');
console.log(JSON.stringify({
  initialDomContentLoadedMs: report.initialDomContentLoadedMs,
  totalRequests45sPlusTabs: report.totalRequests,
  csvFetchCount: report.csvFetchCount,
  tabTimings: report.tabTimings,
  deployed: report.deployed,
  topRepeatedRequests: report.topRepeatedRequests.slice(0, 10)
}, null, 2));
console.log(`Full report: ${OUT}`);

await browser.close();

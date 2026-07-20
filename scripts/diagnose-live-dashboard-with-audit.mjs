/**
 * Live diagnosis with simulated saved audit (triggers Money Pages CSV merge path).
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'https://ai-geo-audit.vercel.app/audit-dashboard.html';
const OUT = 'logs/diagnose-live-dashboard-with-audit.json';

function summarizeUrl(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}${u.search ? u.search.slice(0, 60) : ''}`;
  } catch {
    return url.slice(0, 140);
  }
}

const fakeRows = Array.from({ length: 225 }, (_, i) => ({
  url: `https://www.alanranger.com/page-${i}`,
  clicks: 0,
  impressions: i === 0 ? 10 : 0,
  ctr: 0,
  avgPosition: null,
  category: 'VISIBILITY_FIX',
  subSegment: 'LANDING'
}));

const fakeAudit = {
  dateRange: 28,
  scores: {
    moneyPagesMetrics: {
      rows: fakeRows,
      overview: { siteCtr: 0.02, siteTotalClicks: 100, siteTotalImpressions: 5000 }
    }
  },
  searchData: { overview: { clicks: 100, impressions: 5000 } }
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
await context.addInitScript(({ audit, property }) => {
  localStorage.setItem('last_audit_results', JSON.stringify(audit));
  localStorage.setItem('gsc_property_url', property);
  localStorage.setItem('last_property_url', property);
  localStorage.setItem('gsc_date_range', '28');
}, { audit: fakeAudit, property: 'https://www.alanranger.com/' });

const page = await context.newPage();
const events = [];

page.on('request', (req) => {
  const url = req.url();
  if (/06-site-urls|site-urls|schema-tools-six|githubusercontent|supabase|aigeo|gsc-page|get-audit|money-pages/i.test(url)) {
    events.push({ phase: 'pending', t: Date.now(), type: 'request', url: summarizeUrl(url) });
  }
});
page.on('response', async (res) => {
  const url = res.url();
  if (!/06-site-urls|site-urls|schema-tools-six|githubusercontent|supabase|aigeo|gsc-page|get-audit|money-pages|audit-dashboard\.html/i.test(url)) return;
  const req = res.request();
  const timing = req.timing();
  events.push({
    phase: 'done',
    t: Date.now(),
    type: 'response',
    url: summarizeUrl(url),
    status: res.status(),
    durationMs: Math.round(timing.responseEnd),
    size: Number(res.headers()['content-length'] || 0) || null
  });
});

const consoleLines = [];
page.on('console', (msg) => consoleLines.push(msg.text()));

async function time(label, fn) {
  const s = Date.now();
  await fn();
  return { label, ms: Date.now() - s };
}

const htmlDownload = await time('fetch audit-dashboard.html bytes', async () => {
  const res = await page.request.get(`${BASE}?diag=${Date.now()}`, { timeout: 120000 });
  const buf = await res.body();
  return buf.length;
});

console.log('=== With simulated saved audit ===');
const loadMoney = await time('goto #money (load)', async () => {
  await page.goto(`${BASE}#money`, { waitUntil: 'load', timeout: 120000 });
});
console.log(`goto #money load: ${loadMoney.ms}ms`);

await page.waitForTimeout(15000);

const loadMoney2 = await time('goto #money again (load)', async () => {
  await page.goto(`${BASE}#money`, { waitUntil: 'load', timeout: 120000 });
});
console.log(`goto #money 2nd: ${loadMoney2.ms}ms`);

await page.waitForTimeout(15000);

const dashboardSwitch = await time('goto #dashboard (load)', async () => {
  await page.goto(`${BASE}#dashboard`, { waitUntil: 'load', timeout: 120000 });
});
console.log(`goto #dashboard: ${dashboardSwitch.ms}ms`);

await page.waitForTimeout(10000);

const backMoney = await time('goto #money 3rd (load)', async () => {
  await page.goto(`${BASE}#money`, { waitUntil: 'load', timeout: 120000 });
});
console.log(`goto #money 3rd: ${backMoney.ms}ms`);

const perf = await page.evaluate(() => {
  const nav = performance.getEntriesByType('navigation')[0];
  const resources = performance.getEntriesByType('resource')
    .filter((r) => /site-urls|06-site-urls|schema-tools|githubusercontent|audit-dashboard|supabase|aigeo/i.test(r.name))
    .map((r) => ({
      name: r.name.slice(0, 120),
      durationMs: Math.round(r.duration),
      transferSize: r.transferSize
    }));
  return {
    htmlTransferSize: nav?.transferSize,
    domContentLoadedMs: Math.round(nav?.domContentLoadedEventEnd || 0),
    loadEventMs: Math.round(nav?.loadEventEnd || 0),
    resources
  };
});

const csvResponses = events.filter((e) => e.phase === 'done' && /06-site-urls|site-urls\.csv|schema-tools-six|alan-shared-resources/i.test(e.url));

const report = {
  observedAt: new Date().toISOString(),
  htmlDownloadBytes: htmlDownload,
  timings: [loadMoney, loadMoney2, dashboardSwitch, backMoney],
  csvResponseCount: csvResponses.length,
  csvResponses,
  perf,
  relevantConsole: consoleLines.filter((l) => /Money Pages|CSV|merge|Fetched|site-urls|Using manual/i.test(l)).slice(0, 50),
  allTrackedEvents: events
};

fs.mkdirSync('logs', { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

console.log('\n=== SUMMARY ===');
console.log(JSON.stringify({
  htmlDownloadBytes: report.htmlDownloadBytes,
  timings: report.timings,
  csvResponseCount: report.csvResponseCount,
  csvResponses: report.csvResponses,
  perf,
  relevantConsole: report.relevantConsole
}, null, 2));
console.log(`Full: ${OUT}`);

await browser.close();
